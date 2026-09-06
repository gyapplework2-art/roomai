import { roomGeometrySchema, type shapeTypes } from "@/lib/geometry/schema";
import type { RoomGeometry, Vertex, WallSegment } from "@/lib/geometry/types";

type ShapeType = (typeof shapeTypes)[number];

function createPolygon(
  shapeType: ShapeType,
  points: Array<[number, number]>,
  ceilingHeightCm: number | null,
): RoomGeometry {
  const vertices: Vertex[] = points.map(([xCm, yCm], index) => ({
    id: `v${index + 1}`,
    xCm,
    yCm,
  }));
  const wallSegments: WallSegment[] = vertices.map((vertex, index) => ({
    id: `wall-${index + 1}`,
    startVertexId: vertex.id,
    endVertexId: vertices[(index + 1) % vertices.length].id,
  }));
  const geometry = {
    schemaVersion: "1.0" as const,
    shapeType,
    templateTransform: {
      rotationDegrees: 0 as const,
      mirroredHorizontal: false,
      mirroredVertical: false,
    },
    ceilingHeightCm,
    vertices,
    wallSegments,
  };
  const result = roomGeometrySchema.safeParse(geometry);
  if (!result.success) {
    throw new Error(`Invalid ${shapeType} room geometry template.`);
  }
  return result.data;
}

function dimensions(widthCm: number, lengthCm: number, ceilingHeightCm: number | null) {
  if (!Number.isFinite(widthCm) || widthCm <= 0 || !Number.isFinite(lengthCm) || lengthCm <= 0) {
    throw new Error("Room dimensions must be positive finite numbers.");
  }
  return { widthCm, lengthCm, ceilingHeightCm };
}

export function createRectangleGeometry(widthCm: number, lengthCm: number, ceilingHeightCm: number | null) {
  const { widthCm: width, lengthCm: length, ceilingHeightCm: ceiling } = dimensions(widthCm, lengthCm, ceilingHeightCm);
  return createPolygon("rectangle", [[0, 0], [width, 0], [width, length], [0, length]], ceiling);
}

export function createLShapeGeometry(widthCm: number, lengthCm: number, ceilingHeightCm: number | null) {
  const { widthCm: width, lengthCm: length, ceilingHeightCm: ceiling } = dimensions(widthCm, lengthCm, ceilingHeightCm);
  const notchWidth = width * 0.38;
  const notchLength = length * 0.38;
  return createPolygon("l_shape", [
    [0, 0], [width - notchWidth, 0], [width - notchWidth, notchLength],
    [width, notchLength], [width, length], [0, length],
  ], ceiling);
}

export function createClippedCornerGeometry(widthCm: number, lengthCm: number, ceilingHeightCm: number | null) {
  const { widthCm: width, lengthCm: length, ceilingHeightCm: ceiling } = dimensions(widthCm, lengthCm, ceilingHeightCm);
  const clip = Math.min(width, length) * 0.22;
  return createPolygon("clipped_corner", [[0, 0], [width - clip, 0], [width, clip], [width, length], [0, length]], ceiling);
}

export function createTShapeGeometry(widthCm: number, lengthCm: number, ceilingHeightCm: number | null) {
  const { widthCm: width, lengthCm: length, ceilingHeightCm: ceiling } = dimensions(widthCm, lengthCm, ceilingHeightCm);
  const armDepth = length * 0.28;
  const stemLeft = width * 0.38;
  const stemRight = width * 0.62;
  return createPolygon("t_shape", [
    [0, 0], [width, 0], [width, armDepth], [stemRight, armDepth],
    [stemRight, length], [stemLeft, length], [stemLeft, armDepth], [0, armDepth],
  ], ceiling);
}

export function createUShapeGeometry(widthCm: number, lengthCm: number, ceilingHeightCm: number | null) {
  const { widthCm: width, lengthCm: length, ceilingHeightCm: ceiling } = dimensions(widthCm, lengthCm, ceilingHeightCm);
  const recessLeft = width * 0.35;
  const recessRight = width * 0.65;
  const recessDepth = length * 0.42;
  return createPolygon("u_shape", [
    [0, 0], [width, 0], [width, length], [recessRight, length],
    [recessRight, recessDepth], [recessLeft, recessDepth], [recessLeft, length], [0, length],
  ], ceiling);
}

export function createSteppedGeometry(widthCm: number, lengthCm: number, ceilingHeightCm: number | null) {
  const { widthCm: width, lengthCm: length, ceilingHeightCm: ceiling } = dimensions(widthCm, lengthCm, ceilingHeightCm);
  return createPolygon("stepped", [
    [0, 0], [width * 0.55, 0], [width * 0.55, length * 0.25],
    [width, length * 0.25], [width, length * 0.75], [width * 0.75, length * 0.75],
    [width * 0.75, length], [0, length],
  ], ceiling);
}

export function createRoomGeometryFromTemplate(
  shapeType: ShapeType,
  widthCm: number,
  lengthCm: number,
  ceilingHeightCm: number | null,
): RoomGeometry {
  switch (shapeType) {
    case "rectangle": return createRectangleGeometry(widthCm, lengthCm, ceilingHeightCm);
    case "l_shape": return createLShapeGeometry(widthCm, lengthCm, ceilingHeightCm);
    case "clipped_corner": return createClippedCornerGeometry(widthCm, lengthCm, ceilingHeightCm);
    case "t_shape": return createTShapeGeometry(widthCm, lengthCm, ceilingHeightCm);
    case "u_shape": return createUShapeGeometry(widthCm, lengthCm, ceilingHeightCm);
    case "stepped": return createSteppedGeometry(widthCm, lengthCm, ceilingHeightCm);
  }
}
