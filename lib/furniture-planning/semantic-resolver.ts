import { getWallEndpoints, getWallLengthCm } from "@/lib/geometry/dimensions";
import { isPointInsideOrOnPolygon } from "@/lib/geometry/point-in-polygon";
import type { RoomGeometry, RoomOpening, Vertex } from "@/lib/geometry/types";
import {
  DOOR_EDGE_CLEARANCE_CM,
} from "@/lib/furniture-planning/room-constraints";
import type { FurniturePlanItemV11, FurniturePlanV11 } from "@/lib/furniture-planning/types";

export const WALL_ALIGNMENT_MARGIN_CM = 10;
export const NEAR_WALL_GAP_CM = 15;
export const CORNER_ALIGNMENT_MARGIN_CM = 10;
export const IN_FRONT_OF_GAP_CM = 40;
export const ADJACENT_GAP_CM = 10;

type Span = { startCm: number; endCm: number };

function subtractIntervals(lengthCm: number, blocked: Span[]): Span[] {
  const sorted = [...blocked].sort((a, b) => a.startCm - b.startCm);
  const merged: Span[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous && interval.startCm <= previous.endCm) {
      previous.endCm = Math.max(previous.endCm, interval.endCm);
    } else {
      merged.push({ ...interval });
    }
  }
  const free: Span[] = [];
  let cursor = 0;
  for (const interval of merged) {
    if (interval.startCm > cursor) {
      free.push({ startCm: cursor, endCm: interval.startCm });
    }
    cursor = Math.max(cursor, interval.endCm);
  }
  if (cursor < lengthCm) {
    free.push({ startCm: cursor, endCm: lengthCm });
  }
  return free.filter((span) => span.endCm > span.startCm);
}

function findInwardNormal(
  wallPoint: { xCm: number; yCm: number },
  unitX: number,
  unitY: number,
  vertices: Vertex[],
): { xCm: number; yCm: number } | null {
  const normal1 = { xCm: -unitY, yCm: unitX };
  const normal2 = { xCm: unitY, yCm: -unitX };

  for (const delta of [0.5, 1.0, 0.1, 2.0]) {
    const p1 = { xCm: wallPoint.xCm + normal1.xCm * delta, yCm: wallPoint.yCm + normal1.yCm * delta };
    const p2 = { xCm: wallPoint.xCm + normal2.xCm * delta, yCm: wallPoint.yCm + normal2.yCm * delta };

    const in1 = isPointInsideOrOnPolygon(p1, vertices);
    const in2 = isPointInsideOrOnPolygon(p2, vertices);

    if (in1 && !in2) return normal1;
    if (in2 && !in1) return normal2;
  }

  // Fallback: check which candidate penetrates further inside the polygon
  let travel1 = 0;
  let travel2 = 0;
  for (let d = 0.5; d <= 200; d += 0.5) {
    if (isPointInsideOrOnPolygon({ xCm: wallPoint.xCm + normal1.xCm * d, yCm: wallPoint.yCm + normal1.yCm * d }, vertices)) {
      travel1 = d;
    } else {
      break;
    }
  }
  for (let d = 0.5; d <= 200; d += 0.5) {
    if (isPointInsideOrOnPolygon({ xCm: wallPoint.xCm + normal2.xCm * d, yCm: wallPoint.yCm + normal2.yCm * d }, vertices)) {
      travel2 = d;
    } else {
      break;
    }
  }

  // If neither candidate demonstrates positive interior penetration, fail safe
  if (travel1 <= 0 && travel2 <= 0) {
    return null;
  }

  if (travel1 > 0 && travel2 <= 0) {
    return normal1;
  }

  if (travel2 > 0 && travel1 <= 0) {
    return normal2;
  }

  if (travel1 > travel2) {
    return normal1;
  }

  if (travel2 > travel1) {
    return normal2;
  }

  // Deterministic tie-breaker: prefer candidate with larger x component, then larger y component
  if (normal1.xCm !== normal2.xCm) {
    return normal1.xCm > normal2.xCm ? normal1 : normal2;
  }
  return normal1.yCm >= normal2.yCm ? normal1 : normal2;
}

