import { GEOMETRY_EPSILON } from "./dimensions";
import { isPointInsideOrOnPolygon } from "./point-in-polygon";
import type { Vertex } from "./types";

export type Point = Pick<Vertex, "xCm" | "yCm">;
export type Rectangle = [Point, Point, Point, Point];

export function normalizeRotationDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

export function createOrientedRectangle(center: Point, widthCm: number, depthCm: number, rotationDegrees: number): Rectangle {
  const angle = normalizeRotationDegrees(rotationDegrees);
  const radians = angle * Math.PI / 180;
  const widthAxis = angle === 0 ? { xCm: 1, yCm: 0 }
    : angle === 90 ? { xCm: 0, yCm: 1 }
    : angle === 180 ? { xCm: -1, yCm: 0 }
    : angle === 270 ? { xCm: 0, yCm: -1 }
    : { xCm: Math.cos(radians), yCm: Math.sin(radians) };
  const depthAxis = { xCm: -widthAxis.yCm, yCm: widthAxis.xCm };
  const halfWidth = widthCm / 2;
  const halfDepth = depthCm / 2;
  return [
    { xCm: center.xCm - widthAxis.xCm * halfWidth - depthAxis.xCm * halfDepth, yCm: center.yCm - widthAxis.yCm * halfWidth - depthAxis.yCm * halfDepth },
    { xCm: center.xCm + widthAxis.xCm * halfWidth - depthAxis.xCm * halfDepth, yCm: center.yCm + widthAxis.yCm * halfWidth - depthAxis.yCm * halfDepth },
    { xCm: center.xCm + widthAxis.xCm * halfWidth + depthAxis.xCm * halfDepth, yCm: center.yCm + widthAxis.yCm * halfWidth + depthAxis.yCm * halfDepth },
    { xCm: center.xCm - widthAxis.xCm * halfWidth + depthAxis.xCm * halfDepth, yCm: center.yCm - widthAxis.yCm * halfWidth + depthAxis.yCm * halfDepth },
  ];
}

function projection(polygon: readonly Point[], axis: Point) {
  const values = polygon.map((point) => point.xCm * axis.xCm + point.yCm * axis.yCm);
  return { min: Math.min(...values), max: Math.max(...values) };
}

export function rectanglesOverlapWithPositiveArea(first: Rectangle, second: Rectangle): boolean {
  const axes = [first, second].flatMap((polygon) => [0, 1].map((index) => {
    const start = polygon[index];
    const end = polygon[index + 1];
    const edge = { xCm: end.xCm - start.xCm, yCm: end.yCm - start.yCm };
    const length = Math.hypot(edge.xCm, edge.yCm);
    return { xCm: -edge.yCm / length, yCm: edge.xCm / length };
  }));
  return axes.every((axis) => {
    const firstProjection = projection(first, axis);
    const secondProjection = projection(second, axis);
    return Math.min(firstProjection.max, secondProjection.max)
      - Math.max(firstProjection.min, secondProjection.min) > GEOMETRY_EPSILON;
  });
}

function pointOnSegment(point: Point, start: Point, end: Point): boolean {
  const length = Math.hypot(end.xCm - start.xCm, end.yCm - start.yCm);
  if (length === 0) return Math.hypot(point.xCm - start.xCm, point.yCm - start.yCm) <= GEOMETRY_EPSILON;
  if (Math.abs(signedDistance(start, end, point)) > GEOMETRY_EPSILON) return false;
  return point.xCm >= Math.min(start.xCm, end.xCm) - GEOMETRY_EPSILON
    && point.xCm <= Math.max(start.xCm, end.xCm) + GEOMETRY_EPSILON
    && point.yCm >= Math.min(start.yCm, end.yCm) - GEOMETRY_EPSILON
    && point.yCm <= Math.max(start.yCm, end.yCm) + GEOMETRY_EPSILON;
}

