import { selectCatalogAlternatives } from "@/lib/catalog/alternative-selection";
import {
  rankCatalogAlternatives,
  type RankedCatalogAlternative,
} from "@/lib/catalog/alternative-ranking";
import type { CatalogCandidate } from "@/lib/catalog/schema";

export function rankAlternativesFromCandidatePool(
  current: CatalogCandidate,
  candidates: CatalogCandidate[],
  limit: number,
): RankedCatalogAlternative[] {
  const sameContextCandidates = candidates.filter(
    (candidate) =>
      candidate.countryCode === current.countryCode &&
      candidate.furnitureTypeCode === current.furnitureTypeCode,
  );

  const alternatives = selectCatalogAlternatives(
    sameContextCandidates,
    current.variantId,
    sameContextCandidates.length,
  );

  return rankCatalogAlternatives(current, alternatives).slice(0, limit);
}
