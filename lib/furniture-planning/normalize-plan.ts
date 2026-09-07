import type { FurniturePlan, FurniturePlanItem } from "@/lib/furniture-planning/types";
import { getMarketFurnitureRule } from "@/lib/furniture-planning/market-rules";
import type { FurnitureMarket, DimensionRange, MarketFurnitureRule } from "@/lib/furniture-planning/market-types";
import { intersectRanges } from "@/lib/furniture-planning/range-utils";

export type NormalizedPlanItem = {
  item: FurniturePlanItem;
  normalizedCategory: string;
  normalizedSubtype: string | null;
  marketRule: MarketFurnitureRule | null;
  preferredRange: FurniturePlanItem["sizeRange"];
  marketRange: FurniturePlanItem["sizeRange"] | null;
  searchRange: FurniturePlanItem["sizeRange"] | null;
  status: "ready" | "unsupported_category" | "range_conflict";
  conflictDimension?: "width" | "depth" | "height";
};

export type NormalizedFurniturePlan = {
  plan: FurniturePlan;
  market: FurnitureMarket;
  items: NormalizedPlanItem[];
};

const categoryAliases: Record<string, string> = {
  "coffee table": "coffee_table",
  "media console": "media_console",
  "dining table": "dining_table",
  "dining chair": "dining_chair",
};

const subtypeAliases: Record<string, string> = {
  "3 seater": "3-seat",
  "three-seat": "3-seat",
  "3 seat": "3-seat",
  "cal king": "california king",
  "california-king": "california king",
};

const categorySubtypeAliases: Record<string, Record<string, string>> = {
  seating: {
    sofa: "sofa",
    "2-seat": "sofa",
    "3-seat": "sofa",
    loveseat: "loveseat",
    sectional: "sectional",
    "accent chair": "armchair",
    armchair: "armchair",
  },
  surface: {
    "coffee table": "coffee_table",
    "side table": "side_table",
  },
  lighting: { "floor lamp": "floor_lamp" },
  textile: { rug: "rug" },
};

export function normalizeFurnitureCategory(category: string, subtype: string | null = null) {
  const normalized = category.trim().toLowerCase().replace(/\s+/g, " ");
  const normalizedSubtype = subtype?.trim().toLowerCase().replace(/\s+/g, " ");
  const mappedCategory = normalizedSubtype ? categorySubtypeAliases[normalized]?.[normalizedSubtype] : undefined;
  if (mappedCategory) return mappedCategory;
  return categoryAliases[normalized] ?? normalized.replace(/\s/g, "_");
}

export function normalizeFurnitureSubtype(subtype: string | null) {
  if (!subtype) return null;
  const normalized = subtype.trim().toLowerCase().replace(/\s+/g, " ");
  const compactMatch = normalized.match(/^(2|3|three)[ -]?(?:seat|seater)\s+sofa$/);
  if (compactMatch) return compactMatch[1] === "2" ? "2-seat" : "3-seat";
  if (normalized === "sofa") return null;
  if (normalized === "accent chair" || normalized === "armchair") return null;
  return subtypeAliases[normalized] ?? normalized;
}

function toPlanRange(range: { widthCm: DimensionRange; depthCm: DimensionRange; heightCm: DimensionRange }): FurniturePlanItem["sizeRange"] {
  return {
    widthMinCm: range.widthCm.minCm,
    widthMaxCm: range.widthCm.maxCm,
    depthMinCm: range.depthCm.minCm,
    depthMaxCm: range.depthCm.maxCm,
    heightMinCm: range.heightCm.minCm,
    heightMaxCm: range.heightCm.maxCm,
  };
}

export function normalizeFurniturePlanForMarket(plan: FurniturePlan, market: FurnitureMarket): NormalizedFurniturePlan {
  return {
    plan,
    market,
    items: plan.items.map((item) => {
      const normalizedCategory = normalizeFurnitureCategory(item.category, item.subtype);
      const normalizedSubtype = normalizeFurnitureSubtype(item.subtype);
      const marketRule = getMarketFurnitureRule({ category: normalizedCategory, subtype: normalizedSubtype, market });
      if (!marketRule) {
        return { item, normalizedCategory, normalizedSubtype, marketRule: null, preferredRange: item.sizeRange, marketRange: null, searchRange: null, status: "unsupported_category" };
      }
      const marketRange = toPlanRange(marketRule);
      const intersections = [
        intersectRanges({ minCm: item.sizeRange.widthMinCm, maxCm: item.sizeRange.widthMaxCm }, marketRule.widthCm, "width"),
        intersectRanges({ minCm: item.sizeRange.depthMinCm, maxCm: item.sizeRange.depthMaxCm }, marketRule.depthCm, "depth"),
        intersectRanges({ minCm: item.sizeRange.heightMinCm, maxCm: item.sizeRange.heightMaxCm }, marketRule.heightCm, "height"),
      ];
      const conflict = intersections.find((result) => result.status === "conflict");
      if (conflict?.status === "conflict") {
        return { item, normalizedCategory, normalizedSubtype, marketRule, preferredRange: item.sizeRange, marketRange, searchRange: null, status: "range_conflict", conflictDimension: conflict.dimension };
      }
      const [width, depth, height] = intersections as Array<{ status: "ok"; range: DimensionRange }>;
      return {
        item,
        normalizedCategory,
        normalizedSubtype,
        marketRule,
        preferredRange: item.sizeRange,
        marketRange,
        searchRange: toPlanRange({ widthCm: width.range, depthCm: depth.range, heightCm: height.range }),
        status: "ready",
      };
    }),
  };
}
