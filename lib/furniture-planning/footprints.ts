import { z } from "zod";

import { createOrientedRectangle, normalizeRotationDegrees, type Point, type Rectangle } from "@/lib/geometry/polygons";
import type { AnyFurniturePlanItem } from "./types";

export type FurnitureFootprint = {
  itemId: string;
  center: Point;
  widthCm: number;
  depthCm: number;
  orientationDegrees: number;
  corners: Rectangle;
  polygon: Rectangle;
};

export type FootprintIssue = "MISSING_POSITION" | "INVALID_POSITION" | "MISSING_ORIENTATION" | "INVALID_ORIENTATION" | "INVALID_DIMENSIONS" | "INVALID_CORNERS";
export type FootprintResult = { valid: true; footprint: FurnitureFootprint } | { valid: false; reasons: FootprintIssue[] };

const pointSchema = z.object({ xCm: z.number().finite(), yCm: z.number().finite() });
const orientationSchema = z.number().finite();
const dimensionsSchema = z.object({
  widthMinCm: z.number().finite().positive(), widthMaxCm: z.number().finite().positive(),
  depthMinCm: z.number().finite().positive(), depthMaxCm: z.number().finite().positive(),
}).refine((range) => range.widthMinCm <= range.widthMaxCm && range.depthMinCm <= range.depthMaxCm);

/** Range midpoints match A.2 planning; private wall-constrained widths are unavailable in a resolved plan. */
export function createFurnitureFootprint(item: AnyFurniturePlanItem): FootprintResult {
  const position = item.placement?.approximatePosition;
  const orientation = item.placement?.preferredOrientationDegrees;
  const point = pointSchema.safeParse(position);
  const angle = orientationSchema.safeParse(orientation);
  const dimensions = dimensionsSchema.safeParse(item.sizeRange);
  const reasons: FootprintIssue[] = [];
  if (!point.success) reasons.push(position == null ? "MISSING_POSITION" : "INVALID_POSITION");
  if (!angle.success) reasons.push(orientation == null ? "MISSING_ORIENTATION" : "INVALID_ORIENTATION");
  if (!dimensions.success) reasons.push("INVALID_DIMENSIONS");
  if (!point.success || !angle.success || !dimensions.success) return { valid: false, reasons: reasons.sort() };

  const widthCm = dimensions.data.widthMinCm / 2 + dimensions.data.widthMaxCm / 2;
  const depthCm = dimensions.data.depthMinCm / 2 + dimensions.data.depthMaxCm / 2;
  const orientationDegrees = normalizeRotationDegrees(angle.data);
  const corners = createOrientedRectangle(point.data, widthCm, depthCm, orientationDegrees);
  if (corners.some((corner, index) => !pointSchema.safeParse(corner).success
    || Math.hypot(corner.xCm - corners[(index + 1) % corners.length].xCm, corner.yCm - corners[(index + 1) % corners.length].yCm) === 0)) {
    return { valid: false, reasons: ["INVALID_CORNERS"] };
  }
  return { valid: true, footprint: { itemId: item.id, center: point.data, widthCm, depthCm, orientationDegrees, corners, polygon: corners } };
}