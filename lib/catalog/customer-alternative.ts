import {
  toRoomAIProduct,
  type RoomAIProduct,
} from "@/lib/catalog/customer-product";
import type { RankedCatalogAlternative } from "@/lib/catalog/alternative-ranking";

export type RoomAIAlternative = {
  product: RoomAIProduct;
};

export function toRoomAIAlternative(
  ranked: RankedCatalogAlternative,
): RoomAIAlternative {
  return {
    product: toRoomAIProduct(ranked.candidate),
  };
}

export function toRoomAIAlternatives(
  ranked: RankedCatalogAlternative[],
): RoomAIAlternative[] {
  return ranked.map(toRoomAIAlternative);
}
