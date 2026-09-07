export const furnitureMarkets = ["north_america", "europe", "uk", "japan", "china", "other"] as const;

export type FurnitureMarket = (typeof furnitureMarkets)[number];

export type DimensionRange = {
  minCm: number;
  maxCm: number;
};

export type MarketFurnitureRule = {
  category: string;
  subtype?: string;
  market: FurnitureMarket;
  widthCm: DimensionRange;
  depthCm: DimensionRange;
  heightCm: DimensionRange;
  notes?: string[];
};
