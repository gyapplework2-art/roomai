import { getWallEndpoints, getWallLengthCm } from "@/lib/geometry/dimensions";
import { isPointInsideOrOnPolygon } from "@/lib/geometry/point-in-polygon";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";
import type { FurniturePlanItem } from "@/lib/furniture-planning/types";
import type { NormalizedFurniturePlan, NormalizedPlanItem } from "@/lib/furniture-planning/normalize-plan";

export const DOOR_EDGE_CLEARANCE_CM = 15;
export const WINDOW_SILL_CLEARANCE_CM = 10;
export const WALL_EDGE_MARGIN_CM = 5;
export const ROOM_DEPTH_MARGIN_CM = 10;

type Span = { startCm: number; endCm: number };
export type RoomConstraintConflict = {
  dimension: "width" | "depth" | "height";
  marketSearchRange: FurniturePlanItem["sizeRange"];
  roomAllowedRange: FurniturePlanItem["sizeRange"];
  reason: string;
};

export type RoomConstrainedPlanItem = NormalizedPlanItem & {
  roomConstraint: {
    selectedWallId: string | null;
    selectedSpan: Span | null;
    maxWidthCm: number | null;
    maxDepthCm: number | null;
    maxHeightCm: number | null;
    notes: string[];
  } | null;
  finalSearchRange: FurniturePlanItem["sizeRange"] | null;
  roomStatus: "ready" | "unsupported_category" | "market_range_conflict" | "missing_placement" | "invalid_anchor_wall" | "room_conflict" | "needs_replan";
  roomConflict?: RoomConstraintConflict;
};

export type RoomConstrainedPlan = Omit<NormalizedFurniturePlan, "items"> & { items: RoomConstrainedPlanItem[] };

function subtractIntervals(lengthCm: number, blocked: Span[]) {
  const sorted = [...blocked].sort((first, second) => first.startCm - second.startCm);
  const merged: Span[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (previous && interval.startCm <= previous.endCm) previous.endCm = Math.max(previous.endCm, interval.endCm);
    else merged.push({ ...interval });
  }
  const free: Span[] = [];
  let cursor = 0;
  for (const interval of merged) {
    if (interval.startCm > cursor) free.push({ startCm: cursor, endCm: interval.startCm });
    cursor = Math.max(cursor, interval.endCm);
  }
  if (cursor < lengthCm) free.push({ startCm: cursor, endCm: lengthCm });
  return free.filter((span) => span.endCm > span.startCm);
}

function wallDistanceToBoundary(geometry: RoomGeometry, wallId: string, distanceCm: number, inwardSign: 1 | -1) {
  const wall = geometry.wallSegments.find((candidate) => candidate.id === wallId);
  if (!wall) return null;
  const endpoints = getWallEndpoints(geometry, wall);
  if (!endpoints) return null;
  const length = getWallLengthCm(geometry, wall) ?? 0;
  const unitX = (endpoints.end.xCm - endpoints.start.xCm) / length;
  const unitY = (endpoints.end.yCm - endpoints.start.yCm) / length;
  const normalX = -unitY * inwardSign;
  const normalY = unitX * inwardSign;
  const anchor = {
    xCm: endpoints.start.xCm + unitX * distanceCm,
    yCm: endpoints.start.yCm + unitY * distanceCm,
  };
  const step = 0.05;
  let traveled = step;
  while (traveled < Math.max(geometry.vertices.length * 10000, length * 20)) {
    const point = { xCm: anchor.xCm + normalX * traveled, yCm: anchor.yCm + normalY * traveled };
    if (!isPointInsideOrOnPolygon(point, geometry.vertices)) return traveled;
    traveled += step;
  }
  return null;
}

function getInwardDepth(geometry: RoomGeometry, wallId: string, distanceCm: number) {
  const wall = geometry.wallSegments.find((candidate) => candidate.id === wallId);
  if (!wall) return null;
  const endpoints = getWallEndpoints(geometry, wall);
  if (!endpoints) return null;
  const candidates = [wallDistanceToBoundary(geometry, wallId, distanceCm, 1), wallDistanceToBoundary(geometry, wallId, distanceCm, -1)].filter((value): value is number => value !== null);
  return candidates.length ? Math.max(...candidates) - ROOM_DEPTH_MARGIN_CM : null;
}

function intersectSizeRanges(base: FurniturePlanItem["sizeRange"], maxWidthCm: number | null, maxDepthCm: number | null, maxHeightCm: number | null) {
  const roomRange = {
    widthMinCm: 0,
    widthMaxCm: maxWidthCm ?? base.widthMaxCm,
    depthMinCm: 0,
    depthMaxCm: maxDepthCm ?? base.depthMaxCm,
    heightMinCm: 0,
    heightMaxCm: maxHeightCm ?? base.heightMaxCm,
  };
  const dimensions = ["width", "depth", "height"] as const;
  for (const dimension of dimensions) {
    const minKey = `${dimension}MinCm` as keyof typeof base;
    const maxKey = `${dimension}MaxCm` as keyof typeof base;
    if (base[minKey] > roomRange[maxKey]) return { range: null, conflict: dimension, roomRange };
  }
  return {
    range: {
      widthMinCm: base.widthMinCm,
      widthMaxCm: Math.min(base.widthMaxCm, roomRange.widthMaxCm),
      depthMinCm: base.depthMinCm,
      depthMaxCm: Math.min(base.depthMaxCm, roomRange.depthMaxCm),
      heightMinCm: base.heightMinCm,
      heightMaxCm: Math.min(base.heightMaxCm, roomRange.heightMaxCm),
    },
    conflict: null,
    roomRange,
  };
}

