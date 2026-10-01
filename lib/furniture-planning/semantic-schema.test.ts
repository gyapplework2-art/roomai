import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptedFurniturePlanSchema,
  furniturePlanV11ItemSchema,
  furniturePlanV11Schema,
  semanticPlacementSchema,
} from "./semantic-schema";

const validV10Plan = {
  schemaVersion: "1.0",
  roomIntent: "A comfortable modern living room for conversation and relaxation.",
  items: [
    {
      id: "sofa-1",
      category: "sofa",
      subtype: "3-seat",
      priority: "required",
      placement: {
        preferredZone: "seating_zone",
        anchorWallId: "wall-1",
        approximatePosition: { xCm: 250, yCm: 50 },
        preferredOrientationDegrees: 0,
      },
      sizeRange: {
        widthMinCm: 200,
        widthMaxCm: 240,
        depthMinCm: 85,
        depthMaxCm: 100,
        heightMinCm: 75,
        heightMaxCm: 90,
      },
      styleHints: ["modern", "clean lines"],
      materialHints: ["fabric", "linen"],
      colorHints: ["neutral", "beige"],
      functionalRequirements: ["seats 3 adults"],
      reasoning: "Primary seating oriented into the room.",
    },
  ],
  notes: ["Keep pathway to door open."],
};

const validV11Plan = {
  schemaVersion: "1.1",
  roomIntent: "A comfortable modern living room for conversation and relaxation.",
  items: [
    {
      id: "sofa-1",
      category: "sofa",
      subtype: "3-seat",
      priority: "required",
      placement: {
        preferredZone: "seating_zone",
        anchorWallId: "wall-1",
        approximatePosition: { xCm: 250, yCm: 50 },
        preferredOrientationDegrees: 0,
      },
      semanticPlacement: {
        role: "PRIMARY_SEATING",
        mode: "AGAINST_WALL",
        alignment: "CENTERED",
        zoneId: "seating_zone",
        targetWallId: "wall-1",
        relationships: [],
        fallbackModes: ["NEAR_WALL", "FLOATING"],
      },
      sizeRange: {
        widthMinCm: 200,
        widthMaxCm: 240,
        depthMinCm: 85,
        depthMaxCm: 100,
        heightMinCm: 75,
        heightMaxCm: 90,
      },
      styleHints: ["modern"],
      materialHints: ["fabric"],
      colorHints: ["beige"],
      functionalRequirements: ["seats 3 adults"],
      reasoning: "Primary seating anchored to the main wall.",
    },
    {
      id: "table-1",
      category: "coffee_table",
      subtype: null,
      priority: "preferred",
      placement: {
        preferredZone: "seating_zone",
        anchorWallId: null,
        approximatePosition: { xCm: 250, yCm: 160 },
        preferredOrientationDegrees: 0,
      },
      semanticPlacement: {
        role: "COFFEE_TABLE",
        mode: "FLOATING",
        alignment: null,
        zoneId: "seating_zone",
        targetWallId: null,
        relationships: [
          {
            type: "IN_FRONT_OF",
            targetItemId: "sofa-1",
          },
        ],
        fallbackModes: [],
      },
      sizeRange: {
        widthMinCm: 100,
        widthMaxCm: 140,
        depthMinCm: 50,
        depthMaxCm: 70,
        heightMinCm: 40,
        heightMaxCm: 50,
      },
      styleHints: ["modern"],
      materialHints: ["wood"],
      colorHints: ["oak"],
      functionalRequirements: ["surface for drinks"],
      reasoning: "Placed in front of primary seating.",
    },
  ],
  notes: ["Maintain circulation clearance."],
};

