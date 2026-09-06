import type { RoomGeometry, Vertex, WallSegment } from "@/lib/geometry/types";

export const GEOMETRY_EPSILON = 1e-6;

export type WallOrientation = "horizontal" | "vertical" | "diagonal";

export function getVertexById(geometry: RoomGeometry, vertexId: string): Vertex | undefined {
  return geometry.vertices.find((vertex) => vertex.id === vertexId);
}

export function getWallEndpoints(
  geometry: RoomGeometry,
  wall: WallSegment,
): { start: Vertex; end: Vertex } | undefined {
  const start = getVertexById(geometry, wall.startVertexId);
  const end = getVertexById(geometry, wall.endVertexId);
  return start && end ? { start, end } : undefined;
}

export function getWallLengthCm(geometry: RoomGeometry, wall: WallSegment): number | null {
  const endpoints = getWallEndpoints(geometry, wall);
  if (!endpoints) return null;

  const deltaX = endpoints.end.xCm - endpoints.start.xCm;
  const deltaY = endpoints.end.yCm - endpoints.start.yCm;
  return Math.sqrt(deltaX ** 2 + deltaY ** 2);
}

export function getWallOrientation(geometry: RoomGeometry, wall: WallSegment): WallOrientation {
  const endpoints = getWallEndpoints(geometry, wall);
  if (!endpoints) return "diagonal";

  if (Math.abs(endpoints.start.yCm - endpoints.end.yCm) <= GEOMETRY_EPSILON) {
    return "horizontal";
  }
  if (Math.abs(endpoints.start.xCm - endpoints.end.xCm) <= GEOMETRY_EPSILON) {
    return "vertical";
  }
  return "diagonal";
}

export function getGeometryBounds(geometry: RoomGeometry) {
  const xs = geometry.vertices.map((vertex) => vertex.xCm);
  const ys = geometry.vertices.map((vertex) => vertex.yCm);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
    widthCm: Math.max(...xs) - Math.min(...xs),
    lengthCm: Math.max(...ys) - Math.min(...ys),
  };
}

export function updateWallLength(
  geometry: RoomGeometry,
  wall: WallSegment,
  newLengthCm: number,
): RoomGeometry | null {
  if (!Number.isFinite(newLengthCm) || newLengthCm <= 0) return null;

  const endpoints = getWallEndpoints(geometry, wall);
  if (!endpoints) return null;

  const orientation = getWallOrientation(geometry, wall);
  const nextWallIndex = geometry.wallSegments.findIndex((candidate) => candidate.id === wall.id) + 1;
  const nextWall = geometry.wallSegments[nextWallIndex % geometry.wallSegments.length];
  const nextOrientation = nextWall ? getWallOrientation(geometry, nextWall) : null;
  const oldDeltaX = endpoints.end.xCm - endpoints.start.xCm;
  const oldDeltaY = endpoints.end.yCm - endpoints.start.yCm;
  const oldLength = Math.sqrt(oldDeltaX ** 2 + oldDeltaY ** 2);
  if (oldLength <= GEOMETRY_EPSILON) return null;

  let newEndX = endpoints.start.xCm + (oldDeltaX / oldLength) * newLengthCm;
  let newEndY = endpoints.start.yCm + (oldDeltaY / oldLength) * newLengthCm;

  if (orientation === "horizontal") {
    newEndY = endpoints.start.yCm;
    newEndX = endpoints.start.xCm + Math.sign(oldDeltaX) * newLengthCm;
  } else if (orientation === "vertical") {
    newEndX = endpoints.start.xCm;
    newEndY = endpoints.start.yCm + Math.sign(oldDeltaY) * newLengthCm;
  }

  const vertices = geometry.vertices.map((vertex) => {
    if (vertex.id === wall.endVertexId) {
      return { ...vertex, xCm: newEndX, yCm: newEndY };
    }

    const shouldPropagate = nextWall
      && nextWall.startVertexId === wall.endVertexId
      && ((orientation === "horizontal" && nextOrientation === "vertical")
        || (orientation === "vertical" && nextOrientation === "horizontal"));

    if (shouldPropagate && vertex.id === nextWall.endVertexId) {
      return orientation === "horizontal"
        ? { ...vertex, xCm: newEndX }
        : { ...vertex, yCm: newEndY };
    }

    return { ...vertex };
  });

  return {
    ...geometry,
    templateTransform: { ...geometry.templateTransform },
    vertices,
    wallSegments: geometry.wallSegments.map((wallSegment) => ({ ...wallSegment })),
  };
}

export function wallDisplayLabel(index: number): string {
  if (index < 26) return `Wall ${String.fromCharCode(65 + index)}`;
  return `Wall ${index + 1}`;
}
