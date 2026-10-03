import { validateOpeningFitsWall, getOpeningWorldPosition } from "@/lib/geometry/openings";
import { polygonInsidePolygon, rectanglesOverlapWithPositiveArea, segmentIntersectsPolygon, type Point } from "@/lib/geometry/polygons";
import { roomOpeningSchema } from "@/lib/geometry/schema";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";
import { validateRoomGeometryStructure } from "@/lib/geometry/validation";
import { createFurnitureFootprint, type FootprintIssue, type FurnitureFootprint } from "./footprints";
import type { AnyFurniturePlan, AnyFurniturePlanItem } from "./types";

type Violation<Type extends string, Details> = {
  id: string;
  type: Type;
  itemIds: string[];
  priority: "P0";
  classification: "hard";
  message: string;
  details: Details;
};

export type SpatialViolation =
  | Violation<"INVALID_FOOTPRINT", { reasons: Array<FootprintIssue | "DUPLICATE_ITEM_ID">; duplicateCount?: number }>
  | Violation<"OUTSIDE_ROOM", { footprint: FurnitureFootprint }>
  | Violation<"FURNITURE_OVERLAP", { intersection: "positive_area" }>
  | Violation<"DOOR_CONFLICT", { openingId: string | null; wallSegmentId: string; span: { start: Point; end: Point } }>;

export type SpatialValidationResult = { valid: boolean; violations: SpatialViolation[] };

/** AREA_RUG is a floor layer under furniture; two rugs still compete for the same floor layer. */
function occupancyLayer(item: AnyFurniturePlanItem): "AREA_RUG" | "FURNITURE" {
  const isRug = "semanticPlacement" in item
    ? item.semanticPlacement.role === "AREA_RUG"
    : ["rug", "area_rug"].includes(item.category.trim().toLowerCase().replace(/\s+/g, "_"));
  return isRug ? "AREA_RUG" : "FURNITURE";
}

function shouldValidatePair(first: AnyFurniturePlanItem, second: AnyFurniturePlanItem): boolean {
  return occupancyLayer(first) === occupancyLayer(second);
}

function violationBase<Type extends SpatialViolation["type"]>(type: Type, itemIds: string[], context = "") {
  const normalizedIds = [...itemIds].sort();
  return {
    id: `spatial:${JSON.stringify([type, normalizedIds, context])}`,
    type,
    itemIds: normalizedIds,
    priority: "P0" as const,
    classification: "hard" as const,
  };
}

/** Validation only. Authoritative geometry and door definitions must be structurally valid. */
export function validateSpatialPlan(
  plan: AnyFurniturePlan,
  geometry: RoomGeometry,
  openings: readonly RoomOpening[] = [],
): SpatialValidationResult {
  if (!validateRoomGeometryStructure(geometry).valid) throw new Error("SPATIAL_GEOMETRY_INVALID");
  const doors = new Map<string, { opening: RoomOpening; span: { start: Point; end: Point } }>();
  for (const opening of openings) {
    if (opening.openingType !== "door") continue;
    const parsed = roomOpeningSchema.safeParse(opening);
    if (!parsed.success || !validateOpeningFitsWall(geometry, parsed.data).valid) throw new Error("SPATIAL_DOOR_INVALID");
    const span = getOpeningWorldPosition(geometry, parsed.data);
    if (!span) throw new Error("SPATIAL_DOOR_INVALID");
    const key = JSON.stringify([parsed.data.id ?? null, parsed.data.wallSegmentId, parsed.data.offsetCm, parsed.data.widthCm]);
    doors.set(key, { opening: parsed.data, span });
  }

  const violations: SpatialViolation[] = [];
  const counts = new Map<string, number>();
  for (const item of plan.items) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  for (const [id, duplicateCount] of counts) {
    if (duplicateCount > 1) violations.push({
      ...violationBase("INVALID_FOOTPRINT", [id]),
      message: "Duplicate plan item IDs prevent unambiguous spatial validation.",
      details: { reasons: ["DUPLICATE_ITEM_ID"], duplicateCount },
    });
  }

  const validItems: Array<{ item: AnyFurniturePlanItem; footprint: FurnitureFootprint }> = [];
  for (const item of plan.items) {
    if ((counts.get(item.id) ?? 0) > 1) continue;
    const result = createFurnitureFootprint(item);
    if (!result.valid) {
      violations.push({
        ...violationBase("INVALID_FOOTPRINT", [item.id]),
        message: "Furniture cannot produce a valid representative footprint.",
        details: { reasons: result.reasons },
      });
      continue;
    }
    const footprint = result.footprint;
    validItems.push({ item, footprint });
    if (!polygonInsidePolygon(footprint.polygon, geometry.vertices)) violations.push({
      ...violationBase("OUTSIDE_ROOM", [item.id]),
      message: "The complete furniture footprint is not contained in the room polygon.",
      details: { footprint },
    });
    for (const [key, { opening, span }] of doors) {
      if (segmentIntersectsPolygon(span.start, span.end, footprint.polygon)) violations.push({
        ...violationBase("DOOR_CONFLICT", [item.id], key),
        message: "Furniture intersects the physical doorway span; no swing or approach clearance is modeled.",
        details: { openingId: opening.id ?? null, wallSegmentId: opening.wallSegmentId, span },
      });
    }
  }

  for (let firstIndex = 0; firstIndex < validItems.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < validItems.length; secondIndex += 1) {
      const first = validItems[firstIndex];
      const second = validItems[secondIndex];
      if (shouldValidatePair(first.item, second.item) && rectanglesOverlapWithPositiveArea(first.footprint.corners, second.footprint.corners)) {
        violations.push({
          ...violationBase("FURNITURE_OVERLAP", [first.item.id, second.item.id]),
          message: "Furniture footprints have a positive-area intersection on the same occupancy layer.",
          details: { intersection: "positive_area" },
        });
      }
    }
  }
  violations.sort((first, second) => first.id < second.id ? -1 : first.id > second.id ? 1 : 0);
  return { valid: !violations.some((violation) => violation.priority === "P0" && violation.classification === "hard"), violations };
}