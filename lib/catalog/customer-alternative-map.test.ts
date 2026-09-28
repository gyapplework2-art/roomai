import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAttributeAwareCustomerAlternativeMap,
  buildCustomerAlternativeMap,
} from "@/lib/catalog/customer-alternative-map";
import type { RoomAIAlternative } from "@/lib/catalog/customer-alternative";
import type { AlternativeSuitabilityContext } from "@/lib/catalog/alternative-suitability";
import type { CatalogCandidate } from "@/lib/catalog/schema";
import type { RoomGeometry } from "@/lib/geometry/types";
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

test("customer alternatives remain present when replacement identity is captured", () => {
  const current = candidate("current");
  const alternative = candidate("alternative", { productTitle: "Green Timber Sofa" });
  const customerIdentity = new Map<RoomAIAlternative, string>();

  const result = buildCustomerAlternativeMap(
    [current],
    [current, alternative],
    4,
    new Map([[current.variantId, suitabilityContext()]]),
    customerIdentity,
  );
  const displayedAlternative = result.get(current.variantId)?.[0];

  assert.ok(displayedAlternative);
  assert.equal(displayedAlternative.product.name, "Green Timber Sofa");
  assert.equal(customerIdentity.get(displayedAlternative), alternative.variantId);
});

test("missing replacement identity does not remove a customer alternative", () => {
  const current = candidate("current");
  const alternative = candidate("alternative");
  const customerIdentity = new Map<RoomAIAlternative, string>();
  const result = buildCustomerAlternativeMap(
    [current],
    [current, alternative],
    4,
    new Map([[current.variantId, suitabilityContext()]]),
    customerIdentity,
  );
  const displayedAlternative = result.get(current.variantId)?.[0];

  assert.ok(displayedAlternative);
  customerIdentity.delete(displayedAlternative);
  assert.equal(customerIdentity.has(displayedAlternative), false);
  assert.deepEqual(result.get(current.variantId), [displayedAlternative]);
});

test("replacement identity remains outside the customer-safe alternative contract", () => {
  const current = candidate("current");
  const alternative = candidate("alternative");
  const customerIdentity = new Map<RoomAIAlternative, string>();
  const result = buildCustomerAlternativeMap(
    [current],
    [current, alternative],
    4,
    new Map([[current.variantId, suitabilityContext()]]),
    customerIdentity,
  );
  const displayedAlternative = result.get(current.variantId)?.[0];

  assert.ok(displayedAlternative);
  const serialized = JSON.stringify(displayedAlternative);
  assert.equal(serialized.includes("variantId"), false);
  assert.equal(serialized.includes("productId"), false);
  assert.equal(serialized.includes("vendorName"), false);
  assert.equal(serialized.includes("productUrl"), false);
});

test("async customer map fetches one shared batch and ranks each candidate using its own attributes", async () => {
  const current = candidate("current");
  const match = candidate("z-match", { productTitle: "Matching sofa" });
  const different = candidate("a-different", { productTitle: "Different sofa" });
  const otherCurrent = candidate("other-current", { furnitureTypeCode: "rug" });
  const otherAlternative = candidate("other-alternative", { furnitureTypeCode: "rug" });
  const pool = [current, match, different, otherCurrent, otherAlternative];
  const snapshot = structuredClone(pool);
  const contexts = new Map([
    [current.variantId, suitabilityContext()],
    [otherCurrent.variantId, suitabilityContext()],
  ]);
  const identity = new Map<RoomAIAlternative, string>();
  const calls: string[][] = [];
  const loader = async (ids: readonly string[], capacities: ReadonlyMap<string, number | null>) => {
    calls.push([...ids]);
    return new Map(ids.map((id) => [id, normalizeFurnitureAttributes(
      { seatingCapacity: capacities.get(id) ?? null },
      { sourceAttributes: { "Arm Style": id === "a-different" ? "Track Arms" : "Rolled Arms" } },
    )]));
  };
  const result = await buildAttributeAwareCustomerAlternativeMap(
    [current, otherCurrent], pool, 4, contexts, identity, loader,
  );

  assert.deepEqual(calls, [["current", "z-match", "a-different", "other-current", "other-alternative"]]);
  assert.deepEqual(result.get(current.variantId)?.map((item) => item.product.name), ["Matching sofa", "Different sofa"]);
  assert.equal(result.get(otherCurrent.variantId)?.[0]?.product.name, "Product other-alternative");
  const displayed = result.get(current.variantId)?.[0];
  assert.ok(displayed);
  assert.equal(identity.get(displayed), match.variantId);
  const serialized = JSON.stringify([...result.values()].flat());
  for (const field of ["variantId", "productId", "vendorName", "productUrl", "suitabilityScore", "spatialCompatibility", "aestheticCompatibility", "furnitureAttributeCompatibility", "armStyle", "normalized_attributes"]) {
    assert.equal(serialized.includes(field), false, field);
  }
  assert.deepEqual(pool, snapshot);
  const again = await buildAttributeAwareCustomerAlternativeMap([current, otherCurrent], pool, 4, contexts, undefined, loader);
  assert.deepEqual(result, again);
});

test("async customer map preserves alternatives when attributes are absent or lookup fails", async () => {
  const current = candidate("current");
  const alternative = candidate("alternative");
  const contexts = new Map([[current.variantId, suitabilityContext()]]);
  const baseline = buildCustomerAlternativeMap([current], [alternative], 4, contexts);
  const missing = await buildAttributeAwareCustomerAlternativeMap([current], [alternative], 4, contexts, undefined, async () => new Map());
  const failed = await buildAttributeAwareCustomerAlternativeMap([current], [alternative], 4, contexts, undefined, async () => { throw new Error("attributes unavailable"); });

  assert.deepEqual(missing, baseline);
  assert.deepEqual(failed, baseline);
});
