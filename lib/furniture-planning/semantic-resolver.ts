import { getWallEndpoints, getWallLengthCm } from "@/lib/geometry/dimensions";
import { isPointInsideOrOnPolygon } from "@/lib/geometry/point-in-polygon";
import type { RoomGeometry, RoomOpening, Vertex } from "@/lib/geometry/types";
import {
  DOOR_EDGE_CLEARANCE_CM,
} from "@/lib/furniture-planning/room-constraints";
import type { FurniturePlanItemV11, FurniturePlanV11 } from "@/lib/furniture-planning/types";

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
): { xCm: number; yCm: number } {
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

  return travel1 >= travel2 ? normal1 : normal2;
}

export function resolveSemanticPlacement(
  item: FurniturePlanItemV11,
  geometry: RoomGeometry,
  openings: RoomOpening[] = [],
): FurniturePlanItemV11 {
  if (!("semanticPlacement" in item) || !item.semanticPlacement) {
    return { ...item };
  }

  const { mode, alignment, targetWallId } = item.semanticPlacement;

  // Vertical slice: AGAINST_WALL + targetWallId + CENTERED
  if (mode !== "AGAINST_WALL" || alignment !== "CENTERED" || !targetWallId) {
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

  const itemWidthMin = item.sizeRange ? item.sizeRange.widthMinCm : 0;
  const fittingSpans = freeSpans.filter((span) => (span.endCm - span.startCm) >= itemWidthMin);
  const candidateSpans = fittingSpans.length > 0 ? fittingSpans : freeSpans;

  // Pick the largest span
  const selectedSpan = [...candidateSpans].sort(
    (a, b) => (b.endCm - b.startCm) - (a.endCm - a.startCm)
  )[0];

  const spanCenter = (selectedSpan.startCm + selectedSpan.endCm) / 2;
  const unitX = (endpoints.end.xCm - endpoints.start.xCm) / wallLength;
  const unitY = (endpoints.end.yCm - endpoints.start.yCm) / wallLength;

  const wallPointX = endpoints.start.xCm + unitX * spanCenter;
  const wallPointY = endpoints.start.yCm + unitY * spanCenter;

  const inwardNormal = findInwardNormal(
    { xCm: wallPointX, yCm: wallPointY },
    unitX,
    unitY,
    geometry.vertices,
  );

  const preferredOrientationDegrees = Math.round(
    ((Math.atan2(-inwardNormal.xCm, inwardNormal.yCm) * 180) / Math.PI + 360) % 360,
  );

  const depth = item.sizeRange ? (item.sizeRange.depthMinCm + item.sizeRange.depthMaxCm) / 2 : 0;
  const halfDepth = depth / 2;

  const approximatePosition = {
    xCm: Math.round((wallPointX + inwardNormal.xCm * halfDepth) * 100) / 100,
    yCm: Math.round((wallPointY + inwardNormal.yCm * halfDepth) * 100) / 100,
  };

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

export function resolveSemanticPlan(
  plan: FurniturePlanV11,
  geometry: RoomGeometry,
  openings: RoomOpening[] = [],
): FurniturePlanV11 {
  return {
    ...plan,
    items: plan.items.map((item) => resolveSemanticPlacement(item, geometry, openings)),
  };
}
