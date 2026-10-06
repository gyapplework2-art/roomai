import { test } from "node:test";
import assert from "node:assert/strict";

import { catalogSelectionTestHelpers } from "@/lib/designs/generation";
import { createDesignObjectInserts } from "@/lib/designs/persistence";
import type { DesignSpecification } from "@/lib/designs/types";
import type { CatalogCandidate } from "@/lib/catalog/schema";
import { createSemanticCatalogCandidateSelectionContext } from "@/lib/catalog/integration";

function candidate(
  productId: string,
  variantId: string,
): CatalogCandidate {
  return {
    productId,
    variantId,
    countryCode: "US",
    categoryCode: "living_room",
    categoryName: "Living Room",
    furnitureTypeCode: "sofa",
    furnitureTypeName: "Sofa",
    productTitle: "Boundary Test Sofa",
    roomaiDescription: "A catalog-grounded sofa.",
    normalizedColor: "tan",
    normalizedMaterial: "leather",
    normalizedStyle: "modern",
    configuration: "3-seat",
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
    vendorName: "Internal Test Vendor",
    productUrl: "https://example.com/product",
    primaryImageUrl: null,
  };
}

function specification(
  catalogSelectionKey: string | null,
): DesignSpecification {
  return {
    contractVersion: "1.0",
    designName: "Generation Boundary Test",
    summary: "Tests catalog identity resolution and persistence.",
    room: {
      widthCm: 300,
      lengthCm: 400,
      heightCm: 250,
      roomType: "living_room",
    },
    palette: {
      walls: "white",
      primary: "tan",
      secondary: "cream",
      accent: "black",
      metal: "brass",
    },
    surfaces: {
      walls: "paint",
      floor: "wood",
      ceiling: "paint",
    },
    lighting: {
      ambient: "ceiling",
      task: "lamp",
      accent: "sconce",
    },
    furniture: [
      {
        objectId: "sofa-1",
        category: "sofa",
        name: "Sofa",
        description: "A sofa.",
        material: "leather",
        color: "tan",
        dimensions: {
          widthCm: 220,
          depthCm: 95,
          heightCm: 85,
        },
        position: {
          xCm: 100,
          yCm: 100,
          zCm: 0,
        },
        rotationDegrees: 0,
        required: true,
        estimatedPrice: 1800,
        catalogSelectionKey,
        reasoning: "Primary seating.",
      },
    ],
    decorations: [],
    budget: {
      low: 0,
      high: 3000,
      currency: "USD",
    },
    advice: [],
    warnings: [],
  };
}

test("valid opaque catalog key persists only its server-resolved product and variant identity", () => {
  const { aiCandidates, selectionByKey } =
    catalogSelectionTestHelpers.createCatalogCandidateSelectionContext([
      candidate("server-product-1", "server-variant-1"),
    ]);

  assert.equal(aiCandidates[0].catalogSelectionKey, "candidate_1");
  assert.equal("productId" in aiCandidates[0], false);
  assert.equal("variantId" in aiCandidates[0], false);
  assert.equal("vendorName" in aiCandidates[0], false);
  assert.equal("productUrl" in aiCandidates[0], false);

  const resolved =
    catalogSelectionTestHelpers.resolveCatalogSelections(
      specification("candidate_1"),
      selectionByKey,
    );

  const [insert] = createDesignObjectInserts(
    "design-1",
    resolved.specification,
    resolved.catalogSelectionsByObjectId,
  );

  assert.equal(insert.catalog_product_id, "server-product-1");
  assert.equal(insert.catalog_product_variant_id, "server-variant-1");
  assert.equal(insert.product_id, null);
});

test("invented opaque catalog key cannot create persisted catalog identity", () => {
  const { selectionByKey } =
    catalogSelectionTestHelpers.createCatalogCandidateSelectionContext([
      candidate("server-product-1", "server-variant-1"),
    ]);

  const resolved =
    catalogSelectionTestHelpers.resolveCatalogSelections(
      specification("candidate_999"),
      selectionByKey,
    );

  assert.equal(
    resolved.specification.furniture[0].catalogSelectionKey,
    null,
  );
  assert.deepEqual(resolved.catalogSelectionsByObjectId, {});

  const [insert] = createDesignObjectInserts(
    "design-1",
    resolved.specification,
    resolved.catalogSelectionsByObjectId,
  );

  assert.equal(insert.catalog_product_id, null);
  assert.equal(insert.catalog_product_variant_id, null);
  assert.equal(insert.product_id, null);
});

function semanticContext() {
  const coffee = { ...candidate("server-coffee-product", "server-coffee-variant"), furnitureTypeCode: "coffee_table", widthCm: 110, depthCm: 65, heightCm: 40, normalizedMaterial: null, roomaiSellingPrice: 700 };
  return createSemanticCatalogCandidateSelectionContext([
    { planItemId: "table-1", furnitureTypeCode: "coffee_table", candidates: [coffee] },
    { planItemId: "table-2", furnitureTypeCode: "coffee_table", candidates: [coffee] },
  ]);
}

function coffeeSpecification(key: string | null): DesignSpecification {
  const original = specification(key);
  return {
    ...original, budget: { ...original.budget, currency: "CAD" },
    furniture: [{ ...original.furniture[0], objectId: "table-1", category: "coffee_table", dimensions: { widthCm: 1, depthCm: 1, heightCm: 1 }, estimatedPrice: 1 }],
  };
}

