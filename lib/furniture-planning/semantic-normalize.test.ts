import assert from "node:assert/strict";
import test from "node:test";

import type { FurniturePlanV1, FurniturePlanV11 } from "./types";
import {
  inferFurnitureRole,
  normalizeSemanticPlan,
  normalizeSemanticPlanItem,
} from "./semantic-normalize";

const sampleV10Plan: FurniturePlanV1 = {
  schemaVersion: "1.0",
  roomIntent: "A modern, open living space.",
  items: [
    {
      id: "sofa-1",
      category: "sofa",
      subtype: "3-seat",
      priority: "required",
      placement: {
        preferredZone: "living",
        anchorWallId: "wall-north",
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
      styleHints: ["modern"],
      materialHints: ["leather"],
      colorHints: ["tan"],
      functionalRequirements: ["seats 3"],
      reasoning: "Anchor piece for the living room.",
    },
    {
      id: "coffee-table-1",
      category: "coffee_table",
      subtype: null,
      priority: "preferred",
      placement: {
        preferredZone: "living",
        anchorWallId: null,
        approximatePosition: { xCm: 250, yCm: 150 },
        preferredOrientationDegrees: 0,
      },
      sizeRange: {
        widthMinCm: 100,
        widthMaxCm: 130,
        depthMinCm: 50,
        depthMaxCm: 70,
        heightMinCm: 40,
        heightMaxCm: 50,
      },
      styleHints: ["minimal"],
      materialHints: ["wood"],
      colorHints: ["oak"],
      functionalRequirements: ["surface for drinks"],
      reasoning: "Central table in seating area.",
    },
  ],
  notes: ["Keep doorway clear."],
};

test("v1.0 plan remains accepted and normalizes to v1.1 without losing placement", () => {
  const singleItemNormalized = normalizeSemanticPlanItem(sampleV10Plan.items[0]);
  assert.equal(singleItemNormalized.semanticPlacement.role, "PRIMARY_SEATING");
  assert.equal(singleItemNormalized.placement.anchorWallId, "wall-north");

  const normalized = normalizeSemanticPlan(sampleV10Plan);

  assert.equal(normalized.schemaVersion, "1.1");
  assert.equal(normalized.items.length, 2);

  // Original placement fields are completely preserved
  const sofa = normalized.items[0];
  assert.equal(sofa.id, "sofa-1");
  assert.equal(sofa.placement.anchorWallId, "wall-north");
  assert.deepEqual(sofa.placement.approximatePosition, { xCm: 250, yCm: 50 });
  assert.equal(sofa.placement.preferredOrientationDegrees, 0);
  assert.equal(sofa.placement.preferredZone, "living");

  // Inferred semantic information
  assert.equal(sofa.semanticPlacement.role, "PRIMARY_SEATING");
  assert.equal(sofa.semanticPlacement.mode, "AGAINST_WALL");
  assert.equal(sofa.semanticPlacement.zoneId, "living");
  assert.equal(sofa.semanticPlacement.alignment, null);

  // Preserves existing anchorWallId as targetWallId
  assert.equal(sofa.semanticPlacement.targetWallId, "wall-north");

  // Does not invent furniture relationships
  assert.deepEqual(sofa.semanticPlacement.relationships, []);
  assert.deepEqual(sofa.semanticPlacement.fallbackModes, []);

  // Floating item
  const table = normalized.items[1];
  assert.equal(table.id, "coffee-table-1");
  assert.equal(table.semanticPlacement.role, "COFFEE_TABLE");
  assert.equal(table.semanticPlacement.mode, "FLOATING");
  assert.equal(table.semanticPlacement.targetWallId, null);
  assert.deepEqual(table.semanticPlacement.relationships, []);
});

test("legacy anchorWallId maps to AGAINST_WALL mode and targetWallId while preserving placement", () => {
  const legacyItem = sampleV10Plan.items[0];
  const normalizedItem = normalizeSemanticPlanItem(legacyItem);

  assert.equal(legacyItem.placement.anchorWallId, "wall-north");
  assert.equal(normalizedItem.semanticPlacement.mode, "AGAINST_WALL");
  assert.equal(normalizedItem.semanticPlacement.targetWallId, "wall-north");

  // Original placement remains unchanged
  assert.deepEqual(normalizedItem.placement, legacyItem.placement);
});

test("infers conservative furniture roles from diverse categories and subtypes", () => {
  assert.equal(inferFurnitureRole("sofa"), "PRIMARY_SEATING");
  assert.equal(inferFurnitureRole("sectional"), "PRIMARY_SEATING");
  assert.equal(inferFurnitureRole("sectional_sofa"), "PRIMARY_SEATING");
  assert.equal(inferFurnitureRole("armchair"), "SECONDARY_SEATING");
  assert.equal(inferFurnitureRole("accent_chair"), "SECONDARY_SEATING");
  assert.equal(inferFurnitureRole("loveseat"), "SECONDARY_SEATING");
  assert.equal(inferFurnitureRole("coffee_table"), "COFFEE_TABLE");
  assert.equal(inferFurnitureRole("side_table"), "SIDE_TABLE");
  assert.equal(inferFurnitureRole("nightstand"), "SIDE_TABLE");
  assert.equal(inferFurnitureRole("area_rug"), "AREA_RUG");
  assert.equal(inferFurnitureRole("media_console"), "MEDIA_CONSOLE");
  assert.equal(inferFurnitureRole("dresser"), "STORAGE");
  assert.equal(inferFurnitureRole("bookshelf"), "STORAGE");
  assert.equal(inferFurnitureRole("desk_lamp"), "TASK_LIGHTING");
  assert.equal(inferFurnitureRole("floor_lamp"), "AMBIENT_LIGHTING");
});

test("v1.1 plan preserves supplied semantic intent and placement fields", () => {
  const v11Plan: FurniturePlanV11 = {
    schemaVersion: "1.1",
    roomIntent: "Relaxed layout.",
    items: [
      {
        id: "sofa-1",
        category: "sofa",
        subtype: "3-seat",
        priority: "required",
        placement: {
          preferredZone: "seating",
          anchorWallId: "wall-1",
          approximatePosition: { xCm: 250, yCm: 45 },
          preferredOrientationDegrees: 0,
        },
        semanticPlacement: {
          role: "PRIMARY_SEATING",
          mode: "AGAINST_WALL",
          alignment: "CENTERED",
          zoneId: "seating",
          targetWallId: "wall-1",
          relationships: [],
          fallbackModes: ["NEAR_WALL"],
        },
        sizeRange: {
          widthMinCm: 200,
          widthMaxCm: 240,
          depthMinCm: 80,
          depthMaxCm: 100,
          heightMinCm: 75,
          heightMaxCm: 90,
        },
        styleHints: [],
        materialHints: [],
        colorHints: [],
        functionalRequirements: [],
        reasoning: "Anchored to wall-1.",
      },
    ],
    notes: [],
  };

  const normalized = normalizeSemanticPlan(v11Plan);
  assert.equal(normalized.schemaVersion, "1.1");
  assert.equal(normalized.items[0].semanticPlacement.role, "PRIMARY_SEATING");
  assert.equal(normalized.items[0].semanticPlacement.mode, "AGAINST_WALL");
  assert.equal(normalized.items[0].semanticPlacement.alignment, "CENTERED");
  assert.equal(normalized.items[0].semanticPlacement.targetWallId, "wall-1");
  assert.deepEqual(normalized.items[0].semanticPlacement.fallbackModes, ["NEAR_WALL"]);
});
