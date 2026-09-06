import { getWallEndpoints, getWallLengthCm, GEOMETRY_EPSILON } from "@/lib/geometry/dimensions";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";

export type OpeningValidationResult =
  | { valid: true }
  | { valid: false; error: "missing_wall" | "opening_out_of_bounds" | "opening_overlap" | "invalid_opening" };

export function getOpeningEndOffset(opening: RoomOpening) {
  return opening.offsetCm + opening.widthCm;
}

export function getOpeningWallEndpoints(geometry: RoomGeometry, opening: RoomOpening) {
  const wall = geometry.wallSegments.find((segment) => segment.id === opening.wallSegmentId);
  return wall ? getWallEndpoints(geometry, wall) : undefined;
}

export function getOpeningWorldPosition(geometry: RoomGeometry, opening: RoomOpening) {
  const endpoints = getOpeningWallEndpoints(geometry, opening);
  if (!endpoints) return null;
  const length = getWallLengthCm(geometry, {
    id: opening.wallSegmentId,
    startVertexId: endpoints.start.id,
    endVertexId: endpoints.end.id,
  });
  if (!length || length <= GEOMETRY_EPSILON) return null;
  const unitX = (endpoints.end.xCm - endpoints.start.xCm) / length;
  const unitY = (endpoints.end.yCm - endpoints.start.yCm) / length;
  return {
    start: {
      xCm: endpoints.start.xCm + unitX * opening.offsetCm,
      yCm: endpoints.start.yCm + unitY * opening.offsetCm,
    },
    end: {
      xCm: endpoints.start.xCm + unitX * getOpeningEndOffset(opening),
      yCm: endpoints.start.yCm + unitY * getOpeningEndOffset(opening),
    },
  };
}

export function validateOpeningFitsWall(geometry: RoomGeometry, opening: RoomOpening): OpeningValidationResult {
  const wall = geometry.wallSegments.find((segment) => segment.id === opening.wallSegmentId);
  if (!wall) return { valid: false, error: "missing_wall" };
  const length = getWallLengthCm(geometry, wall);
  if (!length || !Number.isFinite(length) || opening.offsetCm < 0 || opening.widthCm <= 0 || opening.heightCm <= 0) {
    return { valid: false, error: "invalid_opening" };
  }
  if (getOpeningEndOffset(opening) > length + GEOMETRY_EPSILON) {
    return { valid: false, error: "opening_out_of_bounds" };
  }
  if (opening.openingType === "window" && (opening.hingeSide !== null || opening.swingDirection !== null)) {
    return { valid: false, error: "invalid_opening" };
  }
  return { valid: true };
}

export function validateRoomOpenings(geometry: RoomGeometry, openings: RoomOpening[]): OpeningValidationResult {
  for (const opening of openings) {
    const result = validateOpeningFitsWall(geometry, opening);
    if (!result.valid) return result;
  }
  for (let firstIndex = 0; firstIndex < openings.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < openings.length; secondIndex += 1) {
      const first = openings[firstIndex];
      const second = openings[secondIndex];
      if (first.wallSegmentId !== second.wallSegmentId) continue;
      if (first.offsetCm < getOpeningEndOffset(second) - GEOMETRY_EPSILON
        && second.offsetCm < getOpeningEndOffset(first) - GEOMETRY_EPSILON) {
        return { valid: false, error: "opening_overlap" };
      }
    }
  }
  return { valid: true };
}

export function adjustOpeningsForTransform(
  previousGeometry: RoomGeometry,
  nextGeometry: RoomGeometry,
  openings: RoomOpening[],
): RoomOpening[] {
  return openings.map((opening) => {
    const previousWall = previousGeometry.wallSegments.find((wall) => wall.id === opening.wallSegmentId);
    const nextWall = nextGeometry.wallSegments.find((wall) => wall.id === opening.wallSegmentId);
    if (!previousWall || !nextWall) return { ...opening };
    const previous = getWallEndpoints(previousGeometry, previousWall);
    const next = getWallEndpoints(nextGeometry, nextWall);
    if (!previous || !next) return { ...opening };
    const previousDx = previous.end.xCm - previous.start.xCm;
    const previousDy = previous.end.yCm - previous.start.yCm;
    const nextDx = next.end.xCm - next.start.xCm;
    const nextDy = next.end.yCm - next.start.yCm;
    const reversed = previousDx * nextDx + previousDy * nextDy < 0;
    return reversed
      ? { ...opening, offsetCm: Math.max(0, getWallLengthCm(previousGeometry, previousWall)! - opening.offsetCm - opening.widthCm) }
      : { ...opening };
  });
}
