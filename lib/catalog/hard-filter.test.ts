import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateCatalogHardFilters } from "@/lib/catalog/hard-filter";
import {
  catalogCandidateSchema,
  catalogQuerySchema,
  type CatalogCandidate,
} from "@/lib/catalog/schema";

function candidate(
  overrides: Partial<CatalogCandidate> = {},
): CatalogCandidate {
  return catalogCandidateSchema.parse({
    productId: "product-1",
    variantId: "variant-1",
    countryCode: "US",
    categoryCode: "living_room",
    categoryName: "Living Room",
    furnitureTypeCode: "sofa",
    furnitureTypeName: "Sofa",
    productTitle: "Test Sofa",
    roomaiDescription: null,
    normalizedColor: "tan",
    normalizedMaterial: "leather",
    normalizedStyle: "modern",
    configuration: null,
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
    vendorName: "Test Vendor",
    productUrl: "https://example.com/product",
    primaryImageUrl: null,
    ...overrides,
  });
}

test("matching candidate passes explicit hard filters", () => {
  const query = catalogQuerySchema.parse({
    countryCode: "US",
    furnitureTypeCode: "sofa",
    normalizedAvailability: "in_stock",
    currency: "USD",
    maxPrice: 2000,
    maxWidthCm: 230,
    maxDepthCm: 100,
    maxHeightCm: 90,
  });

  assert.deepEqual(evaluateCatalogHardFilters(candidate(), query), {
    eligible: true,
    reasons: [],
  });
});

test("market and furniture type are hard eligibility constraints", () => {
  const query = catalogQuerySchema.parse({
    countryCode: "US",
    furnitureTypeCode: "sofa",
  });

  const result = evaluateCatalogHardFilters(
    candidate({
      countryCode: "CA",
      furnitureTypeCode: "sectional_sofa",
    }),
    query,
  );

  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasons, [
    "country_mismatch",
    "furniture_type_mismatch",
  ]);
});

test("explicit availability and currency are hard constraints", () => {
  const query = catalogQuerySchema.parse({
    countryCode: "US",
    furnitureTypeCode: "sofa",
    normalizedAvailability: "in_stock",
    currency: "USD",
  });

  const result = evaluateCatalogHardFilters(
    candidate({
      normalizedAvailability: "out_of_stock",
      currency: "CAD",
    }),
    query,
  );

  assert.equal(result.eligible, false);
  assert.deepEqual(result.reasons, [
    "availability_mismatch",
    "currency_mismatch",
  ]);
});

test("missing price fails only when an explicit maximum price is required", () => {
  const withoutMax = catalogQuerySchema.parse({
    countryCode: "US",
    furnitureTypeCode: "sofa",
  });

  assert.equal(
    evaluateCatalogHardFilters(
      candidate({ roomaiSellingPrice: null }),
      withoutMax,
    ).eligible,
    true,
  );

  const withMax = catalogQuerySchema.parse({
    countryCode: "US",
    furnitureTypeCode: "sofa",
    maxPrice: 2000,
  });

  assert.deepEqual(
    evaluateCatalogHardFilters(
      candidate({ roomaiSellingPrice: null }),
      withMax,
    ),
    {
      eligible: false,
      reasons: ["price_missing"],
    },
  );
});

test("price above an explicit maximum is rejected", () => {
  const query = catalogQuerySchema.parse({
    countryCode: "US",
    furnitureTypeCode: "sofa",
    maxPrice: 2000,
  });

  assert.deepEqual(
    evaluateCatalogHardFilters(
      candidate({ roomaiSellingPrice: 2001 }),
      query,
    ),
    {
      eligible: false,
      reasons: ["price_exceeds_max"],
    },
  );
});

test("missing constrained dimensions are rejected explicitly", () => {
  const query = catalogQuerySchema.parse({
    countryCode: "US",
    furnitureTypeCode: "sofa",
    maxWidthCm: 230,
    maxDepthCm: 100,
    maxHeightCm: 90,
  });

  assert.deepEqual(
    evaluateCatalogHardFilters(
      candidate({
        widthCm: null,
        depthCm: null,
        heightCm: null,
      }),
      query,
    ),
    {
      eligible: false,
      reasons: [
        "width_missing",
        "depth_missing",
        "height_missing",
      ],
    },
  );
});

test("dimensions exceeding explicit maxima are rejected", () => {
  const query = catalogQuerySchema.parse({
    countryCode: "US",
    furnitureTypeCode: "sofa",
    maxWidthCm: 230,
    maxDepthCm: 100,
    maxHeightCm: 90,
  });

  assert.deepEqual(
    evaluateCatalogHardFilters(
      candidate({
        widthCm: 231,
        depthCm: 101,
        heightCm: 91,
      }),
      query,
    ),
    {
      eligible: false,
      reasons: [
        "width_exceeds_max",
        "depth_exceeds_max",
        "height_exceeds_max",
      ],
    },
  );
});

test("style color material and price are not implicit hard filters", () => {
  const query = catalogQuerySchema.parse({
    countryCode: "US",
    furnitureTypeCode: "sofa",
  });

  const result = evaluateCatalogHardFilters(
    candidate({
      normalizedStyle: "traditional",
      normalizedColor: "purple",
      normalizedMaterial: "velvet",
      roomaiSellingPrice: 99999,
      normalizedAvailability: "out_of_stock",
    }),
    query,
  );

  assert.deepEqual(result, {
    eligible: true,
    reasons: [],
  });
});
