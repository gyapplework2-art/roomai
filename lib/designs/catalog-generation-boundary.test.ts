import { test } from "node:test";
import assert from "node:assert/strict";

import { catalogSelectionTestHelpers } from "@/lib/designs/generation";
import { createDesignObjectInserts } from "@/lib/designs/persistence";
import type { DesignSpecification } from "@/lib/designs/types";
import type { CatalogCandidate } from "@/lib/catalog/schema";

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
