import type { CatalogCandidate } from "@/lib/catalog/schema";

export type RoomAIProduct = {
  imageUrl: string | null;
  name: string;
  description: string | null;

  color: string | null;
  material: string | null;
  style: string | null;
  configuration: string | null;
  seatingCapacity: number | null;

  dimensions: {
    widthCm: number | null;
    depthCm: number | null;
    heightCm: number | null;
    weightKg: number | null;
  };

  price: {
    currency: string | null;
    amount: number | null;
  };

  availability: {
    status: string | null;
    deliveryText: string | null;
    estimatedDeliveryDaysMin: number | null;
    estimatedDeliveryDaysMax: number | null;
  };
};

export function toRoomAIProduct(candidate: CatalogCandidate): RoomAIProduct {
  return {
    imageUrl: candidate.primaryImageUrl,
    name:
      candidate.productTitle ??
      candidate.furnitureTypeName ??
      "RoomAI furniture",
    description: candidate.roomaiDescription,

    color: candidate.normalizedColor,
    material: candidate.normalizedMaterial,
    style: candidate.normalizedStyle,
    configuration: candidate.configuration,
    seatingCapacity: candidate.seatingCapacity,

    dimensions: {
      widthCm: candidate.widthCm,
      depthCm: candidate.depthCm,
      heightCm: candidate.heightCm,
      weightKg: candidate.weightKg,
    },

    price: {
      currency: candidate.currency,
      amount: candidate.roomaiSellingPrice,
    },

    availability: {
      status: candidate.normalizedAvailability,
      deliveryText: candidate.deliveryText,
      estimatedDeliveryDaysMin: candidate.estimatedDeliveryDaysMin,
      estimatedDeliveryDaysMax: candidate.estimatedDeliveryDaysMax,
    },
  };
}
