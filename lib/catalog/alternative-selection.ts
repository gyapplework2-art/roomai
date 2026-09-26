import type { CatalogCandidate } from "@/lib/catalog/schema";

export function selectCatalogAlternatives(
  candidates: CatalogCandidate[],
  currentVariantId: string,
  limit: number,
): CatalogCandidate[] {
  return candidates
    .filter((candidate) => candidate.variantId !== currentVariantId)
    .slice(0, limit);
}
