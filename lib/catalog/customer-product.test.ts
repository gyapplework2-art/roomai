import assert from "node:assert/strict";
import test from "node:test";

import {
  toRoomAIProduct,
  type RoomAIProduct,
} from "@/lib/catalog/customer-product";
import type { CatalogCandidate } from "@/lib/catalog/schema";

const candidate: CatalogCandidate = {
  productId: "product-1",
  variantId: "variant-1",
  countryCode: "US",
  categoryCode: "living_room",
  categoryName: "Living Room",
  furnitureTypeCode: "sofa",
  furnitureTypeName: "Sofa",
  productTitle: "Test Sofa",
  roomaiDescription: "A RoomAI catalog sofa.",
  normalizedColor: "tan",
  normalizedMaterial: "leather",
  normalizedStyle: "modern",
  configuration: "three-seat",
  seatingCapacity: 3,
  widthCm: 220,
  depthCm: 90,
  heightCm: 80,
  weightKg: 50,
  currency: "USD",
  roomaiSellingPrice: 1799,
  normalizedAvailability: "in_stock",
  deliveryText: "Estimated delivery",
  estimatedDeliveryDaysMin: 3,
  estimatedDeliveryDaysMax: 7,
  vendorDataCheckedAt: "2026-09-25T12:00:00Z",
  roomaiPriceCalculatedAt: "2026-09-25T12:00:00Z",

  // Internal/vendor-facing catalog information.
  vendorName: "Internal Vendor",
  productUrl: "https://example.com/vendor-product",
  primaryImageUrl: "https://example.com/product.jpg",
};

test("maps a catalog candidate to the RoomAI customer product contract", () => {
  const product: RoomAIProduct = toRoomAIProduct(candidate);

  assert.equal(product.name, "Test Sofa");
  assert.equal(product.imageUrl, "https://example.com/product.jpg");
  assert.equal(product.price.currency, "USD");
  assert.equal(product.price.amount, 1799);
  assert.equal(product.material, "leather");
  assert.equal(product.color, "tan");
  assert.equal(product.dimensions.widthCm, 220);
  assert.equal(product.availability.status, "in_stock");
});

test("customer product does not expose catalog identity or vendor fields", () => {
  const product = toRoomAIProduct(candidate);
  const exposedKeys = Object.keys(product);

  assert.equal(exposedKeys.includes("productId"), false);
  assert.equal(exposedKeys.includes("variantId"), false);
  assert.equal(exposedKeys.includes("vendorName"), false);
  assert.equal(exposedKeys.includes("productUrl"), false);
  assert.equal(exposedKeys.includes("vendorDataCheckedAt"), false);
  assert.equal(exposedKeys.includes("roomaiPriceCalculatedAt"), false);
});

test("uses a RoomAI-safe fallback name when the catalog title is missing", () => {
  const product = toRoomAIProduct({
    ...candidate,
    productTitle: null,
    furnitureTypeName: null,
  });

  assert.equal(product.name, "RoomAI furniture");
});
