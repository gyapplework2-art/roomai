import { getWallEndpoints, getWallLengthCm } from "@/lib/geometry/dimensions";
import { isPointInsideOrOnPolygon } from "@/lib/geometry/point-in-polygon";
import { findInwardNormal } from "@/lib/geometry/polygons";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";
import {
  DOOR_EDGE_CLEARANCE_CM,
} from "@/lib/furniture-planning/room-constraints";
import type { FurniturePlanItemV11, FurniturePlanV11 } from "@/lib/furniture-planning/types";
import { isValidFunctionalZone, type FunctionalZone } from "@/lib/furniture-planning/zones";

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

export function getEffectiveRelationships(relationships: Relationship[]) {
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

export function findTargetFrontUnit(
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

export function computeAdjacentCenters(center: { xCm: number; yCm: number }, degrees: number, targetWidth: number, sourceWidth: number, gapCm = ADJACENT_GAP_CM) {
  const radians = degrees * Math.PI / 180;
  const axis = { xCm: Math.cos(radians), yCm: Math.sin(radians) };
  const distance = targetWidth / 2 + gapCm + sourceWidth / 2;
  return [1, -1].map((side) => ({
    xCm: Math.round((center.xCm + side * axis.xCm * distance) * 100) / 100,
    yCm: Math.round((center.yCm + side * axis.yCm * distance) * 100) / 100,
  }));
}

export function computeInFrontCenter(center: { xCm: number; yCm: number }, front: { xCm: number; yCm: number }, targetDepth: number, sourceDepth: number, gapCm = IN_FRONT_OF_GAP_CM) {
  const distance = targetDepth / 2 + gapCm + sourceDepth / 2;
  return {
    xCm: Math.round((center.xCm + front.xCm * distance) * 100) / 100,
    yCm: Math.round((center.yCm + front.yCm * distance) * 100) / 100,
  };
}

export function resolveSemanticPlacement(
  item: FurniturePlanItemV11,
  geometry: RoomGeometry,
  openings: RoomOpening[] = [],
  resolvedItemsById?: ReadonlyMap<string, FurniturePlanItemV11>,
  zones: readonly FunctionalZone[] = [],
): FurniturePlanItemV11 {
  return resolvePlacement(item, geometry, openings, resolvedItemsById, undefined, zones);
}

function resolvePlacement(
  item: FurniturePlanItemV11,
  geometry: RoomGeometry,
  openings: RoomOpening[] = [],
  resolvedItemsById?: ReadonlyMap<string, FurniturePlanItemV11>,
  planningWidthsById?: Map<string, number>,
  zones: readonly FunctionalZone[] = [],
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
  if (mode === "FLOATING" || mode === "CENTERED_IN_ZONE") {
    const effective = getEffectiveRelationships(relationships ?? []);
    if (!effective) return { ...item };
    const { positional: posRel, faces: facesRel } = effective;

    let basePlacement = item.placement;
    if (mode === "CENTERED_IN_ZONE" && !posRel) {
      const matchingZones = zones.filter((zone) => zone.id === item.semanticPlacement.zoneId);
      if (matchingZones.length !== 1 || !isValidFunctionalZone(matchingZones[0], geometry)) return { ...item };
      const zone = matchingZones[0];
      basePlacement = {
        preferredZone: zone.id,
        anchorWallId: null,
        approximatePosition: { ...zone.center },
        preferredOrientationDegrees: normalizeOrientationDegrees(zone.orientationDegrees ?? 0),
      };
    }

    if (!posRel && !facesRel) {
      return { ...item, placement: basePlacement };
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

        const candidateCenter = computeInFrontCenter(targetCenter, targetFrontUnit, targetDepth, sourceDepth);

        if (!isPointInsideOrOnPolygon(candidateCenter, geometry.vertices)) {
          return { ...item };
        }
        sourceCenter = candidateCenter;
      } else if (posRel.type === "ADJACENT_TO") {
        const [posA, posB] = computeAdjacentCenters(targetCenter, targetTheta, targetWidth, sourceWidth);

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
      const sourcePos = basePlacement.approximatePosition;
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
          ...basePlacement,
          preferredOrientationDegrees: facesAngle,
        },
      };
    }
  }

  // Case C: unsupported modes preserve compatibility placement
  return { ...item };
}

export function resolveSemanticPlan(
  plan: FurniturePlanV11,
  geometry: RoomGeometry,
  openings: RoomOpening[] = [],
  zones: readonly FunctionalZone[] = [],
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
    } else if (mode === "FLOATING" || mode === "CENTERED_IN_ZONE") {
      if (relationships.length > 0) {
        pendingItems.push({ ...item });
      } else if (mode === "CENTERED_IN_ZONE") {
        const resolved = resolvePlacement(item, geometry, openings, eligibleTargets, planningWidthsById, zones);
        record(item, resolved, resolved.placement !== item.placement);
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
        const resolved = resolvePlacement(item, geometry, openings, eligibleTargets, planningWidthsById, zones);
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
