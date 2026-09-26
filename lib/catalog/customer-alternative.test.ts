import assert from "node:assert/strict";
import test from "node:test";

import {
  toRoomAIAlternative,
  toRoomAIAlternatives,
} from "@/lib/catalog/customer-alternative";
import type { RankedCatalogAlternative } from "@/lib/catalog/alternative-ranking";

function rankedAlternative(
  variantId: string,
): RankedCatalogAlternative {
  return {
    candidate: {
      productId: `product-${variantId}`,
      variantId,
      countryCode: "US",
      categoryCode: "seating",
      categoryName: "Seating",
      furnitureTypeCode: "sofa",
      furnitureTypeName: "Sofa",
      productTitle: "RoomAI Test Sofa",
      roomaiDescription: "A customer-safe test sofa.",
      normalizedColor: "tan",
      normalizedMaterial: "leather",
      normalizedStyle: "modern",
      configuration: "standard",
      seatingCapacity: 3,
      widthCm: 220,
      depthCm: 95,
      heightCm: 85,
      weightKg: 50,
      currency: "USD",
      roomaiSellingPrice: 1800,
      normalizedAvailability: "in_stock",
      deliveryText: "Estimated delivery in 5–7 days",
      estimatedDeliveryDaysMin: 5,
      estimatedDeliveryDaysMax: 7,
      vendorDataCheckedAt: "2026-09-25T00:00:00Z",
      roomaiPriceCalculatedAt: "2026-09-25T00:00:00Z",
      vendorName: "Internal Vendor",
      productUrl: "https://example.com/internal-product",
      primaryImageUrl: "https://example.com/product.jpg",
    },
    score: 92,
    scoreBreakdown: {
      dimensions: 28,
      configuration: 15,
      seatingCapacity: 10,
      style: 15,
      material: 10,
      color: 10,
      price: 9,
    },
    availabilityPenalty: 5,
  };
}

test("maps a ranked catalog alternative to the RoomAI customer contract", () => {
  const alternative = toRoomAIAlternative(
    rankedAlternative("variant-1"),
  );

  assert.equal(alternative.product.name, "RoomAI Test Sofa");
  assert.equal(alternative.product.imageUrl, "https://example.com/product.jpg");
  assert.equal(alternative.product.price.currency, "USD");
  assert.equal(alternative.product.price.amount, 1800);
  assert.equal(alternative.product.material, "leather");
  assert.equal(alternative.product.color, "tan");
});

test("customer alternative does not expose ranking, catalog identity, or vendor fields", () => {
  const alternative = toRoomAIAlternative(
    rankedAlternative("variant-1"),
  );

  const serialized = JSON.stringify(alternative);

  assert.equal("score" in alternative, false);
  assert.equal("scoreBreakdown" in alternative, false);
  assert.equal("availabilityPenalty" in alternative, false);

  assert.equal(serialized.includes("productId"), false);
  assert.equal(serialized.includes("variantId"), false);
  assert.equal(serialized.includes("vendorName"), false);
  assert.equal(serialized.includes("productUrl"), false);
  assert.equal(serialized.includes("vendorDataCheckedAt"), false);
  assert.equal(serialized.includes("roomaiPriceCalculatedAt"), false);
  assert.equal(serialized.includes("Internal Vendor"), false);
  assert.equal(serialized.includes("internal-product"), false);
});

test("maps ranked alternatives while preserving their ranked order", () => {
  const alternatives = toRoomAIAlternatives([
    rankedAlternative("variant-1"),
    {
      ...rankedAlternative("variant-2"),
      candidate: {
        ...rankedAlternative("variant-2").candidate,
        productTitle: "Second RoomAI Sofa",
      },
      score: 80,
    },
  ]);

  assert.deepEqual(
    alternatives.map((alternative) => alternative.product.name),
    ["RoomAI Test Sofa", "Second RoomAI Sofa"],
  );
});