export function computeFacesOrientation(
  sourceCenter: { xCm: number; yCm: number },
  targetCenter: { xCm: number; yCm: number },
): number | null {
  const dx = targetCenter.xCm - sourceCenter.xCm;
  const dy = targetCenter.yCm - sourceCenter.yCm;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= 1e-6) return null;

  const ux = dx / length;
  const uy = dy / length;

  return normalizeOrientationDegrees((Math.atan2(-ux, uy) * 180) / Math.PI);
}

function normalizeOrientationDegrees(degrees: number): number {
  return ((Math.round(degrees) % 360) + 360) % 360;
}

type Relationship = FurniturePlanItemV11["semanticPlacement"]["relationships"][number];

function getEffectiveRelationships(relationships: Relationship[]) {
  const targetsByType = new Map<Relationship["type"], Relationship>();
  for (const relationship of relationships) {
    if (
      relationship.type !== "IN_FRONT_OF" &&
      relationship.type !== "ADJACENT_TO" &&
      relationship.type !== "FACES"
    ) return null;
    const existing = targetsByType.get(relationship.type);
    if (existing && existing.targetItemId !== relationship.targetItemId) return null;
    targetsByType.set(relationship.type, relationship);
  }
  return {
    positional: targetsByType.get("IN_FRONT_OF") ?? targetsByType.get("ADJACENT_TO"),
    faces: targetsByType.get("FACES"),
  };
}

function findTargetFrontUnit(
  targetItem: FurniturePlanItemV11,
  geometry: RoomGeometry,
): { xCm: number; yCm: number } | null {
  const anchorWallId = targetItem.placement.anchorWallId;
  if (!anchorWallId) return null;

  const wall = geometry.wallSegments.find((w) => w.id === anchorWallId);
  if (!wall) return null;

  const endpoints = getWallEndpoints(geometry, wall);
  const wallLength = getWallLengthCm(geometry, wall);
  if (!endpoints || !wallLength || wallLength <= 1e-6) return null;

  const targetCenter = targetItem.placement.approximatePosition;
  if (!targetCenter || !Number.isFinite(targetCenter.xCm) || !Number.isFinite(targetCenter.yCm)) {
    return null;
  }

  const unitX = (endpoints.end.xCm - endpoints.start.xCm) / wallLength;
  const unitY = (endpoints.end.yCm - endpoints.start.yCm) / wallLength;

  const dx = targetCenter.xCm - endpoints.start.xCm;
  const dy = targetCenter.yCm - endpoints.start.yCm;
  const t = Math.max(0, Math.min(wallLength, dx * unitX + dy * unitY));
  const wallPoint = {
    xCm: endpoints.start.xCm + unitX * t,
    yCm: endpoints.start.yCm + unitY * t,
  };

  return findInwardNormal(wallPoint, unitX, unitY, geometry.vertices);
}

export function resolveSemanticPlacement(
  item: FurniturePlanItemV11,
  geometry: RoomGeometry,
  openings: RoomOpening[] = [],
  resolvedItemsById?: ReadonlyMap<string, FurniturePlanItemV11>,
): FurniturePlanItemV11 {
  return resolvePlacement(item, geometry, openings, resolvedItemsById);
}

