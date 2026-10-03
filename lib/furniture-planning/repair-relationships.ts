import type { RoomGeometry } from "@/lib/geometry/types";
import type { Point } from "@/lib/geometry/polygons";
import { GEOMETRY_EPSILON } from "@/lib/geometry/dimensions";
import { createFurnitureFootprint } from "./footprints";
import { ADJACENT_GAP_CM, IN_FRONT_OF_GAP_CM, computeAdjacentCenters, computeInFrontCenter, computeFacesOrientation, findTargetFrontUnit, getEffectiveRelationships } from "./semantic-resolver";
import type { AnyFurniturePlan, AnyFurniturePlanItem, FurniturePlanItemV11 } from "./types";

type Relationship = FurniturePlanItemV11["semanticPlacement"]["relationships"][number];
export const RELATIONSHIP_REPAIR_LIMITS = { maxDependents: 4, maxCoordinatedAssignments: 16 } as const;
export type RepairRelationshipNode = {
  itemId: string;
  primaryAnchor: boolean;
  outgoing: Relationship[];
  dependentIds: string[];
  positional: Relationship | null;
  faces: Relationship | null;
  status: "READY" | "INVALID" | "UNRESOLVED";
};
export type RepairRelationshipView = { nodes: RepairRelationshipNode[]; dependencyOrder: string[]; unresolvedItemIds: string[] };
export type RelationshipChange = { itemId: string; position: Point; orientationDegrees: number | null };
export type RelationshipCandidate = {
  strategy: "RELATIONSHIP_SINGLE" | "RELATIONSHIP_COORDINATED";
  changes: RelationshipChange[];
  context: Array<{ itemId: string; type: Relationship["type"]; targetItemId: string }>;
};

const compareIds = (first: string, second: string) => first < second ? -1 : first > second ? 1 : 0;
const relationOrder: Record<Relationship["type"], number> = { IN_FRONT_OF: 0, ADJACENT_TO: 1, FACES: 2, FLANKS: 3, GROUPED_WITH: 4, ANCHORS: 5 };

export function buildRepairRelationshipView(plan: AnyFurniturePlan): RepairRelationshipView {
  const ids = new Set(plan.items.map((item) => item.id));
  if (ids.size !== plan.items.length) return { nodes: [], dependencyOrder: [], unresolvedItemIds: [...ids].sort(compareIds) };
  const nodes: RepairRelationshipNode[] = [...plan.items].sort((first, second) => compareIds(first.id, second.id)).map((item) => {
    const semantic = "semanticPlacement" in item ? item.semanticPlacement : null;
    const outgoing = [...new Map((semantic?.relationships ?? []).map((relationship) => [JSON.stringify([relationship.type, relationship.targetItemId]), { ...relationship }])).values()]
      .sort((first, second) => relationOrder[first.type] - relationOrder[second.type] || compareIds(first.targetItemId, second.targetItemId));
    const effective = semantic && ["FLOATING", "CENTERED_IN_ZONE"].includes(semantic.mode) ? getEffectiveRelationships(outgoing) : { positional: undefined, faces: undefined };
    const dependencies = effective ? [effective.positional, effective.faces].filter((relationship) => relationship !== undefined) : [];
    const invalid = effective === null || dependencies.some((relationship) => relationship.targetItemId === item.id || !ids.has(relationship.targetItemId));
    return { itemId: item.id, primaryAnchor: semantic?.role === "PRIMARY_SEATING", outgoing, dependentIds: [],
      positional: effective?.positional ?? null, faces: effective?.faces ?? null, status: invalid ? "INVALID" : "UNRESOLVED" };
  });
  for (const node of nodes) {
    node.dependentIds = nodes.filter((dependent) => dependent.positional?.targetItemId === node.itemId || dependent.faces?.targetItemId === node.itemId).map((dependent) => dependent.itemId);
  }
  const ready = new Set<string>();
  const dependencyOrder: string[] = [];
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let progress = false;
    for (const node of nodes) {
      if (node.status !== "UNRESOLVED") continue;
      if ([node.positional, node.faces].every((relationship) => relationship === null || ready.has(relationship.targetItemId))) {
        node.status = "READY"; ready.add(node.itemId); dependencyOrder.push(node.itemId); progress = true;
      }
    }
    if (!progress) break;
  }
  return { nodes, dependencyOrder, unresolvedItemIds: nodes.filter((node) => node.status !== "READY").map((node) => node.itemId) };
}

