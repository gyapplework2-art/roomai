import type { DimensionRange } from "@/lib/furniture-planning/market-types";

type RangeConflictDimension = "width" | "depth" | "height";

export type RangeIntersectionResult =
  | { status: "ok"; range: DimensionRange }
  | { status: "conflict"; dimension: RangeConflictDimension; reason: string };

export function intersectRanges(preferred: DimensionRange, market: DimensionRange, dimension: RangeConflictDimension): RangeIntersectionResult {
  const minCm = Math.max(preferred.minCm, market.minCm);
  const maxCm = Math.min(preferred.maxCm, market.maxCm);
  if (minCm > maxCm) {
    return { status: "conflict", dimension, reason: "Preferred and market ranges do not overlap." };
  }
  return { status: "ok", range: { minCm, maxCm } };
}