function resolvePlacement(
  item: FurniturePlanItemV11,
  geometry: RoomGeometry,
  openings: RoomOpening[] = [],
  resolvedItemsById?: ReadonlyMap<string, FurniturePlanItemV11>,
  planningWidthsById?: Map<string, number>,
): FurniturePlanItemV11 {
  if (!("semanticPlacement" in item) || !item.semanticPlacement) {
    return { ...item };
  }

  const { mode, alignment, targetWallId, relationships } = item.semanticPlacement;

  const isAgainstWall =
    mode === "AGAINST_WALL" &&
    (alignment === "CENTERED" || alignment === "LEFT_ALIGNED" || alignment === "RIGHT_ALIGNED");

  const isNearWall = mode === "NEAR_WALL" && alignment === "CENTERED";

  const isCornerPlacement =
    mode === "CORNER_PLACEMENT" &&
    (alignment === "LEFT_ALIGNED" || alignment === "RIGHT_ALIGNED");

  // Wall-aligned modes take precedence for position and orientation
  if (isAgainstWall || isNearWall || isCornerPlacement) {
    if (!targetWallId) {
      return { ...item };
    }

    const minimumWidthCm = item.sizeRange ? item.sizeRange.widthMinCm : 0;
    const preferredPlanningWidthCm = item.sizeRange
      ? (item.sizeRange.widthMinCm + item.sizeRange.widthMaxCm) / 2
      : 0;
    const planningDepthCm = item.sizeRange
      ? (item.sizeRange.depthMinCm + item.sizeRange.depthMaxCm) / 2
      : 0;

    if (minimumWidthCm <= 0 || preferredPlanningWidthCm <= 0 || planningDepthCm <= 0) {
      return { ...item };
    }

    const wall = geometry.wallSegments.find((w) => w.id === targetWallId);
    if (!wall) {
      return { ...item };
    }

    const endpoints = getWallEndpoints(geometry, wall);
    const wallLength = getWallLengthCm(geometry, wall);
    if (!endpoints || !wallLength || wallLength <= 1e-6) {
      return { ...item };
    }

    const wallOpenings = openings.filter((op) => op.wallSegmentId === targetWallId);
    const blockedSpans: Span[] = [];

    for (const opening of wallOpenings) {
      if (opening.openingType === "door") {
        blockedSpans.push({
          startCm: Math.max(0, opening.offsetCm - DOOR_EDGE_CLEARANCE_CM),
          endCm: Math.min(wallLength, opening.offsetCm + opening.widthCm + DOOR_EDGE_CLEARANCE_CM),
        });
      }
    }

    const freeSpans = subtractIntervals(wallLength, blockedSpans);
    if (freeSpans.length === 0) {
      return { ...item };
    }

    let spanDistance: number;
    let inwardOffset: number;
    let resolvedPlanningWidthCm: number;

    if (isAgainstWall || isNearWall) {
      inwardOffset = isNearWall
        ? NEAR_WALL_GAP_CM + planningDepthCm / 2
        : planningDepthCm / 2;

      const margin = alignment === "CENTERED" ? 0 : WALL_ALIGNMENT_MARGIN_CM;
      const requiredSpan = minimumWidthCm + margin;

      const fittingSpans = freeSpans.filter((span) => (span.endCm - span.startCm) >= requiredSpan);
      if (fittingSpans.length === 0) {
        return { ...item };
      }

      const selectedSpan = [...fittingSpans].sort(
        (a, b) => (b.endCm - b.startCm) - (a.endCm - a.startCm) || a.startCm - b.startCm
      )[0];

      const spanLength = selectedSpan.endCm - selectedSpan.startCm;
      const availableWidthCm = spanLength - margin;
      resolvedPlanningWidthCm = Math.min(preferredPlanningWidthCm, availableWidthCm);

      if (alignment === "CENTERED") {
        spanDistance = (selectedSpan.startCm + selectedSpan.endCm) / 2;
      } else if (alignment === "LEFT_ALIGNED") {
        spanDistance = selectedSpan.startCm + WALL_ALIGNMENT_MARGIN_CM + resolvedPlanningWidthCm / 2;
      } else {
        spanDistance = selectedSpan.endCm - (WALL_ALIGNMENT_MARGIN_CM + resolvedPlanningWidthCm / 2);
      }
    } else {
      // isCornerPlacement
      inwardOffset = planningDepthCm / 2;
      const requiredSpan = minimumWidthCm + CORNER_ALIGNMENT_MARGIN_CM;

      if (alignment === "LEFT_ALIGNED") {
        const cornerSpan = freeSpans.find(
          (span) => span.startCm <= 1e-6 && span.endCm >= requiredSpan
        );
        if (!cornerSpan) {
          return { ...item };
        }
        const availableWidthCm = cornerSpan.endCm - cornerSpan.startCm - CORNER_ALIGNMENT_MARGIN_CM;
        resolvedPlanningWidthCm = Math.min(preferredPlanningWidthCm, availableWidthCm);
        spanDistance = cornerSpan.startCm + CORNER_ALIGNMENT_MARGIN_CM + resolvedPlanningWidthCm / 2;
      } else {
        const cornerSpan = freeSpans.find(
          (span) => span.endCm >= wallLength - 1e-6 && span.startCm <= wallLength - requiredSpan
        );
        if (!cornerSpan) {
          return { ...item };
        }
        const availableWidthCm = cornerSpan.endCm - cornerSpan.startCm - CORNER_ALIGNMENT_MARGIN_CM;
        resolvedPlanningWidthCm = Math.min(preferredPlanningWidthCm, availableWidthCm);
        spanDistance = cornerSpan.endCm - (CORNER_ALIGNMENT_MARGIN_CM + resolvedPlanningWidthCm / 2);
      }
    }

    const unitX = (endpoints.end.xCm - endpoints.start.xCm) / wallLength;
    const unitY = (endpoints.end.yCm - endpoints.start.yCm) / wallLength;

    const wallPointX = endpoints.start.xCm + unitX * spanDistance;
    const wallPointY = endpoints.start.yCm + unitY * spanDistance;

    const inwardNormal = findInwardNormal(
      { xCm: wallPointX, yCm: wallPointY },
      unitX,
      unitY,
      geometry.vertices,
    );

    if (!inwardNormal) {
      return { ...item };
    }

    const normalLength = Math.hypot(inwardNormal.xCm, inwardNormal.yCm);
    if (normalLength <= 1e-6) {
      return { ...item };
    }

    const approximatePosition = {
      xCm: Math.round((wallPointX + inwardNormal.xCm * inwardOffset) * 100) / 100,
      yCm: Math.round((wallPointY + inwardNormal.yCm * inwardOffset) * 100) / 100,
    };

    if (!isPointInsideOrOnPolygon(approximatePosition, geometry.vertices)) {
      return { ...item };
    }

    const preferredOrientationDegrees = normalizeOrientationDegrees(
      (Math.atan2(-inwardNormal.xCm, inwardNormal.yCm) * 180) / Math.PI,
    );

    planningWidthsById?.set(item.id, resolvedPlanningWidthCm);

    // Wall-derived position and orientation remain authoritative; relationships do not override them
    return {
      ...item,
      placement: {
        preferredZone: item.semanticPlacement.zoneId ?? item.placement.preferredZone ?? null,
        anchorWallId: targetWallId,
        approximatePosition,
        preferredOrientationDegrees,
      },
    };
  }

  // Case B: FLOATING mode with relational placement
  if (mode === "FLOATING") {
    const effective = getEffectiveRelationships(relationships ?? []);
    if (!effective) return { ...item };
    const { positional: posRel, faces: facesRel } = effective;

    if (!posRel && !facesRel) {
      return { ...item };
    }

    if (!resolvedItemsById) {
      return { ...item };
    }

    const isValidSizeRange = (sr: FurniturePlanItemV11["sizeRange"]) =>
      sr &&
      Number.isFinite(sr.widthMinCm) &&
      Number.isFinite(sr.widthMaxCm) &&
      Number.isFinite(sr.depthMinCm) &&
      Number.isFinite(sr.depthMaxCm) &&
      sr.widthMinCm > 0 &&
      sr.widthMaxCm > 0 &&
      sr.depthMinCm > 0 &&
      sr.depthMaxCm > 0 &&
      sr.widthMinCm <= sr.widthMaxCm &&
      sr.depthMinCm <= sr.depthMaxCm;

    if (posRel) {
      if (posRel.targetItemId === item.id) {
        return { ...item };
      }
      const targetItem = resolvedItemsById.get(posRel.targetItemId);
      if (
        !targetItem ||
        !targetItem.placement.approximatePosition ||
        targetItem.placement.preferredOrientationDegrees === null ||
        !Number.isFinite(targetItem.placement.approximatePosition.xCm) ||
        !Number.isFinite(targetItem.placement.approximatePosition.yCm) ||
        !Number.isFinite(targetItem.placement.preferredOrientationDegrees) ||
        !isValidSizeRange(targetItem.sizeRange) ||
        !isValidSizeRange(item.sizeRange)
      ) {
        return { ...item };
      }

      const sourceWidth = (item.sizeRange.widthMinCm + item.sizeRange.widthMaxCm) / 2;
      const sourceDepth = (item.sizeRange.depthMinCm + item.sizeRange.depthMaxCm) / 2;
      const targetWidth = planningWidthsById?.get(targetItem.id)
        ?? (targetItem.sizeRange.widthMinCm + targetItem.sizeRange.widthMaxCm) / 2;
      const targetDepth = (targetItem.sizeRange.depthMinCm + targetItem.sizeRange.depthMaxCm) / 2;
      const targetCenter = targetItem.placement.approximatePosition;
      const targetTheta = targetItem.placement.preferredOrientationDegrees;

      let sourceCenter: { xCm: number; yCm: number } | null = null;
      let orientationDegrees = targetTheta;

      if (posRel.type === "IN_FRONT_OF") {
        const targetFrontUnit = findTargetFrontUnit(targetItem, geometry);
        if (!targetFrontUnit) {
          return { ...item };
        }

        const distance = targetDepth / 2 + IN_FRONT_OF_GAP_CM + sourceDepth / 2;
        const candidateCenter = {
          xCm: Math.round((targetCenter.xCm + targetFrontUnit.xCm * distance) * 100) / 100,
          yCm: Math.round((targetCenter.yCm + targetFrontUnit.yCm * distance) * 100) / 100,
        };

        if (!isPointInsideOrOnPolygon(candidateCenter, geometry.vertices)) {
          return { ...item };
        }
        sourceCenter = candidateCenter;
      } else if (posRel.type === "ADJACENT_TO") {
        const thetaRad = (targetTheta * Math.PI) / 180;
        const targetWidthAxis = { xCm: Math.cos(thetaRad), yCm: Math.sin(thetaRad) };
        const distance = targetWidth / 2 + ADJACENT_GAP_CM + sourceWidth / 2;

        const posA = {
          xCm: Math.round((targetCenter.xCm + targetWidthAxis.xCm * distance) * 100) / 100,
          yCm: Math.round((targetCenter.yCm + targetWidthAxis.yCm * distance) * 100) / 100,
        };
        const posB = {
          xCm: Math.round((targetCenter.xCm - targetWidthAxis.xCm * distance) * 100) / 100,
          yCm: Math.round((targetCenter.yCm - targetWidthAxis.yCm * distance) * 100) / 100,
        };

        const validA = isPointInsideOrOnPolygon(posA, geometry.vertices);
        const validB = isPointInsideOrOnPolygon(posB, geometry.vertices);

        if (validA && !validB) {
          sourceCenter = posA;
        } else if (validB && !validA) {
          sourceCenter = posB;
        } else if (validA && validB) {
          // Documented stable geometric tie-breaker:
          // choose candidate with smaller x coordinate; if equal, smaller y coordinate
          if (posA.xCm !== posB.xCm) {
            sourceCenter = posA.xCm < posB.xCm ? posA : posB;
          } else {
            sourceCenter = posA.yCm <= posB.yCm ? posA : posB;
          }
        } else {
          return { ...item };
        }
      }

      if (!sourceCenter) {
        return { ...item };
      }

      // Check if FACES also applies to orientation
      if (facesRel) {
        if (facesRel.targetItemId === item.id) return { ...item };
        const facesTarget = resolvedItemsById.get(facesRel.targetItemId);
        if (
          !facesTarget ||
          !facesTarget.placement.approximatePosition ||
          !Number.isFinite(facesTarget.placement.approximatePosition.xCm) ||
          !Number.isFinite(facesTarget.placement.approximatePosition.yCm)
        ) return { ...item };
        const facesAngle = computeFacesOrientation(sourceCenter, facesTarget.placement.approximatePosition);
        if (facesAngle === null) return { ...item };
        orientationDegrees = facesAngle;
      }

      return {
        ...item,
        placement: {
          preferredZone: item.semanticPlacement.zoneId ?? item.placement.preferredZone ?? null,
          anchorWallId: null,
          approximatePosition: sourceCenter,
          preferredOrientationDegrees: orientationDegrees,
        },
      };
    }

    // Case: FACES orientation-only (no positional relationship)
    if (facesRel) {
      if (facesRel.targetItemId === item.id) {
        return { ...item };
      }
      const sourcePos = item.placement.approximatePosition;
      if (
        !sourcePos ||
        !Number.isFinite(sourcePos.xCm) ||
        !Number.isFinite(sourcePos.yCm)
      ) {
        return { ...item };
      }

      const facesTarget = resolvedItemsById.get(facesRel.targetItemId);
      if (
        !facesTarget ||
        !facesTarget.placement.approximatePosition ||
        !Number.isFinite(facesTarget.placement.approximatePosition.xCm) ||
        !Number.isFinite(facesTarget.placement.approximatePosition.yCm)
      ) {
        return { ...item };
      }

      const facesAngle = computeFacesOrientation(
        sourcePos,
        facesTarget.placement.approximatePosition,
      );
      if (facesAngle === null) {
        return { ...item };
      }

      return {
        ...item,
        placement: {
          ...item.placement,
          preferredOrientationDegrees: facesAngle,
        },
      };
    }
  }

  // Case C: CENTERED_IN_ZONE or other unsupported modes preserve compatibility placement
  return { ...item };
}