function rayDistanceToBoundary(
  origin: { xCm: number; yCm: number },
  direction: { xCm: number; yCm: number },
  vertices: RoomGeometry["vertices"],
): number | null {
  let nearestDistance: number | null = null;

  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    const edgeX = end.xCm - start.xCm;
    const edgeY = end.yCm - start.yCm;
    const denominator = edgeX * direction.yCm - edgeY * direction.xCm;
    if (Math.abs(denominator) <= 1e-6) continue;

    const numerator = (origin.xCm - start.xCm) * edgeY - (origin.yCm - start.yCm) * edgeX;
    const distance = numerator / denominator;
    if (distance <= 1e-6) continue;

    const hitX = origin.xCm + direction.xCm * distance;
    const hitY = origin.yCm + direction.yCm * distance;
    const edgeLengthSquared = edgeX * edgeX + edgeY * edgeY;
    if (edgeLengthSquared <= 1e-6) continue;
    const segmentRatio = ((hitX - start.xCm) * edgeX + (hitY - start.yCm) * edgeY) / edgeLengthSquared;
    if (segmentRatio < -1e-6 || segmentRatio > 1 + 1e-6) continue;

    const candidateDistance = Math.hypot(hitX - origin.xCm, hitY - origin.yCm);
    if (candidateDistance <= 1e-6) continue;
    nearestDistance = nearestDistance === null ? candidateDistance : Math.min(nearestDistance, candidateDistance);
  }

  return nearestDistance;
}

function getFreestandingLocalEnvelope(
  point: { xCm: number; yCm: number },
  geometry: RoomGeometry,
  preferredOrientationDegrees: number | null,
) {
  const widthAxis = preferredOrientationDegrees === null || !Number.isFinite(preferredOrientationDegrees)
    ? { xCm: 1, yCm: 0 }
    : {
        xCm: Math.cos((preferredOrientationDegrees * Math.PI) / 180),
        yCm: Math.sin((preferredOrientationDegrees * Math.PI) / 180),
      };
  const depthAxis = preferredOrientationDegrees === null || !Number.isFinite(preferredOrientationDegrees)
    ? { xCm: 0, yCm: 1 }
    : {
        xCm: -Math.sin((preferredOrientationDegrees * Math.PI) / 180),
        yCm: Math.cos((preferredOrientationDegrees * Math.PI) / 180),
      };

  const negativeWidth = rayDistanceToBoundary(point, { xCm: -widthAxis.xCm, yCm: -widthAxis.yCm }, geometry.vertices);
  const positiveWidth = rayDistanceToBoundary(point, { xCm: widthAxis.xCm, yCm: widthAxis.yCm }, geometry.vertices);
  const negativeDepth = rayDistanceToBoundary(point, { xCm: -depthAxis.xCm, yCm: -depthAxis.yCm }, geometry.vertices);
  const positiveDepth = rayDistanceToBoundary(point, { xCm: depthAxis.xCm, yCm: depthAxis.yCm }, geometry.vertices);

  if (negativeWidth === null || positiveWidth === null || negativeDepth === null || positiveDepth === null) {
    return null;
  }

  const maxWidthCm = Math.max(0, negativeWidth + positiveWidth - ROOM_DEPTH_MARGIN_CM * 2);
  const maxDepthCm = Math.max(0, negativeDepth + positiveDepth - ROOM_DEPTH_MARGIN_CM * 2);

  return {
    maxWidthCm,
    maxDepthCm,
    notes: [
      "Local envelope derived from approximate position and room polygon.",
      preferredOrientationDegrees === null || !Number.isFinite(preferredOrientationDegrees)
        ? "No orientation supplied; world X/Y axes were used for the local envelope fallback."
        : "Furniture orientation was used to derive local width and depth axes.",
    ],
  };
}

