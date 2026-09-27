import { test } from "node:test";
import assert from "node:assert/strict";

import { deduplicateCatalogCandidates, resolveFurnitureTypeCode } from "@/lib/catalog/integration";
import { catalogSelectionTestHelpers } from "@/lib/designs/generation";
import { furnitureObjectSchema } from "@/lib/designs/schema";
import type { DesignSpecification } from "@/lib/designs/types";

const candidate = (variantId: string) => ({
  productId: `product-${variantId}`,
  variantId,
  countryCode: "US",
  categoryCode: "living_room",
  categoryName: "Living Room",
  furnitureTypeCode: "area_rug",
  furnitureTypeName: "Area Rug",
  productTitle: "Test Rug",
  roomaiDescription: null,
  normalizedColor: null,
  normalizedMaterial: null,
  normalizedStyle: null,
  configuration: null,
  seatingCapacity: null,
  widthCm: 100,
  depthCm: 100,
  heightCm: 1,
  weightKg: null,
  currency: "USD",
  roomaiSellingPrice: 100,
  normalizedAvailability: "in_stock",
  deliveryText: null,
  estimatedDeliveryDaysMin: null,
  estimatedDeliveryDaysMax: null,
  vendorDataCheckedAt: null,
  roomaiPriceCalculatedAt: null,
  vendorName: "Test Vendor",
  productUrl: "https://example.com/products/test-product",
  primaryImageUrl: "https://example.com/images/test-product.jpg",
});

test("resolves only supported furniture type aliases", () => {
  assert.equal(resolveFurnitureTypeCode("rug"), "area_rug");
  assert.equal(resolveFurnitureTypeCode(" Area   Rug "), "area_rug");
  assert.equal(resolveFurnitureTypeCode("area_rug"), "area_rug");
  assert.equal(resolveFurnitureTypeCode("sofa"), "sofa");
});

test("deduplicates catalog candidates by variantId", () => {
  const first = candidate("variant-1");
  const duplicate = { ...first, productTitle: "Duplicate" };
  const second = candidate("variant-2");

  assert.deepEqual(deduplicateCatalogCandidates([first, duplicate, second]), [first, second]);
});

test("furniture schema does not expose catalog identity fields", () => {
  const result = furnitureObjectSchema.safeParse({
    objectId: "object-1",
    category: "rug",
    name: "Rug",
    description: "A rug",
    material: "wool",
    color: "ivory",
    dimensions: { widthCm: 100, depthCm: 100, heightCm: 1 },
    position: { xCm: 0, yCm: 0, zCm: 0 },
    rotationDegrees: 0,
    required: true,
    estimatedPrice: 100,
    catalogSelectionKey: null,
    reasoning: "Fits the room.",
    productId: "product-1",
    variantId: "variant-1",
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal("productId" in result.data, false);
    assert.equal("variantId" in result.data, false);
  }
});

const specificationWithKeys = (keys: Array<string | null>): DesignSpecification => ({
  contractVersion: "1.0",
  designName: "Catalog Keys",
  summary: "Catalog key resolution test.",
  room: { widthCm: 300, lengthCm: 400, heightCm: 250, roomType: "living_room" },
  palette: { walls: "white", primary: "blue", secondary: "gray", accent: "black", metal: "brass" },
  surfaces: { walls: "paint", floor: "wood", ceiling: "paint" },
  lighting: { ambient: "ceiling", task: "lamp", accent: "sconce" },
  furniture: keys.map((catalogSelectionKey, index) => ({
    objectId: `object-${index + 1}`,
    category: "rug",
    name: "Rug",
    description: "A rug",
    material: "wool",
    color: "ivory",
    dimensions: { widthCm: 100, depthCm: 100, heightCm: 1 },
    position: { xCm: 0, yCm: 0, zCm: 0 },
    rotationDegrees: 0,
    required: true,
    estimatedPrice: 100,
    catalogSelectionKey,
    reasoning: "Fits the room.",
  })),
  decorations: [],
  budget: { low: 0, high: 1000, currency: "USD" },
  advice: ["Keep clearances open."],
  warnings: [],
});

test("valid catalog candidate keys resolve to paired product and variant ids", () => {
  const { selectionByKey } = catalogSelectionTestHelpers.createCatalogCandidateSelectionContext([
    candidate("variant-1"),
    candidate("variant-2"),
  ]);
  const { catalogSelectionsByObjectId } = catalogSelectionTestHelpers.resolveCatalogSelections(
    specificationWithKeys(["candidate_1", "candidate_2"]),
    selectionByKey,
  );

  assert.deepEqual(catalogSelectionsByObjectId["object-1"], {
    catalogProductId: "product-variant-1",
    catalogProductVariantId: "variant-1",
  });
  assert.deepEqual(catalogSelectionsByObjectId["object-2"], {
    catalogProductId: "product-variant-2",
    catalogProductVariantId: "variant-2",
  });
});

test("null or invented catalog candidate keys do not resolve to catalog ids", () => {
  const { selectionByKey } = catalogSelectionTestHelpers.createCatalogCandidateSelectionContext([candidate("variant-1")]);
  const { specification, catalogSelectionsByObjectId } = catalogSelectionTestHelpers.resolveCatalogSelections(
    specificationWithKeys([null, "candidate_999"]),
    selectionByKey,
  );

  assert.deepEqual(catalogSelectionsByObjectId, {});
  assert.equal(specification.furniture[0].catalogSelectionKey, null);
  assert.equal(specification.furniture[1].catalogSelectionKey, null);
});

test("AI catalog candidate contract exposes only generation-safe fields", () => {
  const { aiCandidates } =
    catalogSelectionTestHelpers.createCatalogCandidateSelectionContext([
      candidate("variant-safe"),
    ]);

  assert.equal(aiCandidates.length, 1);

  assert.deepEqual(Object.keys(aiCandidates[0]).sort(), [
    "catalogSelectionKey",
    "configuration",
    "currency",
    "dimensions",
    "furnitureTypeCode",
    "furnitureTypeName",
    "normalizedColor",
    "normalizedMaterial",
    "normalizedStyle",
    "productTitle",
    "roomaiDescription",
    "roomaiSellingPrice",
    "seatingCapacity",
  ].sort());

  assert.equal("productId" in aiCandidates[0], false);
  assert.equal("variantId" in aiCandidates[0], false);
  assert.equal("vendorName" in aiCandidates[0], false);
  assert.equal("productUrl" in aiCandidates[0], false);
  assert.equal("primaryImageUrl" in aiCandidates[0], false);
  assert.equal("normalizedAvailability" in aiCandidates[0], false);
  assert.equal("deliveryText" in aiCandidates[0], false);
  assert.equal("vendorDataCheckedAt" in aiCandidates[0], false);
  assert.equal("roomaiPriceCalculatedAt" in aiCandidates[0], false);
});

test("AI catalog candidate uses opaque key while server retains catalog identity", () => {
  const { aiCandidates, selectionByKey } =
    catalogSelectionTestHelpers.createCatalogCandidateSelectionContext([
      candidate("variant-contract"),
    ]);

  assert.equal(aiCandidates[0].catalogSelectionKey, "candidate_1");

  assert.deepEqual(selectionByKey["candidate_1"], {
    catalogProductId: "product-variant-contract",
    catalogProductVariantId: "variant-contract",
  });

  assert.equal(
    JSON.stringify(aiCandidates).includes("product-variant-contract"),
    false,
  );
  assert.equal(
    JSON.stringify(aiCandidates).includes("variant-contract"),
    false,
  );
});
