import { rankAlternativesFromCandidatePool } from "@/lib/catalog/alternative-batch";
import {
  toRoomAIAlternative,
  type RoomAIAlternative,
} from "@/lib/catalog/customer-alternative";
import type { CatalogCandidate } from "@/lib/catalog/schema";
import type { AlternativeSuitabilityContext } from "@/lib/catalog/alternative-suitability";

export function buildCustomerAlternativeMap(
  currents: CatalogCandidate[],
  candidatePool: CatalogCandidate[],
  limitPerProduct = 4,
  suitabilityContextsByVariantId?: Map<string, AlternativeSuitabilityContext>,
  replacementVariantIdByAlternative?: Map<RoomAIAlternative, string>,
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