function movableDependent(item: AnyFurniturePlanItem): item is FurniturePlanItemV11 {
  return "semanticPlacement" in item && !item.placement.anchorWallId && item.semanticPlacement.role !== "PRIMARY_SEATING"
    && ["FLOATING", "CENTERED_IN_ZONE"].includes(item.semanticPlacement.mode);
}

function relativePosition(source: AnyFurniturePlanItem, target: AnyFurniturePlanItem, relationship: Relationship, geometry: RoomGeometry, side: number, outwardCm: number): Point | null {
  const sourceFootprint = createFurnitureFootprint(source);
  const targetFootprint = createFurnitureFootprint(target);
  if (!sourceFootprint.valid || !targetFootprint.valid) return null;
  const anchor = targetFootprint.footprint;
  if (relationship.type === "ADJACENT_TO") {
    return computeAdjacentCenters(anchor.center, anchor.orientationDegrees, anchor.widthCm, sourceFootprint.footprint.widthCm, ADJACENT_GAP_CM + outwardCm)[side === 1 ? 0 : 1];
  }
  if (relationship.type === "IN_FRONT_OF" && "semanticPlacement" in target) {
    const front = findTargetFrontUnit(target, geometry);
    return front ? computeInFrontCenter(anchor.center, front, anchor.depthCm, sourceFootprint.footprint.depthCm, IN_FRONT_OF_GAP_CM + outwardCm) : null;
  }
  return null;
}

/** Applies positional precedence and existing FACES atomically; bounded descendants follow moved anchors. */
export function completeRelationshipChanges(plan: AnyFurniturePlan, seeds: readonly RelationshipChange[], geometry: RoomGeometry): RelationshipChange[] | null {
  const view = buildRepairRelationshipView(plan);
  const positions = new Map(plan.items.map((item) => [item.id, item]));
  const changes = new Map<string, RelationshipChange>();
  for (const seed of seeds) changes.set(seed.itemId, { ...seed, position: { ...seed.position } });
  for (const id of view.dependencyOrder) {
    const item = positions.get(id);
    const node = view.nodes.find((candidate) => candidate.itemId === id);
    if (!item || !node) continue;
    const positionalTarget = node.positional ? positions.get(node.positional.targetItemId) : null;
    const shouldFollow = node.positional && changes.has(node.positional.targetItemId);
    if (!changes.has(id) && shouldFollow && node.positional) {
      if (!movableDependent(item) || !positionalTarget || changes.size >= RELATIONSHIP_REPAIR_LIMITS.maxDependents) return null;
      const original = item.placement.approximatePosition;
      const center = positionalTarget.placement.approximatePosition;
      const angle = positionalTarget.placement.preferredOrientationDegrees;
      const side = original && center && angle !== null
        && (original.xCm - center.xCm) * Math.cos(angle * Math.PI / 180) + (original.yCm - center.yCm) * Math.sin(angle * Math.PI / 180) < -GEOMETRY_EPSILON ? -1 : 1;
      const position = relativePosition(item, positionalTarget, node.positional, geometry, side, 0);
      if (!position) return null;
      changes.set(id, { itemId: id, position, orientationDegrees: item.placement.preferredOrientationDegrees });
    }
    if (!changes.has(id) && node.faces && changes.has(node.faces.targetItemId)) {
      if (!movableDependent(item) || !item.placement.approximatePosition || changes.size >= RELATIONSHIP_REPAIR_LIMITS.maxDependents) return null;
      changes.set(id, { itemId: id, position: { ...item.placement.approximatePosition }, orientationDegrees: item.placement.preferredOrientationDegrees });
    }
    const change = changes.get(id);
    if (!change) continue;
    if (node.faces && movableDependent(item)) {
      const targetPosition = positions.get(node.faces.targetItemId)?.placement.approximatePosition;
      const angle = targetPosition ? computeFacesOrientation(change.position, targetPosition) : null;
      if (angle !== null) change.orientationDegrees = angle;
    }
    positions.set(id, { ...item, placement: { ...item.placement, approximatePosition: change.position, preferredOrientationDegrees: change.orientationDegrees } });
  }
  return [...changes.values()].sort((first, second) => compareIds(first.itemId, second.itemId));
}

