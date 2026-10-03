import { z } from "zod";

import { getGeometryBounds } from "@/lib/geometry/dimensions";
import { isPointInsideOrOnPolygon } from "@/lib/geometry/point-in-polygon";
import { polygonInsidePolygon } from "@/lib/geometry/polygons";
import { vertexSchema } from "@/lib/geometry/schema";
import type { RoomGeometry, Vertex } from "@/lib/geometry/types";
import { validateRoomGeometryStructure } from "@/lib/geometry/validation";

export const zoneTypes = ["PRIMARY_SEATING", "MEDIA", "READING", "STORAGE"] as const;
export const PRIMARY_SEATING_ZONE_ID = "primary-seating";

export const functionalZoneSchema = z.object({
  id: z.string().trim().min(1).max(160),
  type: z.enum(zoneTypes),
  polygon: z.array(vertexSchema).min(3),
  center: z.object({ xCm: z.number().finite(), yCm: z.number().finite() }),
  orientationDegrees: z.number().finite().optional(),
});

export type FunctionalZone = z.infer<typeof functionalZoneSchema>;

function polygonCenter(vertices: Vertex[]) {
  let twiceArea = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    const cross = current.xCm * next.yCm - next.xCm * current.yCm;
    twiceArea += cross;
    weightedX += (current.xCm + next.xCm) * cross;
    weightedY += (current.yCm + next.yCm) * cross;
  }
  if (!Number.isFinite(twiceArea) || Math.abs(twiceArea) <= 1e-6) return null;
  const centroid = { xCm: weightedX / (3 * twiceArea), yCm: weightedY / (3 * twiceArea) };
  if (isPointInsideOrOnPolygon(centroid, vertices)) return centroid;

  const levels = [...new Set(vertices.map((vertex) => vertex.yCm))].sort((first, second) => first - second);
  const candidates: Array<{ xCm: number; yCm: number; widthCm: number }> = [];
  for (let level = 1; level < levels.length; level += 1) {
    const yCm = (levels[level - 1] + levels[level]) / 2;
    const intersections: number[] = [];
    for (let index = 0; index < vertices.length; index += 1) {
      const start = vertices[index];
      const end = vertices[(index + 1) % vertices.length];
      if ((start.yCm > yCm) !== (end.yCm > yCm)) {
        intersections.push(start.xCm + (yCm - start.yCm) * (end.xCm - start.xCm) / (end.yCm - start.yCm));
      }
    }
    intersections.sort((first, second) => first - second);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      candidates.push({ xCm: (intersections[index] + intersections[index + 1]) / 2, yCm, widthCm: intersections[index + 1] - intersections[index] });
    }
  }
  const selected = candidates.sort((first, second) => second.widthCm - first.widthCm || first.xCm - second.xCm || first.yCm - second.yCm)[0];
  return selected ? { xCm: selected.xCm, yCm: selected.yCm } : null;
}

export function isValidFunctionalZone(zone: FunctionalZone, geometry: RoomGeometry): boolean {
  const parsed = functionalZoneSchema.safeParse(zone);
  if (!parsed.success || !validateRoomGeometryStructure(geometry).valid) return false;
  const { polygon, center } = parsed.data;
  const zoneGeometry: RoomGeometry = {
    ...geometry,
    vertices: polygon,
    wallSegments: polygon.map((vertex, index) => ({
      id: `zone-edge-${index + 1}`,
      startVertexId: vertex.id,
      endVertexId: polygon[(index + 1) % polygon.length].id,
    })),
  };
  return validateRoomGeometryStructure(zoneGeometry).valid
    && polygonCenter(polygon) !== null
    && isPointInsideOrOnPolygon(center, polygon)
    && isPointInsideOrOnPolygon(center, geometry.vertices)
    && polygonInsidePolygon(polygon, geometry.vertices);
}

/**
 * A.2.3 bootstrap allocation, not exclusive whole-room seating ownership.
 * The center is an approximate composition reference, not a certification of
 * furniture fit, collision safety, circulation, or final rug placement quality.
 * Later spatial validation/planning may refine the usable seating region.
 */
export function deriveFunctionalZones(geometry: RoomGeometry): FunctionalZone[] {
  if (!validateRoomGeometryStructure(geometry).valid) return [];
  const center = polygonCenter(geometry.vertices);
  if (!center) return [];
  const bounds = getGeometryBounds(geometry);
  const zone: FunctionalZone = {
    id: PRIMARY_SEATING_ZONE_ID,
    type: "PRIMARY_SEATING",
    polygon: geometry.vertices.map((vertex) => ({ ...vertex })),
    center,
    orientationDegrees: bounds.widthCm >= bounds.lengthCm ? 0 : 90,
  };
  return isValidFunctionalZone(zone, geometry) ? [zone] : [];
}