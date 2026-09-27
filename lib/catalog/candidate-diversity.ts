import type { RankedCatalogCandidate } from "@/lib/catalog/candidate-ranking";

export function selectDiverseCatalogCandidates(
  rankedCandidates: RankedCatalogCandidate[],
  limit: number,
): RankedCatalogCandidate[] {
  if (!Number.isInteger(limit) || limit <= 0) {
    return [];
  }

  const selected: RankedCatalogCandidate[] = [];
  const selectedVariantIds = new Set<string>();
  const selectedProductIds = new Set<string>();

  for (const ranked of rankedCandidates) {
    if (selected.length >= limit) break;

    const { candidate } = ranked;

    if (selectedVariantIds.has(candidate.variantId)) continue;
    if (selectedProductIds.has(candidate.productId)) continue;

    selected.push(ranked);
    selectedVariantIds.add(candidate.variantId);
    selectedProductIds.add(candidate.productId);
  }

  if (selected.length >= limit) {
    return selected;
  }

  for (const ranked of rankedCandidates) {
    if (selected.length >= limit) break;

    if (selectedVariantIds.has(ranked.candidate.variantId)) continue;

    selected.push(ranked);
    selectedVariantIds.add(ranked.candidate.variantId);
  }

  return selected;
}