function signedDistance(first: Point, second: Point, third: Point): number {
  const length = Math.hypot(second.xCm - first.xCm, second.yCm - first.yCm);
  return ((second.xCm - first.xCm) * (third.yCm - first.yCm)
    - (second.yCm - first.yCm) * (third.xCm - first.xCm)) / length;
}

function segmentsIntersect(firstStart: Point, firstEnd: Point, secondStart: Point, secondEnd: Point): boolean {
  const firstA = signedDistance(firstStart, firstEnd, secondStart);
  const firstB = signedDistance(firstStart, firstEnd, secondEnd);
  const secondA = signedDistance(secondStart, secondEnd, firstStart);
  const secondB = signedDistance(secondStart, secondEnd, firstEnd);
  const straddles = (first: number, second: number) =>
    (first > GEOMETRY_EPSILON && second < -GEOMETRY_EPSILON)
      || (first < -GEOMETRY_EPSILON && second > GEOMETRY_EPSILON);
  if (straddles(firstA, firstB) && straddles(secondA, secondB)) return true;
  return (Math.abs(firstA) <= GEOMETRY_EPSILON && pointOnSegment(secondStart, firstStart, firstEnd))
    || (Math.abs(firstB) <= GEOMETRY_EPSILON && pointOnSegment(secondEnd, firstStart, firstEnd))
    || (Math.abs(secondA) <= GEOMETRY_EPSILON && pointOnSegment(firstStart, secondStart, secondEnd))
    || (Math.abs(secondB) <= GEOMETRY_EPSILON && pointOnSegment(firstEnd, secondStart, secondEnd));
}

export function segmentIntersectsPolygon(start: Point, end: Point, polygon: readonly Point[]): boolean {
  if (isPointInsideOrOnPolygon(start, polygon) || isPointInsideOrOnPolygon(end, polygon)) return true;
  return polygon.some((corner, index) => segmentsIntersect(start, end, corner, polygon[(index + 1) % polygon.length]));
}

export function segmentInsidePolygon(start: Point, end: Point, polygon: readonly Point[]): boolean {
  if (!isPointInsideOrOnPolygon(start, polygon) || !isPointInsideOrOnPolygon(end, polygon)) return false;
  const deltaX = end.xCm - start.xCm;
  const deltaY = end.yCm - start.yCm;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return true;
  const cuts = [0, 1];
  polygon.forEach((boundaryStart, index) => {
    const boundaryEnd = polygon[(index + 1) % polygon.length];
    const boundaryX = boundaryEnd.xCm - boundaryStart.xCm;
    const boundaryY = boundaryEnd.yCm - boundaryStart.yCm;
    const offsetX = boundaryStart.xCm - start.xCm;
    const offsetY = boundaryStart.yCm - start.yCm;
    const denominator = deltaX * boundaryY - deltaY * boundaryX;
    if (denominator === 0) {
      if (Math.abs(signedDistance(start, end, boundaryStart)) <= GEOMETRY_EPSILON) {
        for (const point of [boundaryStart, boundaryEnd]) {
          const distance = ((point.xCm - start.xCm) * deltaX + (point.yCm - start.yCm) * deltaY) / lengthSquared;
          if (distance > 0 && distance < 1) cuts.push(distance);
        }
      }
      return;
    }
    const distance = (offsetX * boundaryY - offsetY * boundaryX) / denominator;
    const boundaryDistance = (offsetX * deltaY - offsetY * deltaX) / denominator;
    if (distance > 0 && distance < 1 && boundaryDistance >= 0 && boundaryDistance <= 1) cuts.push(distance);
  });
  cuts.sort((first, second) => first - second);
  return cuts.slice(1).every((endDistance, index) => {
    const midpoint = (cuts[index] + endDistance) / 2;
    return isPointInsideOrOnPolygon({ xCm: start.xCm + deltaX * midpoint, yCm: start.yCm + deltaY * midpoint }, polygon);
  });
}

export function polygonInsidePolygon(inner: readonly Point[], outer: readonly Point[]): boolean {
  return inner.length >= 3 && inner.every((vertex, index) => segmentInsidePolygon(vertex, inner[(index + 1) % inner.length], outer));
}