export function resolveSemanticPlan(
  plan: FurniturePlanV11,
  geometry: RoomGeometry,
  openings: RoomOpening[] = [],
): FurniturePlanV11 {
  const planItemIds = new Set(plan.items.map((item) => item.id));
  if (planItemIds.size !== plan.items.length) return plan;

  const resolvedMap = new Map<string, FurniturePlanItemV11>();
  const eligibleTargets = new Map<string, FurniturePlanItemV11>();
  const statuses = new Map<string, "eligible" | "fallback">();
  const planningWidthsById = new Map<string, number>();
  const pendingItems: FurniturePlanItemV11[] = [];

  const record = (item: FurniturePlanItemV11, resolved: FurniturePlanItemV11, eligible: boolean) => {
    resolvedMap.set(item.id, resolved);
    statuses.set(item.id, eligible ? "eligible" : "fallback");
    if (eligible) eligibleTargets.set(item.id, resolved);
  };

  // Pass 1: Resolve wall-semantic items and independent non-relational items
  for (const item of plan.items) {
    if (!item.semanticPlacement) {
      record(item, { ...item }, true);
      continue;
    }

    const { mode, relationships } = item.semanticPlacement;
    const isWallMode =
      mode === "AGAINST_WALL" || mode === "NEAR_WALL" || mode === "CORNER_PLACEMENT";

    if (isWallMode) {
      const resolved = resolvePlacement(item, geometry, openings, eligibleTargets, planningWidthsById);
      record(item, resolved, resolved.placement !== item.placement);
    } else if (mode === "FLOATING") {
      if (relationships.length > 0) {
        pendingItems.push({ ...item });
      } else {
        record(item, { ...item }, true);
      }
    } else {
      record(item, { ...item }, false);
    }
  }

  // Bounded dependency resolution passes
  while (pendingItems.length > 0) {
    let madeProgress = false;
    const nextPending: FurniturePlanItemV11[] = [];

    for (const item of pendingItems) {
      const effective = getEffectiveRelationships(item.semanticPlacement.relationships);
      if (!effective) {
        record(item, { ...item }, false);
        madeProgress = true;
        continue;
      }
      const { positional: posRel, faces: facesRel } = effective;

      const requiredTargetIds: string[] = [];
      if (posRel) requiredTargetIds.push(posRel.targetItemId);
      if (facesRel) requiredTargetIds.push(facesRel.targetItemId);

      // Check self-reference
      if (requiredTargetIds.some((id) => id === item.id)) {
        record(item, { ...item }, false);
        madeProgress = true;
        continue;
      }

      // Check if target doesn't exist in the plan at all
      if (requiredTargetIds.some((id) => !planItemIds.has(id) || statuses.get(id) === "fallback")) {
        record(item, { ...item }, false);
        madeProgress = true;
        continue;
      }

      // Check if all required targets are resolved
      const allTargetsResolved = requiredTargetIds.every((id) => statuses.get(id) === "eligible");
      if (allTargetsResolved) {
        const resolved = resolvePlacement(item, geometry, openings, eligibleTargets, planningWidthsById);
        record(item, resolved, resolved.placement !== item.placement);
        madeProgress = true;
      } else {
        nextPending.push(item);
      }
    }

    if (!madeProgress) {
      // Deadlock or cycle detected: all remaining items preserve compatibility placement
      for (const item of nextPending) {
        record(item, { ...item }, false);
      }
      break;
    }

    pendingItems.length = 0;
    pendingItems.push(...nextPending);
  }

  return {
    ...plan,
    items: plan.items.map((item) => resolvedMap.get(item.id) ?? { ...item }),
  };
}