export function constrainFurniturePlanToRoom(
  normalizedPlan: NormalizedFurniturePlan,
  geometry: RoomGeometry,
  openings: RoomOpening[],
): RoomConstrainedPlan {
  return {
    ...normalizedPlan,
    items: normalizedPlan.items.map((normalizedItem) => {
      if (normalizedItem.status === "unsupported_category") return { ...normalizedItem, roomConstraint: null, finalSearchRange: null, roomStatus: "unsupported_category" };
      if (normalizedItem.status === "range_conflict") return { ...normalizedItem, roomConstraint: null, finalSearchRange: null, roomStatus: "market_range_conflict" };
      const item = normalizedItem.item;
      const anchorWallId = item.placement.anchorWallId;
      if (!anchorWallId) {
        if (!item.placement.approximatePosition) {
          return { ...normalizedItem, roomConstraint: null, finalSearchRange: null, roomStatus: "missing_placement" };
        }
        if (!isPointInsideOrOnPolygon(item.placement.approximatePosition, geometry.vertices)) {
          return { ...normalizedItem, roomConstraint: null, finalSearchRange: null, roomStatus: "needs_replan" };
        }

        const localEnvelope = getFreestandingLocalEnvelope(item.placement.approximatePosition, geometry, item.placement.preferredOrientationDegrees);
        if (!localEnvelope) {
          return { ...normalizedItem, roomConstraint: null, finalSearchRange: null, roomStatus: "needs_replan" };
        }

        const intersected = intersectSizeRanges(normalizedItem.searchRange!, localEnvelope.maxWidthCm, localEnvelope.maxDepthCm, null);
        if (!intersected.range) {
          return {
            ...normalizedItem,
            roomConstraint: {
              selectedWallId: null,
              selectedSpan: null,
              maxWidthCm: localEnvelope.maxWidthCm,
              maxDepthCm: localEnvelope.maxDepthCm,
              maxHeightCm: null,
              notes: localEnvelope.notes,
            },
            finalSearchRange: null,
            roomStatus: "room_conflict",
            roomConflict: {
              dimension: intersected.conflict,
              marketSearchRange: normalizedItem.searchRange!,
              roomAllowedRange: intersected.roomRange,
              reason: "The local room envelope is too narrow for the market search range.",
            },
          };
        }

        return {
          ...normalizedItem,
          roomConstraint: {
            selectedWallId: null,
            selectedSpan: null,
            maxWidthCm: localEnvelope.maxWidthCm,
            maxDepthCm: localEnvelope.maxDepthCm,
            maxHeightCm: null,
            notes: localEnvelope.notes,
          },
          finalSearchRange: intersected.range,
          roomStatus: "ready",
        };
      }

      const wall = geometry.wallSegments.find((candidate) => candidate.id === anchorWallId);
      if (!wall) return { ...normalizedItem, roomConstraint: null, finalSearchRange: null, roomStatus: "invalid_anchor_wall" };
      const wallLength = getWallLengthCm(geometry, wall) ?? 0;
      const blocked = openings.filter((opening) => opening.wallSegmentId === anchorWallId).flatMap((opening) => {
        const margin = opening.openingType === "door" ? DOOR_EDGE_CLEARANCE_CM : normalizedItem.searchRange && normalizedItem.searchRange.heightMaxCm > 0 ? WINDOW_SILL_CLEARANCE_CM : 0;
        return [{ startCm: Math.max(0, opening.offsetCm - margin), endCm: Math.min(wallLength, opening.offsetCm + opening.widthCm + margin) }];
      });
      const freeSpans = subtractIntervals(wallLength, blocked);
      if (!freeSpans.length) return { ...normalizedItem, roomConstraint: { selectedWallId: anchorWallId, selectedSpan: null, maxWidthCm: 0, maxDepthCm: 0, maxHeightCm: null, notes: ["No usable span remains on the anchor wall."] }, finalSearchRange: null, roomStatus: "room_conflict" };
      let targetDistance = wallLength / 2;
      if (item.placement.approximatePosition) {
        const endpoints = getWallEndpoints(geometry, wall);
        if (endpoints) {
          const dx = item.placement.approximatePosition.xCm - endpoints.start.xCm;
          const dy = item.placement.approximatePosition.yCm - endpoints.start.yCm;
          targetDistance = Math.max(0, Math.min(wallLength, (dx * (endpoints.end.xCm - endpoints.start.xCm) + dy * (endpoints.end.yCm - endpoints.start.yCm)) / wallLength));
        }
      }
      const selectedSpan = freeSpans.find((span) => targetDistance >= span.startCm && targetDistance <= span.endCm) ?? [...freeSpans].sort((a, b) => Math.abs((a.startCm + a.endCm) / 2 - targetDistance) - Math.abs((b.startCm + b.endCm) / 2 - targetDistance))[0];
      const maxWidthCm = Math.max(0, selectedSpan.endCm - selectedSpan.startCm - WALL_EDGE_MARGIN_CM * 2);
      const maxDepthCm = getInwardDepth(geometry, anchorWallId, (selectedSpan.startCm + selectedSpan.endCm) / 2);
      const intersected = intersectSizeRanges(normalizedItem.searchRange!, maxWidthCm, maxDepthCm, null);
      if (!intersected.range) return { ...normalizedItem, roomConstraint: { selectedWallId: anchorWallId, selectedSpan, maxWidthCm, maxDepthCm, maxHeightCm: null, notes: ["The usable room span is narrower than the market search range."] }, finalSearchRange: null, roomStatus: "room_conflict", roomConflict: { dimension: intersected.conflict, marketSearchRange: normalizedItem.searchRange!, roomAllowedRange: intersected.roomRange, reason: "The usable room span is too narrow." } };
      return { ...normalizedItem, roomConstraint: { selectedWallId: anchorWallId, selectedSpan, maxWidthCm, maxDepthCm, maxHeightCm: null, notes: [] }, finalSearchRange: intersected.range, roomStatus: "ready" };
    }),
  };
}
