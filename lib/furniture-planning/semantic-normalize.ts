import type {
  AnyFurniturePlan,
  AnyFurniturePlanItem,
  FurniturePlanItemV11,
  FurniturePlanV11,
  FurnitureRole,
  SemanticPlacement,
} from "@/lib/furniture-planning/types";
import { furniturePlanV11Schema } from "@/lib/furniture-planning/semantic-schema";

export function inferFurnitureRole(category: string, subtype: string | null = null): FurnitureRole {
  const normCategory = category.trim().toLowerCase().replace(/\s+/g, "_");
  const normSubtype = (subtype ?? "").trim().toLowerCase();
  const text = `${normCategory} ${normSubtype}`;

  if (text.includes("coffee")) return "COFFEE_TABLE";
  if (
    text.includes("side_table") ||
    text.includes("side table") ||
    text.includes("end_table") ||
    text.includes("end table") ||
    text.includes("nightstand")
  ) {
    return "SIDE_TABLE";
  }
  if (text.includes("rug") || text.includes("mat")) return "AREA_RUG";
  if (
    text.includes("media") ||
    text.includes("tv") ||
    text.includes("console")
  ) {
    return "MEDIA_CONSOLE";
  }
  if (text.includes("task") || text.includes("desk_lamp")) return "TASK_LIGHTING";
  if (
    text.includes("lamp") ||
    text.includes("lighting") ||
    text.includes("light") ||
    text.includes("chandelier") ||
    text.includes("pendant")
  ) {
    return "AMBIENT_LIGHTING";
  }
  if (
    text.includes("sofa") ||
    text.includes("sectional") ||
    text.includes("couch")
  ) {
    return "PRIMARY_SEATING";
  }
  if (
    text.includes("chair") ||
    text.includes("armchair") ||
    text.includes("loveseat") ||
    text.includes("recliner") ||
    text.includes("stool") ||
    text.includes("bench") ||
    text.includes("seating")
  ) {
    return "SECONDARY_SEATING";
  }
  if (
    text.includes("storage") ||
    text.includes("dresser") ||
    text.includes("bookshelf") ||
    text.includes("bookcase") ||
    text.includes("cabinet") ||
    text.includes("wardrobe") ||
    text.includes("bed") ||
    text.includes("desk") ||
    text.includes("table")
  ) {
    return "STORAGE";
  }

  return "SECONDARY_SEATING";
}

export function normalizeSemanticPlanItem(item: AnyFurniturePlanItem): FurniturePlanItemV11 {
  if ("semanticPlacement" in item && item.semanticPlacement) {
    return {
      ...item,
      placement: {
        preferredZone: item.placement.preferredZone,
        anchorWallId: item.placement.anchorWallId,
        approximatePosition: item.placement.approximatePosition
          ? { ...item.placement.approximatePosition }
          : null,
        preferredOrientationDegrees: item.placement.preferredOrientationDegrees,
      },
      semanticPlacement: {
        role: item.semanticPlacement.role,
        mode: item.semanticPlacement.mode,
        alignment: item.semanticPlacement.alignment ?? null,
        zoneId: item.semanticPlacement.zoneId ?? null,
        targetWallId: item.semanticPlacement.targetWallId ?? null,
        relationships: item.semanticPlacement.relationships.map((rel) => ({ ...rel })),
        fallbackModes: [...item.semanticPlacement.fallbackModes],
      },
    };
  }

  // Legacy v1.0 item: infer conservative semantic information where unambiguous
  const mode = item.placement.anchorWallId
    ? "AGAINST_WALL"
    : item.placement.preferredZone && !item.placement.approximatePosition
      ? "CENTERED_IN_ZONE"
      : "FLOATING";

  const semanticPlacement: SemanticPlacement = {
    role: inferFurnitureRole(item.category, item.subtype),
    mode,
    alignment: null,
    zoneId: item.placement.preferredZone ?? null,
    targetWallId: item.placement.anchorWallId ?? null,
    relationships: [], // do not invent furniture relationships
    fallbackModes: [],
  };

  return {
    ...item,
    placement: {
      preferredZone: item.placement.preferredZone,
      anchorWallId: item.placement.anchorWallId,
      approximatePosition: item.placement.approximatePosition
        ? { ...item.placement.approximatePosition }
        : null,
      preferredOrientationDegrees: item.placement.preferredOrientationDegrees,
    },
    semanticPlacement,
  };
}

export function normalizeSemanticPlan(plan: AnyFurniturePlan): FurniturePlanV11 {
  const normalizedItems = plan.items.map(normalizeSemanticPlanItem);

  const normalizedPlan: FurniturePlanV11 = {
    schemaVersion: "1.1",
    roomIntent: plan.roomIntent,
    items: normalizedItems,
    notes: [...plan.notes],
  };

  return furniturePlanV11Schema.parse(normalizedPlan);
}
