import { getWallEndpoints, getWallLengthCm, GEOMETRY_EPSILON } from "@/lib/geometry/dimensions";
import { findInwardNormal, minimumSegmentPolygonDistance, type Point } from "@/lib/geometry/polygons";
import type { RoomGeometry } from "@/lib/geometry/types";
import { createFurnitureFootprint } from "./footprints";
import { seatingCoffeeTableClearanceRule, doorApproachClearanceRule } from "./clearance-rules";
import { findTargetFrontUnit } from "./semantic-resolver";
import { buildRepairRelationshipView, completeRelationshipChanges, generateRelationshipRepairCandidates, type RelationshipChange, type RelationshipCandidate } from "./repair-relationships";
import type { WholeRoomValidationReport } from "./spatial-validation-report";
import type { SpatialViolation } from "./spatial-validator";
import type { AnyFurniturePlan, AnyFurniturePlanItem } from "./types";
import type { FunctionalZone } from "./zones";

export const FUNCTIONAL_REPAIR_POLICY = {
  coffeeTableDeltasCm: [5, 10, 15, 20, 30, 45],
  movementRingsCm: [10, 20, 30, 45, 60, 75],
  maxCirculationObstacles: 4,
  circulationDirectionsPerObstacle: 4,
} as const;
export type FunctionalRepairViolation = Extract<SpatialViolation, { type: "INSUFFICIENT_FUNCTIONAL_CLEARANCE" | "BLOCKED_CIRCULATION" }>;
export type FunctionalRepairCandidate = {
  itemId: string;
  strategy: "FUNCTIONAL_CLEARANCE" | "DOOR_APPROACH" | "CIRCULATION";
  changes: RelationshipChange[];
  context: RelationshipCandidate["context"];
  functionalContext: FunctionalRepairViolation["details"];
};
type DirectionsFor = (item: AnyFurniturePlanItem, preferred?: Point) => readonly Point[];

export function isSupportedFunctionalViolation(violation: SpatialViolation): violation is FunctionalRepairViolation {
  return violation.priority === "P1" && violation.classification === "hard" && (violation.type === "BLOCKED_CIRCULATION"
    || (violation.type === "INSUFFICIENT_FUNCTIONAL_CLEARANCE" && (
      violation.details.context === "SEATING_COFFEE_TABLE" && violation.details.ruleId === seatingCoffeeTableClearanceRule.id
      || violation.details.context === "DOOR_APPROACH" && violation.details.ruleId === doorApproachClearanceRule.id
    )));
}

function isRug(item: AnyFurniturePlanItem): boolean {
  return "semanticPlacement" in item ? item.semanticPlacement.role === "AREA_RUG" : ["rug", "area_rug"].includes(item.category.trim().toLowerCase().replace(/\s+/g, "_"));
}

function isPrimary(item: AnyFurniturePlanItem): boolean {
  return "semanticPlacement" in item && item.semanticPlacement.role === "PRIMARY_SEATING";
}

function circulationProtection(item: AnyFurniturePlanItem): number {
  if (isPrimary(item)) return 4;
  if (item.placement.anchorWallId) return 3;
  if ("semanticPlacement" in item && ["COFFEE_TABLE", "AREA_RUG"].includes(item.semanticPlacement.role)) return 2;
  if ("semanticPlacement" in item && item.semanticPlacement.relationships.length > 0) return 1;
  return 0;
}

