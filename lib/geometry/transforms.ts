import { roomGeometrySchema } from "@/lib/geometry/schema";
import type { RoomGeometry } from "@/lib/geometry/types";

function validateGeometry(geometry: RoomGeometry) {
  const result = roomGeometrySchema.safeParse(geometry);
  if (!result.success) throw new Error("Invalid transformed room geometry.");
  return result.data;
}

export function normalizeGeometry(geometry: RoomGeometry): RoomGeometry {
  const minX = Math.min(...geometry.vertices.map((vertex) => vertex.xCm));
  const minY = Math.min(...geometry.vertices.map((vertex) => vertex.yCm));
  return validateGeometry({
    ...geometry,
    vertices: geometry.vertices.map((vertex) => ({
      ...vertex,
      xCm: vertex.xCm - minX,
      yCm: vertex.yCm - minY,
    })),
  });
}

export function rotateGeometry90(geometry: RoomGeometry): RoomGeometry {
  const nextRotation = ((geometry.templateTransform.rotationDegrees + 90) % 360) as 0 | 90 | 180 | 270;
  return normalizeGeometry({
    ...geometry,
    templateTransform: { ...geometry.templateTransform, rotationDegrees: nextRotation },
    vertices: geometry.vertices.map((vertex) => ({
      ...vertex,
      xCm: -vertex.yCm,
      yCm: vertex.xCm,
    })),
  });
}

export function mirrorGeometryHorizontal(geometry: RoomGeometry): RoomGeometry {
  const maxX = Math.max(...geometry.vertices.map((vertex) => vertex.xCm));
  return normalizeGeometry({
    ...geometry,
    templateTransform: {
      ...geometry.templateTransform,
      mirroredHorizontal: !geometry.templateTransform.mirroredHorizontal,
    },
    vertices: geometry.vertices.map((vertex) => ({ ...vertex, xCm: maxX - vertex.xCm })),
  });
}

export function mirrorGeometryVertical(geometry: RoomGeometry): RoomGeometry {
  const maxY = Math.max(...geometry.vertices.map((vertex) => vertex.yCm));
  return normalizeGeometry({
    ...geometry,
    templateTransform: {
      ...geometry.templateTransform,
      mirroredVertical: !geometry.templateTransform.mirroredVertical,
    },
    vertices: geometry.vertices.map((vertex) => ({ ...vertex, yCm: maxY - vertex.yCm })),
  });
}
