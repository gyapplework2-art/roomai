import { test } from "node:test";
import assert from "node:assert/strict";

import {
  aiCatalogCandidateSchema,
  deduplicateCatalogCandidates,
  resolveFurnitureTypeCode,
  selectDesignCatalogCandidates,
} from "@/lib/catalog/integration";
import { furnitureRoles } from "@/lib/furniture-planning/semantic-types";
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

test("resolves approved P0 catalog codes and customer/design aliases", () => {
  const mappings = [
    ["sofa", "sofa"],
    ["sectional", "sectional_sofa"],
    ["sectional_sofa", "sectional_sofa"],
    ["accent chair", "accent_chair"],
    ["accent_chair", "accent_chair"],
    ["armchair", "accent_chair"],
    ["coffee table", "coffee_table"],
    ["coffee_table", "coffee_table"],
    ["rug", "area_rug"],
    ["area rug", "area_rug"],
    ["area_rug", "area_rug"],
  ] as const;
  for (const [input, expected] of mappings) assert.equal(resolveFurnitureTypeCode(input), expected);
});

test("normalizes case, whitespace, hyphens, and underscores without fuzzy matching", () => {
  assert.equal(resolveFurnitureTypeCode("  SECTIONAL   SOFA "), "sectional_sofa");
  assert.equal(resolveFurnitureTypeCode("Sectional-Sofa"), "sectional_sofa");
  assert.equal(resolveFurnitureTypeCode("ACCENT_CHAIR"), "accent_chair");
  assert.equal(resolveFurnitureTypeCode("Coffee-Table"), "coffee_table");
  assert.equal(resolveFurnitureTypeCode("Area_Rug"), "area_rug");
  for (const unsupported of ["chair", "sofa bed", "ottoman", "PRIMARY_SEATING", "SECONDARY_SEATING", "plant"]) {
    assert.equal(resolveFurnitureTypeCode(unsupported), null);
  }
});

test("semantic role identifiers remain distinct from catalog furniture types", () => {
  assert.deepEqual(furnitureRoles, [
    "PRIMARY_SEATING", "SECONDARY_SEATING", "COFFEE_TABLE", "SIDE_TABLE", "AREA_RUG",
    "MEDIA_CONSOLE", "STORAGE", "TASK_LIGHTING", "AMBIENT_LIGHTING",
  ]);
  assert.equal(resolveFurnitureTypeCode("PRIMARY_SEATING"), null);
  assert.equal(resolveFurnitureTypeCode("SECONDARY_SEATING"), null);
  assert.equal(resolveFurnitureTypeCode("SIDE_TABLE"), null);
  assert.equal(resolveFurnitureTypeCode("TASK_LIGHTING"), null);
  assert.equal(resolveFurnitureTypeCode("AMBIENT_LIGHTING"), null);
});

test("deduplicates catalog candidates by variantId", () => {
  const first = candidate("variant-1");
  const duplicate = { ...first, productTitle: "Duplicate" };
  const second = candidate("variant-2");

  assert.deepEqual(deduplicateCatalogCandidates([first, duplicate, second]), [first, second]);
});

test("design candidate selection ranks the larger pool and favors distinct products before extra variants", () => {
  const incomplete = Array.from({ length: 10 }, (_, index) => ({
    ...candidate(`early-${index}`),
    productId: "shared-product",
    widthCm: null,
    depthCm: null,
    heightCm: null,
    roomaiSellingPrice: null,
  }));
  const best = candidate("late-best");
  const chosen = selectDesignCatalogCandidates([[
    ...incomplete,
    best,
    { ...best, productTitle: "Duplicate variant" },
  ]], 2);

  assert.deepEqual(chosen.map((item) => item.variantId), ["late-best", "early-0"]);
  assert.equal(chosen[0].productTitle, best.productTitle);
  assert.equal(selectDesignCatalogCandidates([[best], [best]]).length, 1);
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
  const { aiCandidates } = catalogSelectionTestHelpers.createCatalogCandidateSelectionContext([
    candidate("variant-safe"),
  ]);

  assert.equal(aiCandidates.length, 1);
  assert.deepEqual(Object.keys(aiCandidates[0]).sort(), [
    "catalogSelectionKey", "configuration", "currency", "dimensions",
    "furnitureTypeCode", "furnitureTypeName", "normalizedColor", "normalizedMaterial",
    "normalizedStyle", "productTitle", "roomaiDescription", "roomaiSellingPrice",
    "seatingCapacity",
  ].sort());
  for (const internal of [
    "productId", "variantId", "vendorName", "productUrl", "primaryImageUrl",
    "normalizedAvailability", "deliveryText", "vendorDataCheckedAt", "roomaiPriceCalculatedAt",
  ]) {
    assert.equal(internal in aiCandidates[0], false);
  }
  assert.equal(aiCatalogCandidateSchema.safeParse({ ...aiCandidates[0], vendorName: "Internal Vendor" }).success, false);
});

test("AI catalog candidate uses an opaque key while server retains catalog identity", () => {
  const { aiCandidates, selectionByKey } = catalogSelectionTestHelpers.createCatalogCandidateSelectionContext([
    candidate("variant-contract"),
  ]);

  assert.equal(aiCandidates[0].catalogSelectionKey, "candidate_1");
  assert.deepEqual(selectionByKey["candidate_1"], {
    catalogProductId: "product-variant-contract",
    catalogProductVariantId: "variant-contract",
  });
  assert.equal(JSON.stringify(aiCandidates).includes("product-variant-contract"), false);
  assert.equal(JSON.stringify(aiCandidates).includes("variant-contract"), false);
});