/** Generates hints only: A.3 owns distance, obstruction, route validity and acceptance. */
export function generateFunctionalRepairCandidates(
  plan: AnyFurniturePlan,
  geometry: RoomGeometry,
  zones: readonly FunctionalZone[],
  report: WholeRoomValidationReport,
  violation: FunctionalRepairViolation,
  directionsFor: DirectionsFor,
): FunctionalRepairCandidate[] {
  const view = buildRepairRelationshipView(plan);
  const byId = new Map(plan.items.map((item) => [item.id, item]));
  const contextFor = (changes: RelationshipChange[]) => changes.flatMap((change) => {
    const node = view.nodes.find((entry) => entry.itemId === change.itemId);
    return [node?.positional, node?.faces].flatMap((relationship) => relationship ? [{ itemId: change.itemId, type: relationship.type, targetItemId: relationship.targetItemId }] : []);
  });
  const wrap = (itemId: string, changes: RelationshipChange[], strategy: FunctionalRepairCandidate["strategy"]): FunctionalRepairCandidate => ({
    itemId, changes, strategy, context: contextFor(changes), functionalContext: violation.details,
  });
  const translated = (item: AnyFurniturePlanItem, preferred: Point, strategy: FunctionalRepairCandidate["strategy"], maxDirections?: number) => {
    const position = item.placement.approximatePosition;
    if (!position) return [];
    const node = view.nodes.find((entry) => entry.itemId === item.id);
    if (node?.status !== "READY") return [];
    if (node.positional && !item.placement.anchorWallId) {
      return generateRelationshipRepairCandidates(plan, item.id, geometry).map((candidate) => wrap(item.id, candidate.changes, strategy));
    }
    const directions = directionsFor(item, preferred).slice(0, maxDirections);
    const result: FunctionalRepairCandidate[] = [];
    for (const distance of FUNCTIONAL_REPAIR_POLICY.movementRingsCm) for (const direction of directions) {
      const changes = completeRelationshipChanges(plan, [{ itemId: item.id,
        position: { xCm: position.xCm + direction.xCm * distance, yCm: position.yCm + direction.yCm * distance },
        orientationDegrees: item.placement.preferredOrientationDegrees,
      }], geometry);
      if (changes) result.push(wrap(item.id, changes, strategy));
    }
    return result;
  };

  if (violation.type === "INSUFFICIENT_FUNCTIONAL_CLEARANCE") {
    if (violation.details.context === "SEATING_COFFEE_TABLE") {
      const item = byId.get(violation.details.relationship.sourceItemId);
      const anchor = byId.get(violation.details.relationship.targetItemId);
      const position = item?.placement.approximatePosition;
      if (!item || !anchor || !position || item.placement.anchorWallId || isPrimary(item) || !("semanticPlacement" in anchor)) return [];
      const node = view.nodes.find((member) => member.itemId === item.id);
      if (node?.status !== "READY" || node.positional?.type !== "IN_FRONT_OF" || node.positional.targetItemId !== anchor.id) return [];
      const front = findTargetFrontUnit(anchor, geometry);
      if (!front || !createFurnitureFootprint(item).valid || !createFurnitureFootprint(anchor).valid) return [];
      return FUNCTIONAL_REPAIR_POLICY.coffeeTableDeltasCm.flatMap((distance) => {
        const changes = completeRelationshipChanges(plan, [{ itemId: item.id,
          position: { xCm: position.xCm + front.xCm * distance, yCm: position.yCm + front.yCm * distance },
          orientationDegrees: item.placement.preferredOrientationDegrees,
        }], geometry);
        return changes ? [wrap(item.id, changes, "FUNCTIONAL_CLEARANCE")] : [];
      });
    }
    const item = byId.get(violation.itemIds[0]);
    if (!item || isPrimary(item) || isRug(item) || !createFurnitureFootprint(item).valid) return [];
    const wallSegmentId = violation.details.wallSegmentId;
    const wall = geometry.wallSegments.find((entry) => entry.id === wallSegmentId);
    const endpoints = wall ? getWallEndpoints(geometry, wall) : null;
    const length = wall ? getWallLengthCm(geometry, wall) : null;
    if (!endpoints || !length) return [];
    const center = violation.details.approachPolygon.reduce((sum, point) => ({ xCm: sum.xCm + point.xCm / 4, yCm: sum.yCm + point.yCm / 4 }), { xCm: 0, yCm: 0 });
    const unit = { xCm: (endpoints.end.xCm - endpoints.start.xCm) / length, yCm: (endpoints.end.yCm - endpoints.start.yCm) / length };
    const projection = (center.xCm - endpoints.start.xCm) * unit.xCm + (center.yCm - endpoints.start.yCm) * unit.yCm;
    const wallPoint = { xCm: endpoints.start.xCm + unit.xCm * projection, yCm: endpoints.start.yCm + unit.yCm * projection };
    const inward = findInwardNormal(wallPoint, unit.xCm, unit.yCm, geometry.vertices);
    const position = item.placement.approximatePosition;
    return inward && position ? translated(item, { xCm: position.xCm + inward.xCm, yCm: position.yCm + inward.yCm }, "DOOR_APPROACH") : [];
  }

  const zone = zones.find((entry) => entry.id === violation.details.targetZoneId);
  const starts = report.circulation.doors.map((entry) => entry.start);
  if (!zone || starts.length === 0) return [];
  const obstacles = plan.items.flatMap((item) => {
    if (isRug(item) || !directionsFor(item).length) return [];
    const footprint = createFurnitureFootprint(item);
    if (!footprint.valid) return [];
    const distance = Math.min(...starts.map((start) => minimumSegmentPolygonDistance(start, zone.center, footprint.footprint.polygon)));
    return [{ item, distance, protection: circulationProtection(item) }];
  }).sort((first, second) => first.protection - second.protection || first.distance - second.distance || (first.item.id < second.item.id ? -1 : first.item.id > second.item.id ? 1 : 0));
  const safer = obstacles.filter((entry) => !isPrimary(entry.item));
  const selected = (safer.length ? safer : obstacles).slice(0, FUNCTIONAL_REPAIR_POLICY.maxCirculationObstacles);
  const groups = selected.map(({ item }) => {
    const position = item.placement.approximatePosition;
    if (!position) return [];
    const start = starts[0];
    const deltaX = zone.center.xCm - start.xCm;
    const deltaY = zone.center.yCm - start.yCm;
    const length = Math.hypot(deltaX, deltaY);
    if (length <= GEOMETRY_EPSILON) return [];
    const side = (position.xCm - start.xCm) * -deltaY + (position.yCm - start.yCm) * deltaX < 0 ? -1 : 1;
    const preferred = { xCm: position.xCm + side * -deltaY / length, yCm: position.yCm + side * deltaX / length };
    return translated(item, preferred, "CIRCULATION", FUNCTIONAL_REPAIR_POLICY.circulationDirectionsPerObstacle);
  });
  const result: FunctionalRepairCandidate[] = [];
  const count = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < count; index += 1) for (const group of groups) {
    if (group[index]) result.push(group[index]);
  }
  return result;
}