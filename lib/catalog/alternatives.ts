import "server-only";

import { selectCatalogAlternatives } from "@/lib/catalog/alternative-selection";
import { findCatalogProducts } from "@/lib/catalog/query";
import type { CatalogCandidate } from "@/lib/catalog/schema";

const DEFAULT_ALTERNATIVE_LIMIT = 12;

export async function findCatalogAlternatives(
  current: CatalogCandidate,
  limit = DEFAULT_ALTERNATIVE_LIMIT,
): Promise<CatalogCandidate[]> {
  if (!current.furnitureTypeCode) {
    return [];
  }

  const candidates = await findCatalogProducts({
    countryCode: current.countryCode,
    furnitureTypeCode: current.furnitureTypeCode,
    limit: limit + 1,
  });

  return selectCatalogAlternatives(
    candidates,
    current.variantId,
    limit,
  );
}
