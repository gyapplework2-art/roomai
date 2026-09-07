import type { FurnitureMarket, MarketFurnitureRule } from "@/lib/furniture-planning/market-types";

const rule = (
  category: string,
  market: FurnitureMarket,
  widthCm: [number, number],
  depthCm: [number, number],
  heightCm: [number, number],
  subtype?: string,
  notes?: string[],
): MarketFurnitureRule => ({
  category,
  subtype,
  market,
  widthCm: { minCm: widthCm[0], maxCm: widthCm[1] },
  depthCm: { minCm: depthCm[0], maxCm: depthCm[1] },
  heightCm: { minCm: heightCm[0], maxCm: heightCm[1] },
  notes,
});

// Approximate planning envelopes, not retailer guarantees or certifications.
// Actual catalog dimensions must override these values in future product search.
export const marketFurnitureRules: MarketFurnitureRule[] = [
  rule("sofa", "north_america", [140, 190], [75, 105], [70, 100], "2-seat"),
  rule("sofa", "north_america", [180, 240], [80, 110], [70, 105], "3-seat"),
  rule("sofa", "europe", [140, 240], [75, 105], [70, 105]),
  rule("loveseat", "north_america", [125, 180], [75, 105], [70, 100]),
  rule("sectional", "north_america", [220, 360], [80, 110], [70, 105], "small"),
  rule("sectional", "north_america", [280, 430], [85, 115], [70, 110], "medium"),
  rule("sectional", "north_america", [350, 520], [90, 120], [70, 110], "large"),
  rule("armchair", "north_america", [65, 105], [70, 100], [70, 110]),
  rule("side_table", "north_america", [30, 65], [30, 65], [40, 70]),
  rule("coffee_table", "north_america", [80, 140], [45, 80], [35, 50]),
  rule("nightstand", "north_america", [35, 70], [30, 55], [45, 75]),
  rule("dresser", "north_america", [90, 180], [40, 65], [70, 110]),
  rule("media_console", "north_america", [120, 220], [30, 55], [40, 80]),
  rule("bookshelf", "north_america", [60, 120], [25, 45], [120, 220]),
  rule("storage", "north_america", [60, 180], [30, 65], [70, 220]),
  rule("desk", "north_america", [100, 180], [50, 90], [70, 80]),
  rule("floor_lamp", "north_america", [20, 60], [20, 60], [120, 190]),
  rule("dining_table", "north_america", [70, 110], [70, 110], [70, 80], "2-seat"),
  rule("dining_table", "north_america", [100, 160], [70, 100], [70, 80], "4-seat"),
  rule("dining_table", "north_america", [150, 220], [80, 110], [70, 80], "6-seat"),
  rule("dining_table", "north_america", [200, 280], [90, 120], [70, 80], "8-seat"),
  rule("dining_chair", "north_america", [45, 60], [45, 60], [75, 100]),
  rule("rug", "north_america", [120, 300], [80, 240], [1, 2]),
  rule("bed", "north_america", [105, 115], [200, 215], [45, 75], "twin", ["Frame envelope; mattress standard is approximately 99 x 191 cm."]),
  rule("bed", "north_america", [145, 160], [200, 215], [45, 75], "full", ["Frame envelope; mattress standard is approximately 137 x 191 cm."]),
  rule("bed", "north_america", [160, 175], [215, 225], [45, 75], "queen", ["Frame envelope; mattress standard is approximately 152 x 203 cm."]),
  rule("bed", "north_america", [200, 215], [215, 225], [45, 75], "king", ["Frame envelope; mattress standard is approximately 193 x 203 cm."]),
  rule("bed", "north_america", [190, 205], [225, 235], [45, 75], "california king", ["Frame envelope; mattress standard is approximately 183 x 213 cm."]),
  rule("mattress", "north_america", [99, 99], [191, 191], [20, 35], "twin"),
  rule("mattress", "north_america", [137, 137], [191, 191], [20, 35], "full"),
  rule("mattress", "north_america", [152, 152], [203, 203], [20, 35], "queen"),
  rule("mattress", "north_america", [193, 193], [203, 203], [20, 35], "king"),
  rule("mattress", "north_america", [183, 183], [213, 213], [20, 35], "california king"),
];

export function getMarketFurnitureRule({ category, subtype, market }: { category: string; subtype: string | null; market: FurnitureMarket }) {
  const exact = marketFurnitureRules.find((candidate) => candidate.market === market && candidate.category === category && candidate.subtype === subtype);
  if (exact) return exact;
  return marketFurnitureRules.find((candidate) => candidate.market === market && candidate.category === category && !candidate.subtype) ?? null;
}
