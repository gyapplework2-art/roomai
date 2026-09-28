import {
  eligibleAlternativesFromCandidatePool,
  loadCatalogFurnitureAttributes,
  rankAlternativesFromCandidatePool,
  type FurnitureAttributeLoader,
} from "@/lib/catalog/alternative-batch";
import {
  toRoomAIAlternative,
  type RoomAIAlternative,
} from "@/lib/catalog/customer-alternative";
import type { CatalogCandidate } from "@/lib/catalog/schema";
import type { AlternativeSuitabilityContext } from "@/lib/catalog/alternative-suitability";
import type { FurnitureDesignAttributes } from "@/lib/design-intelligence/furniture-attributes";

export function buildCustomerAlternativeMap(
  currents: CatalogCandidate[],
  candidatePool: CatalogCandidate[],
  limitPerProduct = 4,
  suitabilityContextsByVariantId?: Map<string, AlternativeSuitabilityContext>,
  replacementVariantIdByAlternative?: Map<RoomAIAlternative, string>,
  attributesByVariantId?: ReadonlyMap<string, FurnitureDesignAttributes>,
): Map<string, RoomAIAlternative[]> {
  return new Map(
    currents.map((current) => {
      const suitabilityContext = suitabilityContextsByVariantId?.get(current.variantId);
      const ranked = suitabilityContextsByVariantId && !suitabilityContext
        ? []
        : rankAlternativesFromCandidatePool(
          current,
          candidatePool,
          limitPerProduct,
          suitabilityContext,
          attributesByVariantId,
        );
      const alternatives = ranked.map((item) => {
        const alternative = toRoomAIAlternative(item);
        replacementVariantIdByAlternative?.set(
          alternative,
          item.candidate.variantId,
        );
        return alternative;
      });
      return [current.variantId, alternatives];
    }),
  );
}

export async function buildAttributeAwareCustomerAlternativeMap(
  currents: CatalogCandidate[],
  candidatePool: CatalogCandidate[],
  limitPerProduct = 4,
  suitabilityContextsByVariantId?: Map<string, AlternativeSuitabilityContext>,
  replacementVariantIdByAlternative?: Map<RoomAIAlternative, string>,
  loadAttributes: FurnitureAttributeLoader = loadCatalogFurnitureAttributes,
): Promise<Map<string, RoomAIAlternative[]>> {
  const relevant = currents.flatMap((current) => {
    if (suitabilityContextsByVariantId && !suitabilityContextsByVariantId.has(current.variantId)) return [];
    const eligible = eligibleAlternativesFromCandidatePool(current, candidatePool);
    return eligible.length > 0 ? [current, ...eligible] : [];
  });
  const unique = [...new Map(relevant.map((candidate) => [candidate.variantId, candidate])).values()];
  let attributesByVariantId: Map<string, FurnitureDesignAttributes> | undefined;
  if (unique.length > 0 && suitabilityContextsByVariantId) {
    try {
      attributesByVariantId = await loadAttributes(
        unique.map((candidate) => candidate.variantId),
        new Map(unique.map((candidate) => [candidate.variantId, candidate.seatingCapacity])),
      );
    } catch {
      // Missing attribute evidence must not suppress already eligible alternatives.
    }
  }
  return buildCustomerAlternativeMap(
    currents,
    candidatePool,
    limitPerProduct,
    suitabilityContextsByVariantId,
    replacementVariantIdByAlternative,
    attributesByVariantId,
  );
}
