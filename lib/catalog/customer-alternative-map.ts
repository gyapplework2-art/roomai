import { rankAlternativesFromCandidatePool } from "@/lib/catalog/alternative-batch";
import {
  toRoomAIAlternatives,
  type RoomAIAlternative,
} from "@/lib/catalog/customer-alternative";
import type { CatalogCandidate } from "@/lib/catalog/schema";
import type { AlternativeSuitabilityContext } from "@/lib/catalog/alternative-suitability";

export function buildCustomerAlternativeMap(
  currents: CatalogCandidate[],
  candidatePool: CatalogCandidate[],
  limitPerProduct = 4,
  suitabilityContextsByVariantId?: Map<string, AlternativeSuitabilityContext>,
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
        );
      return [current.variantId, toRoomAIAlternatives(ranked)];
    }),
  );
}
