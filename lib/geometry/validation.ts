import { roomGeometrySchema } from "@/lib/geometry/schema";
import { GEOMETRY_EPSILON, getWallEndpoints, getWallLengthCm } from "@/lib/geometry/dimensions";
import type { RoomGeometry } from "@/lib/geometry/types";

export type GeometryValidationError =
  | "missing_vertex"
  | "zero_length_wall"
  | "disconnected_wall_chain"
  | "open_polygon"
  | "self_intersection"
  | "invalid_polygon";

export type GeometryValidationResult =
  | { valid: true }
  | { valid: false; error: GeometryValidationError };

type Point = { xCm: number; yCm: number };

function cross(first: Point, second: Point, third: Point) {
  return (second.xCm - first.xCm) * (third.yCm - first.yCm)
    - (second.yCm - first.yCm) * (third.xCm - first.xCm);
}

function between(value: number, first: number, second: number) {
  return value >= Math.min(first, second) - GEOMETRY_EPSILON
    && value <= Math.max(first, second) + GEOMETRY_EPSILON;
}

function pointOnSegment(point: Point, start: Point, end: Point) {
  return Math.abs(cross(start, end, point)) <= GEOMETRY_EPSILON
    && between(point.xCm, start.xCm, end.xCm)
    && between(point.yCm, start.yCm, end.yCm);
}

function segmentsIntersect(firstStart: Point, firstEnd: Point, secondStart: Point, secondEnd: Point) {
  const firstCross = cross(firstStart, firstEnd, secondStart);
  const secondCross = cross(firstStart, firstEnd, secondEnd);
  const thirdCross = cross(secondStart, secondEnd, firstStart);
  const fourthCross = cross(secondStart, secondEnd, firstEnd);

  const properIntersection = ((firstCross > GEOMETRY_EPSILON && secondCross < -GEOMETRY_EPSILON)
    || (firstCross < -GEOMETRY_EPSILON && secondCross > GEOMETRY_EPSILON))
    && ((thirdCross > GEOMETRY_EPSILON && fourthCross < -GEOMETRY_EPSILON)
      || (thirdCross < -GEOMETRY_EPSILON && fourthCross > GEOMETRY_EPSILON));

  return properIntersection
    || pointOnSegment(secondStart, firstStart, firstEnd)
    || pointOnSegment(secondEnd, firstStart, firstEnd)
    || pointOnSegment(firstStart, secondStart, secondEnd)
    || pointOnSegment(firstEnd, secondStart, secondEnd);
}

function areAdjacent(firstIndex: number, secondIndex: number, count: number) {
  return secondIndex === firstIndex + 1 || (firstIndex === 0 && secondIndex === count - 1);
}

export function validateRoomGeometryStructure(geometry: RoomGeometry): GeometryValidationResult {
  const schemaResult = roomGeometrySchema.safeParse(geometry);
  if (!schemaResult.success) return { valid: false, error: "invalid_polygon" };

  const vertexIds = new Set(geometry.vertices.map((vertex) => vertex.id));
  if (vertexIds.size < 3) return { valid: false, error: "invalid_polygon" };

  for (const wall of geometry.wallSegments) {
    if (!vertexIds.has(wall.startVertexId) || !vertexIds.has(wall.endVertexId)) {
      return { valid: false, error: "missing_vertex" };
    }
    if ((getWallLengthCm(geometry, wall) ?? 0) <= GEOMETRY_EPSILON) {
      return { valid: false, error: "zero_length_wall" };
    }
  }

  for (let index = 0; index < geometry.wallSegments.length; index += 1) {
    const current = geometry.wallSegments[index];
    const next = geometry.wallSegments[(index + 1) % geometry.wallSegments.length];
    if (current.endVertexId !== next.startVertexId) {
      return {
        valid: false,
        error: index === geometry.wallSegments.length - 1 ? "open_polygon" : "disconnected_wall_chain",
      };
    }
  }

  const endpoints = geometry.wallSegments.map((wall) => getWallEndpoints(geometry, wall) as { start: Point; end: Point });
  for (let firstIndex = 0; firstIndex < endpoints.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < endpoints.length; secondIndex += 1) {
      if (areAdjacent(firstIndex, secondIndex, endpoints.length)) continue;
      if (segmentsIntersect(
        endpoints[firstIndex].start,
        endpoints[firstIndex].end,
        endpoints[secondIndex].start,
        endpoints[secondIndex].end,
      )) {
        return { valid: false, error: "self_intersection" };
      }
    }
  }

  return { valid: true };
}
