import { validateOpeningFitsWall, getOpeningWorldPosition } from "@/lib/geometry/openings";
import { GEOMETRY_EPSILON } from "@/lib/geometry/dimensions";
import { createOrientedRectangle, findInwardNormal, minimumPolygonDistance, minimumSegmentPolygonDistance, polygonInsidePolygon, rectanglesOverlapWithPositiveArea, segmentIntersectsPolygon, type Point, type Rectangle } from "@/lib/geometry/polygons";
import { roomOpeningSchema } from "@/lib/geometry/schema";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";
import { validateRoomGeometryStructure } from "@/lib/geometry/validation";
import { createFurnitureFootprint, type FootprintIssue, type FurnitureFootprint } from "./footprints";
import { doorApproachClearanceRule, seatingCoffeeTableClearanceRule, NORMAL_CIRCULATION_PROFILE } from "./clearance-rules";
import { evaluateCirculation, type CirculationEvaluation } from "./circulation";
import type { FunctionalZone } from "./zones";
import type { AnyFurniturePlan, AnyFurniturePlanItem } from "./types";

type Violation<Type extends string, Details, Priority extends "P0" | "P1" = "P0"> = {
  id: string;
  type: Type;
  itemIds: string[];
  priority: Priority;
  classification: "hard";
  message: string;
  details: Details;
};

export type SpatialViolation =
  | Violation<"INVALID_FOOTPRINT", { reasons: Array<FootprintIssue | "DUPLICATE_ITEM_ID">; duplicateCount?: number }>
  | Violation<"OUTSIDE_ROOM", { footprint: FurnitureFootprint }>
  | Violation<"FURNITURE_OVERLAP", { intersection: "positive_area" }>
  | Violation<"DOOR_CONFLICT", { openingId: string | null; wallSegmentId: string; span: { start: Point; end: Point } }>
  | Violation<"INSUFFICIENT_FUNCTIONAL_CLEARANCE", {
    ruleId: string;
    requiredMinimumCm: number;
    measuredClearanceCm: number;
  } & (
    { context: "SEATING_COFFEE_TABLE"; relationship: { type: "IN_FRONT_OF"; sourceItemId: string; targetItemId: string } }
    | { context: "DOOR_APPROACH"; openingId: string | null; wallSegmentId: string; approachPolygon: Rectangle }
  ), "P1">
  | Violation<"BLOCKED_CIRCULATION", { profileId: string; targetZoneId: string; minimumPassageWidthCm: number; evaluatedDoorIds: string[] }, "P1">;

/** Physical validity excludes hard P0; functional validity excludes hard P1; overall validity requires both. */
export type SpatialValidationResult = { valid: boolean; physicallyValid: boolean; functionallyValid: boolean; violations: SpatialViolation[]; circulation: CirculationEvaluation };

/** AREA_RUG is a floor layer under furniture; two rugs still compete for the same floor layer. */
function occupancyLayer(item: AnyFurniturePlanItem): "AREA_RUG" | "FURNITURE" {
  const isRug = "semanticPlacement" in item
    ? item.semanticPlacement.role === "AREA_RUG"
    : ["rug", "area_rug"].includes(item.category.trim().toLowerCase().replace(/\s+/g, "_"));
  return isRug ? "AREA_RUG" : "FURNITURE";
}

function shouldValidatePair(first: AnyFurniturePlanItem, second: AnyFurniturePlanItem): boolean {
  return occupancyLayer(first) === occupancyLayer(second);
}

function violationBase<Type extends SpatialViolation["type"]>(type: Type, itemIds: string[], context = "") {
  const normalizedIds = [...itemIds].sort();
  return {
    id: `spatial:${JSON.stringify([type, normalizedIds, context])}`,
    type,
    itemIds: normalizedIds,
    priority: "P0" as const,
    classification: "hard" as const,
  };
}

