import { rankAlternativesFromCandidatePool } from "@/lib/catalog/alternative-batch";
import {
  toRoomAIAlternatives,
  type RoomAIAlternative,
} from "@/lib/catalog/customer-alternative";
import type { CatalogCandidate } from "@/lib/catalog/schema";

export function buildCustomerAlternativeMap(
  currents: CatalogCandidate[],
  candidatePool: CatalogCandidate[],
  limitPerProduct = 4,
): Map<string, RoomAIAlternative[]> {
  return new Map(
    currents.map((current) => [
      current.variantId,
      toRoomAIAlternatives(
        rankAlternativesFromCandidatePool(
          current,
          candidatePool,
          limitPerProduct,
        ),
      ),
    ]),
  );
}
