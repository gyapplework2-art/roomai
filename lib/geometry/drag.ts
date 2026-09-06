import { getWallEndpoints, getWallOrientation } from "@/lib/geometry/dimensions";
import type { RoomGeometry, WallSegment } from "@/lib/geometry/types";

export type DragPoint = { xCm: number; yCm: number };

export type WallDragConstraint =
  | { kind: "horizontal"; axis: "y" }
  | { kind: "vertical"; axis: "x" }
  | { kind: "diagonal"; normalX: number; normalY: number };

export function getWallDragConstraint(
  geometry: RoomGeometry,
  wall: WallSegment,
): WallDragConstraint | null {
  const endpoints = getWallEndpoints(geometry, wall);
  if (!endpoints) return null;

  const orientation = getWallOrientation(geometry, wall);
  if (orientation === "horizontal") return { kind: "horizontal", axis: "y" };
  if (orientation === "vertical") return { kind: "vertical", axis: "x" };

  const deltaX = endpoints.end.xCm - endpoints.start.xCm;
  const deltaY = endpoints.end.yCm - endpoints.start.yCm;
  const length = Math.sqrt(deltaX ** 2 + deltaY ** 2);
  if (length === 0) return null;

  return {
    kind: "diagonal",
    normalX: -deltaY / length,
    normalY: deltaX / length,
  };
}

export function createDraggedGeometryCandidate(
  geometry: RoomGeometry,
  wall: WallSegment,
  startPointer: DragPoint,
  currentPointer: DragPoint,
): RoomGeometry | null {
  const endpoints = getWallEndpoints(geometry, wall);
  const constraint = getWallDragConstraint(geometry, wall);
  if (!endpoints || !constraint) return null;

  const deltaX = currentPointer.xCm - startPointer.xCm;
  const deltaY = currentPointer.yCm - startPointer.yCm;
  let translationX = 0;
  let translationY = 0;

  if (constraint.kind === "horizontal") translationY = deltaY;
  if (constraint.kind === "vertical") translationX = deltaX;
  if (constraint.kind === "diagonal") {
    const distance = deltaX * constraint.normalX + deltaY * constraint.normalY;
    translationX = constraint.normalX * distance;
    translationY = constraint.normalY * distance;
  }

  return {
    ...geometry,
    templateTransform: { ...geometry.templateTransform },
    vertices: geometry.vertices.map((vertex) => {
      if (vertex.id === wall.startVertexId || vertex.id === wall.endVertexId) {
        return {
          ...vertex,
          xCm: vertex.xCm + translationX,
          yCm: vertex.yCm + translationY,
        };
      }
      return { ...vertex };
    }),
    wallSegments: geometry.wallSegments.map((wallSegment) => ({ ...wallSegment })),
  };
}
