import assert from "node:assert/strict";
import test from "node:test";

import {
  rankAlternativesFromCandidatePool,
  rankAttributeAwareAlternativesFromCandidatePool,
} from "@/lib/catalog/alternative-batch";
import type { CatalogCandidate } from "@/lib/catalog/schema";
import type { AlternativeSuitabilityContext } from "@/lib/catalog/alternative-suitability";
import { normalizeFurnitureAttributes } from "@/lib/design-intelligence/furniture-attributes";

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
    productUrl: "https://example.com/product",
    primaryImageUrl: null,
    ...overrides,
  };
}

test("uses only candidates with the same country and furniture type", () => {
  const current = candidate("current");

  const ranked = rankAlternativesFromCandidatePool(
    current,
    [
      current,
      candidate("sofa-us"),
      candidate("rug-us", {
        furnitureTypeCode: "rug",
        furnitureTypeName: "Rug",
      }),
      candidate("sofa-ca", {
        countryCode: "CA",
      }),
    ],
    10,
  );

  assert.deepEqual(
    ranked.map((item) => item.candidate.variantId),
    ["sofa-us"],
  );
});

test("excludes the current variant", () => {
  const current = candidate("current");

  const ranked = rankAlternativesFromCandidatePool(
    current,
    [
      current,
      candidate("alternative"),
    ],
    10,
  );

  assert.deepEqual(
    ranked.map((item) => item.candidate.variantId),
    ["alternative"],
  );
});

test("ranks suitable candidates before applying the result limit", () => {
  const current = candidate("current");

  const poor = candidate("poor", {
    normalizedColor: "blue",
    normalizedMaterial: "fabric",
    normalizedStyle: "traditional",
    configuration: "sectional",
    seatingCapacity: 6,
    widthCm: 340,
    depthCm: 160,
    heightCm: 110,
    roomaiSellingPrice: 3500,
  });

  const close = candidate("close", {
    widthCm: 225,
    depthCm: 98,
    heightCm: 84,
    roomaiSellingPrice: 1850,
  });

  const ranked = rankAlternativesFromCandidatePool(
    current,
    [poor, close],
    1,
  );

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].candidate.variantId, "close");
});

const suitabilityContext: AlternativeSuitabilityContext = {
  currentObjectId: "selected",
  designObject: { x_cm: 250, y_cm: 200, rotation_degrees: 0 },
  geometry: {
    schemaVersion: "1.0",
    shapeType: "rectangle",
    templateTransform: { rotationDegrees: 0, mirroredHorizontal: false, mirroredVertical: false },
    ceilingHeightCm: 250,
    vertices: [
      { id: "a", xCm: 0, yCm: 0 }, { id: "b", xCm: 500, yCm: 0 },
      { id: "c", xCm: 500, yCm: 400 }, { id: "d", xCm: 0, yCm: 400 },
    ],
    wallSegments: [
      { id: "ab", startVertexId: "a", endVertexId: "b" },
      { id: "bc", startVertexId: "b", endVertexId: "c" },
      { id: "cd", startVertexId: "c", endVertexId: "d" },
      { id: "da", startVertexId: "d", endVertexId: "a" },
    ],
  },
  openings: [],
  neighbors: [],
};

test("async path requests one deduplicated batch of current and eligible variant IDs", async () => {
  const current = candidate("current");
  const eligible = candidate("alternative");
  const inputs = [current, eligible, eligible, candidate("other-market", { countryCode: "CA" }), candidate("rug", { furnitureTypeCode: "rug" })];
  const snapshot = structuredClone(inputs);
  const calls: string[][] = [];
  const ranked = await rankAttributeAwareAlternativesFromCandidatePool(current, inputs, 4, suitabilityContext, async (ids, capacities) => {
    calls.push([...ids]);
    assert.equal(capacities.get("current"), 3);
    assert.equal(capacities.get("alternative"), 3);
    return new Map(ids.map((id) => [id, normalizeFurnitureAttributes({ seatingCapacity: capacities.get(id) ?? null })]));
  });

  assert.deepEqual(calls, [["current", "alternative"]]);
  assert.ok(ranked.every((item) => item.candidate.variantId === "alternative"));
  assert.deepEqual(inputs, snapshot);
});

test("missing attribute data or failed lookup keeps legacy ordering and eligibility", async () => {
  const current = candidate("current");
  const alternatives = [candidate("b"), candidate("a")];
  const baseline = rankAlternativesFromCandidatePool(current, alternatives, 1, suitabilityContext);
  const missing = await rankAttributeAwareAlternativesFromCandidatePool(current, alternatives, 1, suitabilityContext, async () => new Map());
  const failed = await rankAttributeAwareAlternativesFromCandidatePool(current, alternatives, 1, suitabilityContext, async () => { throw new Error("lookup unavailable"); });

  assert.deepEqual(missing, baseline);
  assert.deepEqual(failed, baseline);
  assert.equal(missing[0]?.candidate.variantId, "a");
});