/** Coordinated opposite sides first, then single-side/outward candidates; never a packing search. */
export function generateRelationshipRepairCandidates(plan: AnyFurniturePlan, itemId: string, geometry: RoomGeometry): RelationshipCandidate[] {
  const view = buildRepairRelationshipView(plan);
  const nodes = new Map(view.nodes.map((node) => [node.itemId, node]));
  const items = new Map(plan.items.map((item) => [item.id, item]));
  const node = nodes.get(itemId);
  const source = items.get(itemId);
  if (!node || node.status !== "READY" || !node.positional || !source || !movableDependent(source)) return [];
  const anchor = items.get(node.positional.targetItemId);
  if (!anchor) return [];
  const candidates: RelationshipCandidate[] = [];
  const add = (seeds: RelationshipChange[], strategy: RelationshipCandidate["strategy"]) => {
    const changes = completeRelationshipChanges(plan, seeds, geometry);
    if (!changes || changes.length > RELATIONSHIP_REPAIR_LIMITS.maxDependents) return;
    const actualStrategy = changes.length > 1 ? "RELATIONSHIP_COORDINATED" : strategy;
    if (actualStrategy === "RELATIONSHIP_COORDINATED"
      && candidates.filter((candidate) => candidate.strategy === actualStrategy).length >= RELATIONSHIP_REPAIR_LIMITS.maxCoordinatedAssignments) return;
    const context = changes.flatMap((change) => {
      const member = nodes.get(change.itemId);
      return [member?.positional, member?.faces].flatMap((relationship) => relationship ? [{ itemId: change.itemId, type: relationship.type, targetItemId: relationship.targetItemId }] : []);
    });
    candidates.push({ strategy: actualStrategy, changes, context });
  };
  const offsets = [0, 10, 20, 30, 45, 60];
  if (node.positional.type === "ADJACENT_TO") {
    const siblings = view.nodes.filter((member) => {
      const item = items.get(member.itemId);
      return member.status === "READY" && member.positional?.type === "ADJACENT_TO"
        && member.positional.targetItemId === anchor.id && item !== undefined && movableDependent(item);
    });
    const memberIds = siblings.map((member) => member.itemId);
    const selectedIds = memberIds.slice(0, RELATIONSHIP_REPAIR_LIMITS.maxDependents);
    if (!selectedIds.includes(itemId)) selectedIds[selectedIds.length - 1] = itemId;
    selectedIds.sort(compareIds);
    if (selectedIds.length > 1) {
      const laneWidth = Math.max(...selectedIds.map((id) => {
        const item = items.get(id);
        const footprint = item ? createFurnitureFootprint(item) : null;
        return footprint?.valid ? footprint.footprint.widthCm : 0;
      })) + ADJACENT_GAP_CM;
      for (const outward of offsets) for (const initialSide of [1, -1]) {
        const seeds: RelationshipChange[] = [];
        for (const [index, id] of selectedIds.entries()) {
          const member = items.get(id);
          if (!member) break;
          const side = index % 2 === 0 ? initialSide : -initialSide;
          const position = relativePosition(member, anchor, node.positional, geometry, side, outward + Math.floor(index / 2) * laneWidth);
          if (!position) break;
          seeds.push({ itemId: id, position, orientationDegrees: member.placement.preferredOrientationDegrees });
        }
        if (seeds.length === selectedIds.length && candidates.length < RELATIONSHIP_REPAIR_LIMITS.maxCoordinatedAssignments) add(seeds, "RELATIONSHIP_COORDINATED");
      }
    }
  }
  for (const outward of offsets) for (const side of node.positional.type === "ADJACENT_TO" ? [1, -1] : [1]) {
    const position = relativePosition(source, anchor, node.positional, geometry, side, outward);
    if (position) add([{ itemId, position, orientationDegrees: source.placement.preferredOrientationDegrees }], "RELATIONSHIP_SINGLE");
  }
  return candidates;
}