test("valid v1.1 semantic plan parses", () => {
  const itemResult = furniturePlanV11ItemSchema.safeParse(validV11Plan.items[0]);
  assert.equal(itemResult.success, true);

  const result = furniturePlanV11Schema.safeParse(validV11Plan);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.schemaVersion, "1.1");
    assert.equal(result.data.items.length, 2);
    assert.equal(result.data.items[0].semanticPlacement.role, "PRIMARY_SEATING");
    assert.equal(result.data.items[0].semanticPlacement.mode, "AGAINST_WALL");
    assert.equal(result.data.items[0].semanticPlacement.alignment, "CENTERED");
    assert.equal(result.data.items[0].semanticPlacement.targetWallId, "wall-1");
    assert.deepEqual(result.data.items[0].semanticPlacement.fallbackModes, ["NEAR_WALL", "FLOATING"]);
  }
});

test("invalid semantic enum is rejected", () => {
  const invalidRole = {
    role: "NON_EXISTENT_ROLE",
    mode: "AGAINST_WALL",
    alignment: "CENTERED",
    zoneId: null,
    targetWallId: "wall-1",
    relationships: [],
    fallbackModes: [],
  };
  assert.equal(semanticPlacementSchema.safeParse(invalidRole).success, false);

  const invalidMode = {
    role: "PRIMARY_SEATING",
    mode: "UNKNOWN_MODE",
    alignment: "CENTERED",
    zoneId: null,
    targetWallId: "wall-1",
    relationships: [],
    fallbackModes: [],
  };
  assert.equal(semanticPlacementSchema.safeParse(invalidMode).success, false);

  const invalidAlignment = {
    role: "PRIMARY_SEATING",
    mode: "AGAINST_WALL",
    alignment: "DIAGONAL",
    zoneId: null,
    targetWallId: "wall-1",
    relationships: [],
    fallbackModes: [],
  };
  assert.equal(semanticPlacementSchema.safeParse(invalidAlignment).success, false);

  const invalidRelationshipType = {
    role: "COFFEE_TABLE",
    mode: "FLOATING",
    alignment: null,
    zoneId: null,
    targetWallId: null,
    relationships: [{ type: "ATTACHED_TO", targetItemId: "sofa-1" }],
    fallbackModes: [],
  };
  assert.equal(semanticPlacementSchema.safeParse(invalidRelationshipType).success, false);
});

test("relationships reference plan item IDs structurally", () => {
  // Target item exists in the plan: valid
  const validResult = furniturePlanV11Schema.safeParse(validV11Plan);
  assert.equal(validResult.success, true);

  // Target item does not exist in the plan: rejected
  const missingTargetPlan = {
    ...validV11Plan,
    items: [
      validV11Plan.items[0],
      {
        ...validV11Plan.items[1],
        semanticPlacement: {
          ...validV11Plan.items[1].semanticPlacement,
          relationships: [{ type: "IN_FRONT_OF", targetItemId: "non-existent-item" }],
        },
      },
    ],
  };
  const missingResult = furniturePlanV11Schema.safeParse(missingTargetPlan);
  assert.equal(missingResult.success, false);

  // Self-referencing relationship: rejected
  const selfRefPlan = {
    ...validV11Plan,
    items: [
      {
        ...validV11Plan.items[0],
        semanticPlacement: {
          ...validV11Plan.items[0].semanticPlacement,
          relationships: [{ type: "FACES", targetItemId: "sofa-1" }],
        },
      },
      validV11Plan.items[1],
    ],
  };
  const selfRefResult = furniturePlanV11Schema.safeParse(selfRefPlan);
  assert.equal(selfRefResult.success, false);
});

test("acceptedFurniturePlanSchema accepts both v1.0 and v1.1 plans", () => {
  const parsedV10 = acceptedFurniturePlanSchema.safeParse(validV10Plan);
  assert.equal(parsedV10.success, true);
  if (parsedV10.success) {
    assert.equal(parsedV10.data.schemaVersion, "1.0");
  }

  const parsedV11 = acceptedFurniturePlanSchema.safeParse(validV11Plan);
  assert.equal(parsedV11.success, true);
  if (parsedV11.success) {
    assert.equal(parsedV11.data.schemaVersion, "1.1");
  }
});
