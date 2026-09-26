import assert from "node:assert/strict";
import test from "node:test";

import { buildCustomerAlternativeMap } from "@/lib/catalog/customer-alternative-map";
import type { CatalogCandidate } from "@/lib/catalog/schema";

function candidate(
  variantId: string,
  overrides: Partial<CatalogCandidate> = {},
): CatalogCandidate {
  return {
    productId: `product-${variantId}`,
    variantId,
    countryCode: "US",
    categoryCode: "seating",
    categoryName: "Seating",
    furnitureTypeCode: "sofa",
    furnitureTypeName: "Sofa",
    productTitle: `Product ${variantId}`,
    roomaiDescription: null,
    normalizedColor: "tan",
    normalizedMaterial: "leather",
    normalizedStyle: "modern",
    configuration: "standard",
    seatingCapacity: 3,
    widthCm: 220,
    depthCm: 95,
    heightCm: 85,
    weightKg: null,
    currency: "USD",
    roomaiSellingPrice: 1800,
    normalizedAvailability: "in_stock",
    deliveryText: null,
    estimatedDeliveryDaysMin: null,
    estimatedDeliveryDaysMax: null,
    vendorDataCheckedAt: null,
    roomaiPriceCalculatedAt: null,
    vendorName: "Internal test vendor",
    productUrl: "https://example.com/internal-product",
    primaryImageUrl: null,
    ...overrides,
  };
}

test("builds customer-safe alternatives for multiple current products", () => {
  const currentSofa = candidate("current-sofa");

  const currentRug = candidate("current-rug", {
    categoryCode: "rug",
    categoryName: "Rug",
    furnitureTypeCode: "rug",
    furnitureTypeName: "Rug",
    productTitle: "Current Rug",
  });

  const sofaAlternative = candidate("alternative-sofa", {
    productTitle: "Alternative Sofa",
  });

  const rugAlternative = candidate("alternative-rug", {
    categoryCode: "rug",
    categoryName: "Rug",
    furnitureTypeCode: "rug",
    furnitureTypeName: "Rug",
    productTitle: "Alternative Rug",
  });

  const result = buildCustomerAlternativeMap(
    [currentSofa, currentRug],
    [
      currentSofa,
      currentRug,
      sofaAlternative,
      rugAlternative,
    ],
    4,
  );

  assert.deepEqual(
    result.get("current-sofa")?.map((item) => item.product.name),
    ["Alternative Sofa"],
  );

  assert.deepEqual(
    result.get("current-rug")?.map((item) => item.product.name),
    ["Alternative Rug"],
  );
});

test("does not expose ranking, vendor, or catalog identity in mapped alternatives", () => {
  const current = candidate("current");
  const alternative = candidate("alternative");

  const result = buildCustomerAlternativeMap(
    [current],
    [current, alternative],
    4,
  );

  const customerAlternative = result.get("current")?.[0];

  assert.ok(customerAlternative);

  const serialized = JSON.stringify(customerAlternative);

  assert.equal(serialized.includes("score"), false);
  assert.equal(serialized.includes("scoreBreakdown"), false);
  assert.equal(serialized.includes("availabilityPenalty"), false);

  assert.equal(serialized.includes("productId"), false);
  assert.equal(serialized.includes("variantId"), false);
  assert.equal(serialized.includes("vendorName"), false);
  assert.equal(serialized.includes("productUrl"), false);
  assert.equal(serialized.includes("Internal test vendor"), false);
  assert.equal(serialized.includes("internal-product"), false);
});

test("returns an empty alternative list when no substitute exists", () => {
  const current = candidate("current");

  const result = buildCustomerAlternativeMap(
    [current],
    [current],
    4,
  );

  assert.deepEqual(result.get("current"), []);
});
