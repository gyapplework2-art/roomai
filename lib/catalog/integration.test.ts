import { test } from "node:test";
import assert from "node:assert/strict";

import {
  aiCatalogCandidateSchema,
  deduplicateCatalogCandidates,
  resolveFurnitureTypeCode,
  selectDesignCatalogCandidates,
  createSemanticCatalogQuery,
  createSemanticCatalogCandidatePool,
  createSemanticCatalogCandidateSelectionContext,
} from "@/lib/catalog/integration";
import type { RoomConstrainedPlanItem } from "@/lib/furniture-planning/room-constraints";
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
  for (const unsupported of ["chair", "sofa bed", "ottoman", "PRIMARY_SEATING", "SECONDARY_SEATING", "plant", "__proto__", "constructor"]) {
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

export function coffeeTableRequirement(id = "table-1"): RoomConstrainedPlanItem {
  const range = { widthMinCm: 80, widthMaxCm: 140, depthMinCm: 45, depthMaxCm: 80, heightMinCm: 35, heightMaxCm: 50 };
  return {
    item: {
      id, category: "coffee_table", subtype: null, priority: "required",
      placement: { preferredZone: null, anchorWallId: null, approximatePosition: { xCm: 200, yCm: 200 }, preferredOrientationDegrees: 0 },
      sizeRange: range, styleHints: [], materialHints: [], colorHints: [], functionalRequirements: [], reasoning: "Coffee surface",
      semanticPlacement: { role: "COFFEE_TABLE", mode: "FLOATING", alignment: null, zoneId: null, targetWallId: null, relationships: [], fallbackModes: [] },
    },
    normalizedCategory: "coffee_table", normalizedSubtype: null, marketRule: null,
    preferredRange: range, marketRange: range, searchRange: range, status: "ready",
    roomConstraint: null, finalSearchRange: range, roomStatus: "ready",
  };
}

const coffeeCandidate = () => ({ ...candidate("coffee-variant"), furnitureTypeCode: "coffee_table", widthCm: 100, depthCm: 60, heightCm: 40 });

test("coffee-table requirement uses bounded catalog query and item-bound opaque pools", () => {
  const item = coffeeTableRequirement();
  assert.deepEqual(createSemanticCatalogQuery(item, "USD"), {
    countryCode: "US", furnitureTypeCode: "coffee_table", currency: "USD", normalizedAvailability: "in_stock",
    maxWidthCm: 140, maxDepthCm: 80, maxHeightCm: 50, limit: 30,
  });
  const pool = createSemanticCatalogCandidatePool(item, [coffeeCandidate()], "USD");
  const context = createSemanticCatalogCandidateSelectionContext([pool]);
  assert.equal(context.aiCandidatePools[0].planItemId, "table-1");
  assert.equal(context.selectionByKey.candidate_1.planItemId, "table-1");
  assert.equal(context.aiCandidatePools[0].candidates[0].normalizedMaterial, null);
  const visible = JSON.stringify(context.aiCandidatePools);
  for (const privateValue of ["coffee-variant", "product-coffee-variant", "Test Vendor", "https://example.com"]) {
    assert.equal(visible.includes(privateValue), false);
  }
});

test("coffee-table eligibility enforces complete ranges and usable catalog facts", () => {
  const item = coffeeTableRequirement();
  const valid = coffeeCandidate();
  const invalid = [
    { ...valid, widthCm: 79 }, { ...valid, widthCm: 141 },
    { ...valid, depthCm: 44 }, { ...valid, depthCm: 81 },
    { ...valid, heightCm: 34 }, { ...valid, heightCm: 51 },
    { ...valid, widthCm: null }, { ...valid, depthCm: 0 }, { ...valid, heightCm: Number.NaN },
    { ...valid, roomaiSellingPrice: null }, { ...valid, roomaiSellingPrice: -1 }, { ...valid, roomaiSellingPrice: Infinity },
    { ...valid, primaryImageUrl: null }, { ...valid, primaryImageUrl: "invalid" },
    { ...valid, furnitureTypeCode: "sofa" }, { ...valid, normalizedAvailability: "out_of_stock" },
    { ...valid, currency: "CAD" }, { ...valid, countryCode: "CA" },
  ];
  for (const entry of invalid) assert.deepEqual(createSemanticCatalogCandidatePool(item, [entry], "USD").candidates, []);
  assert.equal(createSemanticCatalogCandidatePool(item, [valid, ...invalid], "USD").candidates.length, 1);
});

test("empty, unsupported and room-conflicted pools stay unmatched", () => {
  const item = coffeeTableRequirement();
  assert.deepEqual(createSemanticCatalogCandidatePool(item, [], "USD").candidates, []);
  for (const skipped of [{ ...item, normalizedCategory: "desk" }, { ...item, roomStatus: "room_conflict" as const }, { ...item, finalSearchRange: null }]) {
    assert.equal(createSemanticCatalogQuery(skipped, "USD"), null);
    assert.deepEqual(createSemanticCatalogCandidatePool(skipped, [coffeeCandidate()], "USD").candidates, []);
  }
});

test("existing crosswalk types share eligibility ranking and privacy without new aliases", () => {
  for (const [category, type] of [["sofa", "sofa"], ["sectional", "sectional_sofa"], ["armchair", "accent_chair"], ["rug", "area_rug"]]) {
    const item = { ...coffeeTableRequirement(`${type}-1`), normalizedCategory: category };
    const real = { ...coffeeCandidate(), furnitureTypeCode: type };
    const query = createSemanticCatalogQuery(item, "USD");
    assert.equal(query?.furnitureTypeCode, type);
    const pool = createSemanticCatalogCandidatePool(item, [real, { ...real, furnitureTypeCode: "coffee_table" }], "USD");
    assert.equal(pool.furnitureTypeCode, type);
    assert.deepEqual(pool.candidates, [real]);
    const context = createSemanticCatalogCandidateSelectionContext([pool]);
    assert.equal(context.selectionByKey.candidate_1.furnitureTypeCode, type);
    const visible = JSON.stringify(context.aiCandidatePools);
    for (const privateValue of ["coffee-variant", "product-coffee-variant", "Test Vendor", "https://example.com"]) {
      assert.equal(visible.includes(privateValue), false);
    }
    for (const invalid of [{ ...real, widthCm: 79 }, { ...real, heightCm: 51 }, { ...real, roomaiSellingPrice: null }, { ...real, primaryImageUrl: null }]) {
      assert.deepEqual(createSemanticCatalogCandidatePool(item, [invalid], "USD").candidates, []);
    }
  }
});

test("unresolved or mismatched pool types cannot offer candidate keys", () => {
  for (const furnitureTypeCode of [null, "desk", "sofa"]) {
    const context = createSemanticCatalogCandidateSelectionContext([{
      planItemId: "unresolved-1", furnitureTypeCode, candidates: [coffeeCandidate()],
    }]);
    assert.deepEqual(context.selectionByKey, {});
    assert.deepEqual(context.aiCandidatePools[0].candidates, []);
  }
});