test("semantic coffee-table selection uses authoritative dimensions price currency and persisted identity", () => {
  const context = semanticContext();
  const result = catalogSelectionTestHelpers.resolveSemanticCatalogSelections(coffeeSpecification("candidate_1"), context, "USD");
  assert.deepEqual(result.specification.furniture[0].dimensions, { widthCm: 110, depthCm: 65, heightCm: 40 });
  assert.equal(result.specification.furniture[0].estimatedPrice, 700);
  assert.equal(result.specification.budget.currency, "USD");
  assert.equal(context.aiCandidatePools[0].candidates[0].normalizedMaterial, null);
  const [insert] = createDesignObjectInserts("design-1", result.specification, result.catalogSelectionsByObjectId);
  assert.equal(insert.catalog_product_id, "server-coffee-product");
  assert.equal(insert.catalog_product_variant_id, "server-coffee-variant");
  assert.equal(insert.width_cm, 110);
  assert.equal(insert.depth_cm, 65);
  assert.equal(insert.height_cm, 40);
});

test("invented and cross-semantic-item keys cannot bind coffee-table identity", () => {
  for (const key of ["candidate_999", "candidate_2", "__proto__", "constructor"]) {
    const result = catalogSelectionTestHelpers.resolveSemanticCatalogSelections(coffeeSpecification(key), semanticContext(), "USD");
    assert.equal(result.specification.furniture[0].catalogSelectionKey, null);
    assert.deepEqual(result.catalogSelectionsByObjectId, {});
    assert.equal(result.specification.furniture[0].estimatedPrice, 1);
  }
});

test("wrong furniture type and currency cannot bind semantic selection", () => {
  const context = semanticContext();
  const wrongObject = coffeeSpecification("candidate_1");
  wrongObject.furniture[0].category = "sofa";
  assert.deepEqual(catalogSelectionTestHelpers.resolveSemanticCatalogSelections(wrongObject, context, "USD").catalogSelectionsByObjectId, {});
  context.selectionByKey.candidate_1.candidate.furnitureTypeCode = "sofa";
  assert.deepEqual(catalogSelectionTestHelpers.resolveSemanticCatalogSelections(coffeeSpecification("candidate_1"), context, "USD").catalogSelectionsByObjectId, {});
  assert.deepEqual(catalogSelectionTestHelpers.resolveSemanticCatalogSelections(coffeeSpecification("candidate_1"), semanticContext(), "CAD").catalogSelectionsByObjectId, {});
});

test("empty coffee pools and non-coffee furniture retain unmatched specification and null identity", () => {
  const empty = createSemanticCatalogCandidateSelectionContext([{ planItemId: "table-1", furnitureTypeCode: "coffee_table", candidates: [] }]);
  const input = coffeeSpecification(null);
  const result = catalogSelectionTestHelpers.resolveSemanticCatalogSelections(input, empty, "USD");
  assert.deepEqual(result.specification, input);
  assert.deepEqual(result.catalogSelectionsByObjectId, {});
  const sofa = specification(null);
  assert.deepEqual(catalogSelectionTestHelpers.resolveSemanticCatalogSelections(sofa, semanticContext(), "USD").specification, sofa);
});

test("two same-type semantic sofa pools preserve independent keys and authoritative catalog persistence", () => {
  const real = candidate("server-sofa-product", "server-sofa-variant");
  const context = createSemanticCatalogCandidateSelectionContext([
    { planItemId: "sofa-1", furnitureTypeCode: "sofa", candidates: [real] },
    { planItemId: "sofa-2", furnitureTypeCode: "sofa", candidates: [real] },
  ]);
  assert.equal(context.aiCandidatePools[0].candidates[0].catalogSelectionKey, "candidate_1");
  assert.equal(context.aiCandidatePools[1].candidates[0].catalogSelectionKey, "candidate_2");
  for (const [objectId, key, crossItemKey] of [["sofa-1", "candidate_1", "candidate_2"], ["sofa-2", "candidate_2", "candidate_1"]]) {
    const input = specification(key);
    input.budget.currency = "CAD";
    input.furniture[0] = { ...input.furniture[0], objectId, dimensions: { widthCm: 1, depthCm: 1, heightCm: 1 }, estimatedPrice: 1 };
    const result = catalogSelectionTestHelpers.resolveSemanticCatalogSelections(input, context, "USD");
    assert.deepEqual(result.specification.furniture[0].dimensions, { widthCm: 220, depthCm: 95, heightCm: 85 });
    assert.equal(result.specification.furniture[0].estimatedPrice, 1800);
    assert.equal(result.specification.budget.currency, "USD");
    const [insert] = createDesignObjectInserts("design-1", result.specification, result.catalogSelectionsByObjectId);
    assert.equal(insert.catalog_product_id, "server-sofa-product");
    assert.equal(insert.catalog_product_variant_id, "server-sofa-variant");
    assert.equal(insert.width_cm, 220);
    const rejected = catalogSelectionTestHelpers.resolveSemanticCatalogSelections({
      ...input, furniture: [{ ...input.furniture[0], catalogSelectionKey: crossItemKey }],
    }, context, "USD");
    assert.deepEqual(rejected.catalogSelectionsByObjectId, {});
    assert.equal(rejected.specification.furniture[0].catalogSelectionKey, null);
  }
  const visible = JSON.stringify(context.aiCandidatePools);
  for (const privateValue of ["server-sofa-product", "server-sofa-variant", "Internal Test Vendor", "https://example.com/product"]) {
    assert.equal(visible.includes(privateValue), false);
  }
});

test("selected objects and candidates must match the semantic pool type, not only each other", () => {
  const context = semanticContext();
  context.selectionByKey.candidate_1.candidate.furnitureTypeCode = "sofa";
  const input = coffeeSpecification("candidate_1");
  input.furniture[0].category = "sofa";
  const result = catalogSelectionTestHelpers.resolveSemanticCatalogSelections(input, context, "USD");
  assert.deepEqual(result.catalogSelectionsByObjectId, {});
  assert.equal(result.specification.furniture[0].catalogSelectionKey, null);
});
