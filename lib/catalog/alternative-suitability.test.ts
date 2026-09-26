import assert from "node:assert/strict";
import test from "node:test";

import {
  ALTERNATIVE_SUITABILITY_WEIGHTS,
  rankSuitableCatalogAlternatives,
  type AlternativeSuitabilityContext,
} from "@/lib/catalog/alternative-suitability";
import { toRoomAIAlternatives } from "@/lib/catalog/customer-alternative";
import type { CatalogCandidate } from "@/lib/catalog/schema";
import type { RoomGeometry } from "@/lib/geometry/types";

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

const context: AlternativeSuitabilityContext = {
  currentObjectId: "current-object",
  designObject: { x_cm: 250, y_cm: 200, rotation_degrees: 0 },
  geometry,
  openings: [],
  neighbors: [],
};

function candidate(variantId: string, overrides: Partial<CatalogCandidate> = {}): CatalogCandidate {
  return {
    productId: `product-${variantId}`,
    variantId,
    countryCode: "US",
    categoryCode: "seating",
    categoryName: "Seating",
    furnitureTypeCode: "sofa",
    furnitureTypeName: "Sofa",
    productTitle: `Timber Sofa ${variantId}`,
    roomaiDescription: null,
    normalizedColor: "tan",
    normalizedMaterial: "leather",
    normalizedStyle: "modern",
    configuration: "three-seat",
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
    vendorName: "Internal Vendor",
    productUrl: "https://example.com/internal-product",
    primaryImageUrl: null,
    ...overrides,
  };
}

test("spatial incompatibility excludes an otherwise excellent candidate", () => {
  const current = candidate("current", { widthCm: 490, depthCm: 95 });
  const oversized = candidate("oversized", { widthCm: 490, depthCm: 95 });

  const ranked = rankSuitableCatalogAlternatives(current, [oversized], context, 4);

  assert.deepEqual(ranked, []);
});

test("spatially compatible candidates remain eligible", () => {
  const current = candidate("current");
  const alternative = candidate("alternative");

  const ranked = rankSuitableCatalogAlternatives(current, [alternative], context, 4);

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].spatialCompatibility.status, "compatible");
  assert.equal(ALTERNATIVE_SUITABILITY_WEIGHTS.catalogSimilarity, 0.7);
  assert.equal(ALTERNATIVE_SUITABILITY_WEIGHTS.aestheticCompatibility, 0.3);
});

test("better aesthetic compatibility improves ordering when otherwise comparable", () => {
  const current = candidate("current");
  const aestheticMatch = candidate("aesthetic-match");
  const aestheticChange = candidate("aesthetic-change", {
    normalizedStyle: "traditional",
    normalizedMaterial: "fabric",
    normalizedColor: "purple",
    configuration: "sectional",
  });

  const ranked = rankSuitableCatalogAlternatives(
    current,
    [aestheticChange, aestheticMatch],
    context,
    4,
  );

  assert.equal(ranked[0].candidate.variantId, "aesthetic-match");
  assert.ok(ranked[0].aestheticCompatibility.score > ranked[1].aestheticCompatibility.score);
});

test("existing catalog ranking factors still influence suitability ordering", () => {
  const current = candidate("current");
  const closePrice = candidate("close-price", { roomaiSellingPrice: 1850 });
  const distantPrice = candidate("distant-price", { roomaiSellingPrice: 3200 });

  const ranked = rankSuitableCatalogAlternatives(
    current,
    [distantPrice, closePrice],
    context,
    4,
  );

  assert.equal(ranked[0].candidate.variantId, "close-price");
  assert.ok(ranked[0].score > ranked[1].score);
  assert.equal(ranked[0].aestheticCompatibility.score, ranked[1].aestheticCompatibility.score);
});

test("unknown spatial compatibility is excluded conservatively", () => {
  const ranked = rankSuitableCatalogAlternatives(
    candidate("current"),
    [candidate("missing-dimensions", { widthCm: null })],
    context,
    4,
  );

  assert.deepEqual(ranked, []);
});

test("customer-safe alternatives do not leak internal suitability or catalog fields", () => {
  const ranked = rankSuitableCatalogAlternatives(
    candidate("current"),
    [candidate("alternative")],
    context,
    4,
  );
  const customer = toRoomAIAlternatives(ranked);
  const serialized = JSON.stringify(customer);

  assert.equal(serialized.includes("vendorName"), false);
  assert.equal(serialized.includes("productUrl"), false);
  assert.equal(serialized.includes("variantId"), false);
  assert.equal(serialized.includes("productId"), false);
  assert.equal(serialized.includes("suitabilityScore"), false);
  assert.equal(serialized.includes("spatialCompatibility"), false);
  assert.equal(serialized.includes("aestheticCompatibility"), false);
});

test("green leather Timber sofa remains a valid alternative to tan Timber sofa", () => {
  const current = candidate("timber-tan", { normalizedColor: "tan" });
  const green = candidate("timber-green", { normalizedColor: "green" });

  const ranked = rankSuitableCatalogAlternatives(current, [green], context, 4);

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].candidate.variantId, "timber-green");
  assert.equal(ranked[0].spatialCompatibility.status, "compatible");
  assert.equal(ranked[0].aestheticCompatibility.status, "compatible");
});
