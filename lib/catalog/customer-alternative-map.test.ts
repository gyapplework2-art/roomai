import assert from "node:assert/strict";
import test from "node:test";

import { buildCustomerAlternativeMap } from "@/lib/catalog/customer-alternative-map";
import type { AlternativeSuitabilityContext } from "@/lib/catalog/alternative-suitability";
import type { CatalogCandidate } from "@/lib/catalog/schema";
import type { RoomGeometry } from "@/lib/geometry/types";

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

const geometry: RoomGeometry = {
  schemaVersion: "1.0",
  shapeType: "rectangle",
  templateTransform: { rotationDegrees: 0, mirroredHorizontal: false, mirroredVertical: false },
  ceilingHeightCm: 250,
  vertices: [
    { id: "v1", xCm: 0, yCm: 0 },
    { id: "v2", xCm: 500, yCm: 0 },
    { id: "v3", xCm: 500, yCm: 400 },
    { id: "v4", xCm: 0, yCm: 400 },
  ],
  wallSegments: [
    { id: "w1", startVertexId: "v1", endVertexId: "v2" },
    { id: "w2", startVertexId: "v2", endVertexId: "v3" },
    { id: "w3", startVertexId: "v3", endVertexId: "v4" },
    { id: "w4", startVertexId: "v4", endVertexId: "v1" },
  ],
};

function suitabilityContext(): AlternativeSuitabilityContext {
  return {
    currentObjectId: "current-object",
    designObject: { x_cm: 250, y_cm: 200, rotation_degrees: 0 },
    geometry,
    openings: [],
    neighbors: [],
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

test("context-aware customer map excludes spatially incompatible alternatives", () => {
  const current = candidate("current");
  const oversized = candidate("oversized", { widthCm: 490 });
  const contexts = new Map([[current.variantId, suitabilityContext()]]);

  const result = buildCustomerAlternativeMap(
    [current],
    [current, oversized],
    4,
    contexts,
  );

  assert.deepEqual(result.get("current"), []);
});

test("context-aware customer map excludes alternatives when spatial context is unavailable", () => {
  const current = candidate("current");
  const alternative = candidate("alternative");

  const result = buildCustomerAlternativeMap(
    [current],
    [current, alternative],
    4,
    new Map(),
  );

  assert.deepEqual(result.get("current"), []);
});
