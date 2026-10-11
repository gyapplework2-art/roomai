import { createOrientedRectangle, normalizeRotationDegrees, polygonInsidePolygon, rectanglesOverlapWithPositiveArea, segmentIntersectsPolygon, type Rectangle } from "@/lib/geometry/polygons";
import { getOpeningWorldPosition } from "@/lib/geometry/openings";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";
import type { Tables } from "@/types/database.types";

type FloorPlanSourceObject = Pick<Tables<"design_objects">,
  "id" | "object_type" | "category" | "name" | "x_cm" | "y_cm" | "width_cm" | "depth_cm" | "rotation_degrees"
>;

export type FloorPlanObject = {
  objectRef: string;
  category: string | null;
  label: string;
  xCm: number;
  yCm: number;
  widthCm: number;
  depthCm: number;
  rotationDegrees: number;
  footprint: Rectangle;
};

export type FloorPlanProjection = {
  objects: FloorPlanObject[];
  skipped: Array<{ objectRef: string; label: string; reason: "invalid_position" | "invalid_dimensions" | "invalid_rotation" }>;
};

export function projectFloorPlanObjects(
  source: readonly FloorPlanSourceObject[],
  labelsByObjectId: ReadonlyMap<string, string> = new Map(),
): FloorPlanProjection {
  const result: FloorPlanProjection = { objects: [], skipped: [] };
  for (const object of source) {
    if (object.object_type !== "furniture") continue;
    const label = labelsByObjectId.get(object.id)?.trim() || object.name?.trim() || object.category?.trim() || "Furniture";
    const positionValid = object.x_cm !== null && Number.isFinite(object.x_cm)
      && object.y_cm !== null && Number.isFinite(object.y_cm);
    const dimensionsValid = object.width_cm !== null && Number.isFinite(object.width_cm) && object.width_cm > 0
      && object.depth_cm !== null && Number.isFinite(object.depth_cm) && object.depth_cm > 0;
    const reason = !positionValid ? "invalid_position"
      : !dimensionsValid ? "invalid_dimensions"
        : !Number.isFinite(object.rotation_degrees) ? "invalid_rotation" : null;
    if (reason) {
      result.skipped.push({ objectRef: object.id, label, reason });
      continue;
    }
    const rotationDegrees = normalizeRotationDegrees(object.rotation_degrees);
    const footprint = createOrientedRectangle(
      { xCm: object.x_cm!, yCm: object.y_cm! }, object.width_cm!, object.depth_cm!, rotationDegrees,
    );
    if (!footprint.every((point) => Number.isFinite(point.xCm) && Number.isFinite(point.yCm))) {
      result.skipped.push({ objectRef: object.id, label, reason: "invalid_dimensions" });
      continue;
    }
    result.objects.push({
      objectRef: object.id, category: object.category, label,
      xCm: object.x_cm!, yCm: object.y_cm!, widthCm: object.width_cm!, depthCm: object.depth_cm!,
      rotationDegrees, footprint,
    });
  }
  return result;
}

export type FloorPlanWarning = { code: "overlap" | "outside_room" | "opening_obstructed"; labels: string[] };

export function detectFloorPlanWarnings(
  objects: readonly FloorPlanObject[], geometry: RoomGeometry, openings: readonly RoomOpening[],
): FloorPlanWarning[] {
  const warnings: FloorPlanWarning[] = [];
  const isRug = (object: FloorPlanObject) => ["rug", "area_rug"].includes(object.category?.trim().toLowerCase() ?? "");
  objects.forEach((object, index) => {
    if (!polygonInsidePolygon(object.footprint, geometry.vertices)) {
      warnings.push({ code: "outside_room", labels: [object.label] });
    }
    for (const other of objects.slice(index + 1)) {
      if (isRug(object) !== isRug(other)) continue;
      if (rectanglesOverlapWithPositiveArea(object.footprint, other.footprint)) {
        warnings.push({ code: "overlap", labels: [object.label, other.label] });
      }
    }
    if (isRug(object)) return;
    for (const opening of openings) {
      const position = getOpeningWorldPosition(geometry, opening);
      if (position && segmentIntersectsPolygon(position.start, position.end, object.footprint)) {
        warnings.push({ code: "opening_obstructed", labels: [object.label, opening.openingType === "door" ? "door" : "window"] });
      }
    }
  });
  return warnings;
}