/** Validation only. Authoritative geometry and door definitions must be structurally valid. */
export function validateSpatialPlan(
  plan: AnyFurniturePlan,
  geometry: RoomGeometry,
  openings: readonly RoomOpening[] = [],
  zones: readonly FunctionalZone[] = [],
): SpatialValidationResult {
  if (!validateRoomGeometryStructure(geometry).valid) throw new Error("SPATIAL_GEOMETRY_INVALID");
  const doors = new Map<string, { opening: RoomOpening; span: { start: Point; end: Point }; approach: Rectangle; circulationStart: Point }>();
  for (const opening of openings) {
    if (opening.openingType !== "door") continue;
    const parsed = roomOpeningSchema.safeParse(opening);
    if (!parsed.success || !validateOpeningFitsWall(geometry, parsed.data).valid) throw new Error("SPATIAL_DOOR_INVALID");
    const span = getOpeningWorldPosition(geometry, parsed.data);
    if (!span) throw new Error("SPATIAL_DOOR_INVALID");
    const deltaX = span.end.xCm - span.start.xCm;
    const deltaY = span.end.yCm - span.start.yCm;
    const width = Math.hypot(deltaX, deltaY);
    const midpoint = { xCm: (span.start.xCm + span.end.xCm) / 2, yCm: (span.start.yCm + span.end.yCm) / 2 };
    const inward = findInwardNormal(midpoint, deltaX / width, deltaY / width, geometry.vertices);
    if (!inward) throw new Error("SPATIAL_DOOR_APPROACH_UNAVAILABLE");
    const depth = doorApproachClearanceRule.minimumCm;
    const center = { xCm: midpoint.xCm + inward.xCm * depth / 2, yCm: midpoint.yCm + inward.yCm * depth / 2 };
    const approach = createOrientedRectangle(center, width, depth, Math.atan2(deltaY, deltaX) * 180 / Math.PI);
    const key = JSON.stringify([parsed.data.id ?? null, parsed.data.wallSegmentId, parsed.data.offsetCm, parsed.data.widthCm]);
    const radius = NORMAL_CIRCULATION_PROFILE.minimumPassageWidthCm / 2;
    doors.set(key, { opening: parsed.data, span, approach, circulationStart: {
      xCm: midpoint.xCm + inward.xCm * radius, yCm: midpoint.yCm + inward.yCm * radius,
    } });
  }

  const violations: SpatialViolation[] = [];
  const physicalOverlapIds = new Set<string>();
  const physicalDoorIds = new Set<string>();
  const physicallyBlockedDoors = new Set<string>();
  const approachBlockedDoors = new Set<string>();
  const counts = new Map<string, number>();
  for (const item of plan.items) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  for (const [id, duplicateCount] of counts) {
    if (duplicateCount > 1) violations.push({
      ...violationBase("INVALID_FOOTPRINT", [id]),
      message: "Duplicate plan item IDs prevent unambiguous spatial validation.",
      details: { reasons: ["DUPLICATE_ITEM_ID"], duplicateCount },
    });
  }

  const validItems: Array<{ item: AnyFurniturePlanItem; footprint: FurnitureFootprint }> = [];
  for (const item of plan.items) {
    if ((counts.get(item.id) ?? 0) > 1) continue;
    const result = createFurnitureFootprint(item);
    if (!result.valid) {
      violations.push({
        ...violationBase("INVALID_FOOTPRINT", [item.id]),
        message: "Furniture cannot produce a valid representative footprint.",
        details: { reasons: result.reasons },
      });
      continue;
    }
    const footprint = result.footprint;
    validItems.push({ item, footprint });
    if (!polygonInsidePolygon(footprint.polygon, geometry.vertices)) violations.push({
      ...violationBase("OUTSIDE_ROOM", [item.id]),
      message: "The complete furniture footprint is not contained in the room polygon.",
      details: { footprint },
    });
    for (const [key, { opening, span }] of doors) {
      if (segmentIntersectsPolygon(span.start, span.end, footprint.polygon)) {
        const base = violationBase("DOOR_CONFLICT", [item.id], key);
        physicalDoorIds.add(base.id);
        physicallyBlockedDoors.add(key);
        violations.push({
          ...base,
          message: "Furniture intersects the physical doorway span.",
          details: { openingId: opening.id ?? null, wallSegmentId: opening.wallSegmentId, span },
        });
      }
    }
  }

  for (let firstIndex = 0; firstIndex < validItems.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < validItems.length; secondIndex += 1) {
      const first = validItems[firstIndex];
      const second = validItems[secondIndex];
      if (shouldValidatePair(first.item, second.item) && rectanglesOverlapWithPositiveArea(first.footprint.corners, second.footprint.corners)) {
        const base = violationBase("FURNITURE_OVERLAP", [first.item.id, second.item.id]);
        physicalOverlapIds.add(base.id);
        violations.push({
          ...base,
          message: "Furniture footprints have a positive-area intersection on the same occupancy layer.",
          details: { intersection: "positive_area" },
        });
      }
    }
  }

  const validById = new Map(validItems.map((entry) => [entry.item.id, entry]));
  const reportedFunctionalIds = new Set<string>();
  const tableRule = seatingCoffeeTableClearanceRule;
  for (const { item, footprint } of validItems) {
    if (!("semanticPlacement" in item) || item.semanticPlacement.role !== tableRule.sourceRole) continue;
    for (const relationship of item.semanticPlacement.relationships) {
      if (relationship.type !== tableRule.relationshipType) continue;
      const target = validById.get(relationship.targetItemId);
      if (!target || target.item.id === item.id || !("semanticPlacement" in target.item)) continue;
      const targetRole = target.item.semanticPlacement.role;
      if (!tableRule.targetRoles.some((role) => role === targetRole)) continue;
      const pairIds = [item.id, target.item.id];
      if (physicalOverlapIds.has(violationBase("FURNITURE_OVERLAP", pairIds).id)) continue;
      const measured = minimumPolygonDistance(footprint.polygon, target.footprint.polygon);
      if (measured >= tableRule.minimumCm - GEOMETRY_EPSILON) continue;
      const base = violationBase("INSUFFICIENT_FUNCTIONAL_CLEARANCE", pairIds, tableRule.id);
      if (reportedFunctionalIds.has(base.id)) continue;
      reportedFunctionalIds.add(base.id);
      violations.push({
        ...base, priority: tableRule.priority, classification: tableRule.classification,
        message: "Related coffee table and seating lack the RoomAI minimum functional spacing; this is not a regulatory assessment.",
        details: {
          context: "SEATING_COFFEE_TABLE", ruleId: tableRule.id, requiredMinimumCm: tableRule.minimumCm,
          measuredClearanceCm: measured,
          relationship: { type: tableRule.relationshipType, sourceItemId: item.id, targetItemId: target.item.id },
        },
      });
    }
  }

  const doorRule = doorApproachClearanceRule;
  for (const { item, footprint } of validItems) {
    if (occupancyLayer(item) === "AREA_RUG") continue;
    for (const [key, { opening, span, approach }] of doors) {
      if (physicalDoorIds.has(violationBase("DOOR_CONFLICT", [item.id], key).id)
        || !rectanglesOverlapWithPositiveArea(footprint.corners, approach)) continue;
      approachBlockedDoors.add(key);
      violations.push({
        ...violationBase("INSUFFICIENT_FUNCTIONAL_CLEARANCE", [item.id], JSON.stringify([doorRule.id, key])),
        priority: doorRule.priority, classification: doorRule.classification,
        message: "Furniture occupies the RoomAI interior door approach region; no door swing or legal compliance is assessed.",
        details: {
          context: "DOOR_APPROACH", ruleId: doorRule.id, requiredMinimumCm: doorRule.minimumCm,
          measuredClearanceCm: minimumSegmentPolygonDistance(span.start, span.end, footprint.polygon),
          openingId: opening.id ?? null, wallSegmentId: opening.wallSegmentId, approachPolygon: approach,
        },
      });
    }
  }
  const circulation = evaluateCirculation(
    geometry, zones,
    validItems.filter(({ item }) => occupancyLayer(item) !== "AREA_RUG").map(({ footprint }) => footprint),
    [...doors].map(([id, door]) => ({
      id, start: door.circulationStart,
      excludedReason: physicallyBlockedDoors.has(id) ? "PHYSICAL_DOOR_CONFLICT"
        : approachBlockedDoors.has(id) ? "DOOR_APPROACH_OBSTRUCTION" : null,
    })),
    violations.filter((violation) => violation.type === "INVALID_FOOTPRINT").flatMap((violation) => violation.itemIds),
  );
  if (circulation.status === "BLOCKED" && circulation.targetZoneId !== null) {
    violations.push({
      ...violationBase("BLOCKED_CIRCULATION", [], JSON.stringify([circulation.profileId, circulation.targetZoneId, circulation.evaluatedDoorIds])),
      priority: NORMAL_CIRCULATION_PROFILE.priority,
      message: "No usable door reaches the primary seating access area under the bounded RoomAI normal-use circulation approximation; not accessibility or egress certification.",
      details: {
        profileId: circulation.profileId, targetZoneId: circulation.targetZoneId,
        minimumPassageWidthCm: circulation.minimumPassageWidthCm, evaluatedDoorIds: circulation.evaluatedDoorIds,
      },
    });
  }
  violations.sort((first, second) => first.id < second.id ? -1 : first.id > second.id ? 1 : 0);
  const physicallyValid = !violations.some((violation) => violation.priority === "P0" && violation.classification === "hard");
  const functionallyValid = !violations.some((violation) => violation.priority === "P1" && violation.classification === "hard");
  return { valid: physicallyValid && functionallyValid, physicallyValid, functionallyValid, violations, circulation };
}