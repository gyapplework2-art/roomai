import assert from "node:assert/strict";
import test from "node:test";

import {
  designIntelligenceContextSchema,
  designIntelligenceEvaluationSchema,
} from "./schema";

const candidate = {
  productId: "11111111-1111-4111-8111-111111111111",
  variantId: "22222222-2222-4222-8222-222222222222",
  countryCode: "US",
  categoryCode: "living_room",
  categoryName: "Living Room",
  furnitureTypeCode: "sofa",
  furnitureTypeName: "Sofa",
  productTitle: "Example Sofa",
  roomaiDescription: null,
  normalizedColor: "cream",
  normalizedMaterial: "linen",
  normalizedStyle: "modern",
  configuration: null,
  seatingCapacity: 3,
  widthCm: 220,
  depthCm: 95,
  heightCm: 82,
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
  productUrl: "https://example.com/product",
  primaryImageUrl: null,
};

const context = {
  contractVersion: "1.0",
  intent: {
    roomType: "living_room",
    primaryStyle: "modern",
    secondaryStyle: null,
    colorMood: "warm neutral",
    colors: {
      primary: "warm taupe",
      secondary: "cream",
      accent: "charcoal gray",
      metal: "brushed nickel",
    },
    preferredMaterials: ["wood", "linen"],
    avoidMaterials: [],
    roomFunctions: ["conversation", "relaxing"],
    householdSize: "3",
    specialRequirements: ["child-friendly"],
  },
  roles: [
    {
      roleId: "primary_sofa",
      furnitureTypeCode: "sofa",
      required: true,
      approximatePosition: { xCm: 200, yCm: 150 },
      sizeRange: {
        widthMinCm: 180,
        widthMaxCm: 240,
        depthMinCm: 80,
        depthMaxCm: 110,
        heightMinCm: 70,
        heightMaxCm: 100,
      },
    },
  ],
  candidates: [
    {
      roleId: "primary_sofa",
      candidate,
    },
  ],
};

test("accepts a valid design intelligence context", () => {
  assert.equal(designIntelligenceContextSchema.safeParse(context).success, true);
});

test("keeps technical catalog identity inside the server-side intelligence context", () => {
  const parsed = designIntelligenceContextSchema.parse(context);

  assert.equal(
    parsed.candidates[0]?.candidate.variantId,
    "22222222-2222-4222-8222-222222222222",
  );
  assert.equal(parsed.candidates[0]?.candidate.vendorName, "Internal Vendor");
});

test("rejects invalid physical role ranges", () => {
  const invalid = structuredClone(context);
  invalid.roles[0]!.sizeRange.widthMinCm = 0;

  assert.equal(designIntelligenceContextSchema.safeParse(invalid).success, false);
});

test("supports unknown compatibility when evidence is incomplete", () => {
  const evaluation = {
    contractVersion: "1.0",
    candidateEvaluations: [
      {
        roleId: "primary_sofa",
        variantId: "22222222-2222-4222-8222-222222222222",
        dimensions: [
          {
            dimension: "style_harmony",
            compatibility: "unknown",
            reasons: ["Insufficient style evidence."],
          },
        ],
        overallCompatibility: "unknown",
      },
    ],
    relationshipEvaluations: [],
    wholeRoomEvaluation: {
      dimensions: [],
      overallCompatibility: "unknown",
      reasons: ["Whole-room evaluation has not been performed."],
    },
  };

  assert.equal(
    designIntelligenceEvaluationSchema.safeParse(evaluation).success,
    true,
  );
});

test("represents relationship evaluation separately from individual candidates", () => {
  const evaluation = {
    contractVersion: "1.0",
    candidateEvaluations: [],
    relationshipEvaluations: [
      {
        relationshipId: "sofa_rug",
        roleIds: ["primary_sofa", "area_rug"],
        dimensions: [
          {
            dimension: "color_harmony",
            compatibility: "compatible",
            reasons: ["The colors can participate in one coordinated palette."],
          },
        ],
        overallCompatibility: "compatible",
      },
    ],
    wholeRoomEvaluation: {
      dimensions: [],
      overallCompatibility: "mixed",
      reasons: ["Additional room relationships remain unevaluated."],
    },
  };

  assert.equal(
    designIntelligenceEvaluationSchema.safeParse(evaluation).success,
    true,
  );
});

test("rejects inverted physical role ranges", () => {
  const invalid = structuredClone(context);
  invalid.roles[0]!.sizeRange.widthMinCm = 240;
  invalid.roles[0]!.sizeRange.widthMaxCm = 180;

  assert.equal(designIntelligenceContextSchema.safeParse(invalid).success, false);
});