function pointSegmentDistance(point: Point, start: Point, end: Point): number {
  const deltaX = end.xCm - start.xCm;
  const deltaY = end.yCm - start.yCm;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.xCm - start.xCm) * deltaX + (point.yCm - start.yCm) * deltaY) / lengthSquared));
  return Math.hypot(point.xCm - (start.xCm + fraction * deltaX), point.yCm - (start.yCm + fraction * deltaY));
}

/** Actual Euclidean boundary distance; intersection/containment/touching is zero within GEOMETRY_EPSILON. */
export function minimumPolygonDistance(first: readonly Point[], second: readonly Point[]): number {
  if (first.length < 3 || second.length < 3) throw new Error("POLYGON_DISTANCE_INVALID");
  if (isPointInsideOrOnPolygon(second[0], first)
    || first.some((vertex, index) => segmentIntersectsPolygon(vertex, first[(index + 1) % first.length], second))) return 0;
  let minimum = Infinity;
  for (const [vertices, edges] of [[first, second], [second, first]]) {
    for (const vertex of vertices) {
      edges.forEach((start, index) => {
        minimum = Math.min(minimum, pointSegmentDistance(vertex, start, edges[(index + 1) % edges.length]));
      });
    }
  }
  return minimum <= GEOMETRY_EPSILON ? 0 : minimum;
}

export function minimumSegmentPolygonDistance(start: Point, end: Point, polygon: readonly Point[]): number {
  if (polygon.length < 3) throw new Error("POLYGON_DISTANCE_INVALID");
  if (segmentIntersectsPolygon(start, end, polygon)) return 0;
  let minimum = Infinity;
  polygon.forEach((vertex, index) => {
    const next = polygon[(index + 1) % polygon.length];
    minimum = Math.min(minimum, pointSegmentDistance(start, vertex, next),
      pointSegmentDistance(end, vertex, next), pointSegmentDistance(vertex, start, end));
  });
  return minimum <= GEOMETRY_EPSILON ? 0 : minimum;
}

export function findInwardNormal(
  wallPoint: Point,
  unitX: number,
  unitY: number,
  vertices: readonly Point[],
): Point | null {
  const normal1 = { xCm: -unitY, yCm: unitX };
  const normal2 = { xCm: unitY, yCm: -unitX };
  for (const delta of [0.5, 1.0, 0.1, 2.0]) {
    const in1 = isPointInsideOrOnPolygon({ xCm: wallPoint.xCm + normal1.xCm * delta, yCm: wallPoint.yCm + normal1.yCm * delta }, vertices);
    const in2 = isPointInsideOrOnPolygon({ xCm: wallPoint.xCm + normal2.xCm * delta, yCm: wallPoint.yCm + normal2.yCm * delta }, vertices);
    if (in1 && !in2) return normal1;
    if (in2 && !in1) return normal2;
  }
  let travel1 = 0;
  let travel2 = 0;
  for (let distance = 0.5; distance <= 200; distance += 0.5) {
    if (!isPointInsideOrOnPolygon({ xCm: wallPoint.xCm + normal1.xCm * distance, yCm: wallPoint.yCm + normal1.yCm * distance }, vertices)) break;
    travel1 = distance;
  }
  for (let distance = 0.5; distance <= 200; distance += 0.5) {
    if (!isPointInsideOrOnPolygon({ xCm: wallPoint.xCm + normal2.xCm * distance, yCm: wallPoint.yCm + normal2.yCm * distance }, vertices)) break;
    travel2 = distance;
  }
  if (travel1 <= 0 && travel2 <= 0) return null;
  if (travel1 > travel2) return normal1;
  if (travel2 > travel1) return normal2;
  return normal1.xCm !== normal2.xCm
    ? normal1.xCm > normal2.xCm ? normal1 : normal2
    : normal1.yCm >= normal2.yCm ? normal1 : normal2;
}