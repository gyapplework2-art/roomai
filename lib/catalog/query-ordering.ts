import type { CatalogCandidate } from "@/lib/catalog/schema";

export function compareCatalogCandidates(
  left: CatalogCandidate,
  right: CatalogCandidate,
): number {
  const leftPrice = left.roomaiSellingPrice ?? Number.POSITIVE_INFINITY;
  const rightPrice = right.roomaiSellingPrice ?? Number.POSITIVE_INFINITY;

  if (leftPrice !== rightPrice) {
    return leftPrice - rightPrice;
  }

  return left.variantId.localeCompare(right.variantId);
}
