import "server-only";

import { selectCatalogAlternatives } from "@/lib/catalog/alternative-selection";
import {
  rankCatalogAlternatives,
  type RankedCatalogAlternative,
} from "@/lib/catalog/alternative-ranking";
import { findCatalogProducts } from "@/lib/catalog/query";
import type { CatalogCandidate } from "@/lib/catalog/schema";

const DEFAULT_ALTERNATIVE_LIMIT = 12;
const ALTERNATIVE_CANDIDATE_POOL_LIMIT = 50;

export async function findCatalogAlternatives(
  current: CatalogCandidate,
  limit = DEFAULT_ALTERNATIVE_LIMIT,
): Promise<RankedCatalogAlternative[]> {
  if (!current.furnitureTypeCode) {
    return [];
  }

  const candidates = await findCatalogProducts({
    countryCode: current.countryCode,
    furnitureTypeCode: current.furnitureTypeCode,
    limit: ALTERNATIVE_CANDIDATE_POOL_LIMIT,
  });

  const alternatives = selectCatalogAlternatives(
    candidates,
    current.variantId,
    ALTERNATIVE_CANDIDATE_POOL_LIMIT,
  );

  return rankCatalogAlternatives(current, alternatives).slice(0, limit);
}
