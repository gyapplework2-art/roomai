import { selectCatalogAlternatives } from "@/lib/catalog/alternative-selection";
import {
  rankCatalogAlternatives,
  type RankedCatalogAlternative,
} from "@/lib/catalog/alternative-ranking";
import {
  rankSuitableCatalogAlternatives,
  type AlternativeSuitabilityContext,
} from "@/lib/catalog/alternative-suitability";
import type { CatalogCandidate } from "@/lib/catalog/schema";
import type { FurnitureDesignAttributes } from "@/lib/design-intelligence/furniture-attributes";

export type FurnitureAttributeLoader = (
  variantIds: readonly string[],
  seatingCapacityByVariantId: ReadonlyMap<string, CatalogCandidate["seatingCapacity"]>,
) => Promise<Map<string, FurnitureDesignAttributes>>;

export async function loadCatalogFurnitureAttributes(
  variantIds: readonly string[],
  seatingCapacityByVariantId: ReadonlyMap<string, CatalogCandidate["seatingCapacity"]>,
): Promise<Map<string, FurnitureDesignAttributes>> {
  const { getFurnitureAttributesByVariantIds } = await import("@/lib/catalog/furniture-attributes");
  return getFurnitureAttributesByVariantIds(variantIds, seatingCapacityByVariantId);
}

export function eligibleAlternativesFromCandidatePool(
  current: CatalogCandidate,
  candidates: CatalogCandidate[],
): CatalogCandidate[] {
  const sameContextCandidates = candidates.filter(
    (candidate) =>
      candidate.countryCode === current.countryCode &&
      candidate.furnitureTypeCode === current.furnitureTypeCode,
  );

  return selectCatalogAlternatives(
    sameContextCandidates,
    current.variantId,
    sameContextCandidates.length,
  );
}

export function rankAlternativesFromCandidatePool(
  current: CatalogCandidate,
  candidates: CatalogCandidate[],
  limit: number,
  suitabilityContext?: AlternativeSuitabilityContext,
  attributesByVariantId?: ReadonlyMap<string, FurnitureDesignAttributes>,
): RankedCatalogAlternative[] {
  const alternatives = eligibleAlternativesFromCandidatePool(current, candidates);

  return suitabilityContext
    ? rankSuitableCatalogAlternatives(current, alternatives, suitabilityContext, limit, attributesByVariantId)
    : rankCatalogAlternatives(current, alternatives).slice(0, limit);
}

export async function rankAttributeAwareAlternativesFromCandidatePool(
  current: CatalogCandidate,
  candidates: CatalogCandidate[],
  limit: number,
  suitabilityContext: AlternativeSuitabilityContext,
  loadAttributes: FurnitureAttributeLoader = loadCatalogFurnitureAttributes,
): Promise<RankedCatalogAlternative[]> {
  const eligible = eligibleAlternativesFromCandidatePool(current, candidates);
  if (eligible.length === 0) return [];
  const relevant = [current, ...eligible];
  const unique = [...new Map(relevant.map((candidate) => [candidate.variantId, candidate])).values()];
  let attributesByVariantId: Map<string, FurnitureDesignAttributes> | undefined;
  try {
    attributesByVariantId = await loadAttributes(
      unique.map((candidate) => candidate.variantId),
      new Map(unique.map((candidate) => [candidate.variantId, candidate.seatingCapacity])),
    );
  } catch {
    // Attribute metadata is supplementary; keep the original suitability path available.
  }
  return rankAlternativesFromCandidatePool(current, candidates, limit, suitabilityContext, attributesByVariantId);
}
