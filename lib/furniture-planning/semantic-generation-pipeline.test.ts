import assert from "node:assert/strict";
import test from "node:test";

import {
  createFurniturePlanningBrief,
  finalizeGeneratedFurniturePlan,
  planningInstructions,
  FURNITURE_PLAN_PROMPT_VERSION,
} from "./generation";
import {
  furniturePlanV11Schema,
  furniturePlanV11ItemSchema,
} from "./semantic-schema";
import { furniturePlanSchema } from "./schema";
import { normalizeSemanticPlan } from "./semantic-normalize";
import { resolveSemanticPlan } from "./semantic-resolver";
import { normalizeFurniturePlanForMarket } from "./normalize-plan";
import { constrainFurniturePlanToRoom } from "./room-constraints";
import { createLShapeGeometry, createRectangleGeometry } from "@/lib/geometry/templates";
import type { RoomOpening } from "@/lib/geometry/types";
import type { Tables } from "@/types/database.types";
import type { FurniturePlanV11 } from "./types";

const mockProject: Tables<"projects"> = {
  id: "proj-1",
  user_id: "user-1",
  name: "Living Room Design",
  room_type: "living_room",
  status: "active",
  width_cm: 500,
  length_cm: 400,
  height_cm: 250,
  currency: "USD",
  budget_min: 1000,
  budget_max: 5000,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const mockGeometry = createRectangleGeometry(500, 400, 250);
const mockOpenings: RoomOpening[] = [
  {
    openingType: "door",
    wallSegmentId: "wall-1",
    offsetCm: 0,
    widthCm: 90,
    heightCm: 210,
    sillHeightCm: null,
    hingeSide: "left",
    swingDirection: "inward",
  },
];

const mockV11GeneratedPlan: FurniturePlanV11 = {
  schemaVersion: "1.1",
  roomIntent: "Comfortable and conversation-friendly living space.",
  items: [
    {
      id: "sofa-1",
      category: "sofa",
      subtype: "3-seat",
      priority: "required",
      placement: {
        preferredZone: "main_seating",
        anchorWallId: "wall-1",
        approximatePosition: { xCm: 250, yCm: 50 },
        preferredOrientationDegrees: 0,
      },
      semanticPlacement: {
        role: "PRIMARY_SEATING",
        mode: "AGAINST_WALL",
        alignment: "CENTERED",
        zoneId: "main_seating",
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
      colorHints: ["gray"],
      functionalRequirements: ["seats 3"],
      reasoning: "Centered against the primary wall.",
    },
    {
      id: "coffee-table-1",
      category: "coffee_table",
      subtype: null,
      priority: "preferred",
      placement: {
        preferredZone: "main_seating",
        anchorWallId: null,
        approximatePosition: { xCm: 250, yCm: 170 },
        preferredOrientationDegrees: 0,
      },
      semanticPlacement: {
        role: "COFFEE_TABLE",
        mode: "FLOATING",
        alignment: null,
        zoneId: "main_seating",
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
        widthMaxCm: 130,
        depthMinCm: 50,
        depthMaxCm: 70,
        heightMinCm: 40,
        heightMaxCm: 50,
      },
      styleHints: ["modern"],
      materialHints: ["wood"],
      colorHints: ["oak"],
      functionalRequirements: ["surface for drinks"],
      reasoning: "Floating in front of the sofa.",
    },
  ],
  notes: ["Ensure door swing remains clear."],
};

test("A. generated structured-output schema requires schemaVersion 1.1", () => {
  const v10Doc = {
    ...mockV11GeneratedPlan,
    schemaVersion: "1.0",
  };
  // v1.1 schema rejects schemaVersion "1.0"
  assert.equal(furniturePlanV11Schema.safeParse(v10Doc).success, false);

  // v1.1 schema accepts schemaVersion "1.1"
  assert.equal(furniturePlanV11Schema.safeParse(mockV11GeneratedPlan).success, true);
});

test("B. semanticPlacement is part of generated furniture items", () => {
  const itemWithoutSemantic = {
    ...mockV11GeneratedPlan.items[0],
    semanticPlacement: undefined,
  };
  assert.equal(furniturePlanV11ItemSchema.safeParse(itemWithoutSemantic).success, false);

  const itemWithSemantic = mockV11GeneratedPlan.items[0];
  const parsed = furniturePlanV11ItemSchema.safeParse(itemWithSemantic);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.semanticPlacement.role, "PRIMARY_SEATING");
    assert.equal(parsed.data.semanticPlacement.mode, "AGAINST_WALL");
    assert.equal(parsed.data.semanticPlacement.alignment, "CENTERED");
    assert.equal(parsed.data.semanticPlacement.targetWallId, "wall-1");
  }
});

test("C. semantic relationships can reference another generated item", () => {
  const coffeeTable = mockV11GeneratedPlan.items[1];
  assert.equal(coffeeTable.semanticPlacement.relationships.length, 1);
  assert.equal(coffeeTable.semanticPlacement.relationships[0].type, "IN_FRONT_OF");
  assert.equal(coffeeTable.semanticPlacement.relationships[0].targetItemId, "sofa-1");

  // Validate the whole plan structurally enforces target existence
  assert.equal(furniturePlanV11Schema.safeParse(mockV11GeneratedPlan).success, true);
});

test("D. generation instructions clearly establish semanticPlacement as design intent and placement as compatibility/fallback geometry", () => {
  assert.equal(FURNITURE_PLAN_PROMPT_VERSION, "roomai-furniture-plan-v2");
  assert.ok(planningInstructions.includes("schemaVersion \"1.1\""));
  assert.ok(planningInstructions.includes("semanticPlacement as the authoritative DESIGN INTENT"));
  assert.ok(planningInstructions.includes("placement as approximate compatibility/fallback data"));
  assert.ok(planningInstructions.includes("PRIMARY_SEATING"));
  assert.ok(planningInstructions.includes("AGAINST_WALL"));
  assert.ok(planningInstructions.includes("CENTERED"));
  assert.ok(planningInstructions.includes("FLOATING"));
  assert.ok(planningInstructions.includes("IN_FRONT_OF"));
});

test("E. generated AGAINST_WALL + CENTERED item is passed through semantic resolver before room constraints", () => {
  // In mockV11GeneratedPlan, sofa-1 has approximatePosition { xCm: 250, yCm: 50 }.
  // But wall-1 has a door at offset 0-90 (blocked [0, 105]).
  // The usable free span is [105, 500], so center of usable span is 302.5.
  // Inward normal is +Y, depth is (85+100)/2 = 92.5, halfDepth = 46.25.
  // The semantic resolver overrides approximatePosition to { xCm: 302.5, yCm: 46.25 }.

  const normalized = normalizeSemanticPlan(mockV11GeneratedPlan);
  const resolved = resolveSemanticPlan(normalized, mockGeometry, mockOpenings);

  const resolvedSofa = resolved.items.find((i) => i.id === "sofa-1");
  assert.ok(resolvedSofa);
  assert.equal(resolvedSofa.placement.anchorWallId, "wall-1");
  assert.equal(resolvedSofa.placement.approximatePosition?.xCm, 302.5);
  assert.equal(resolvedSofa.placement.approximatePosition?.yCm, 46.25);
  assert.equal(resolvedSofa.placement.preferredOrientationDegrees, 0);
});

test("F. resolver-derived placement reaches downstream room constraint processing", () => {
  const normalizedSemantic = normalizeSemanticPlan(mockV11GeneratedPlan);
  const resolved = resolveSemanticPlan(normalizedSemantic, mockGeometry, mockOpenings);

  // Feed resolved plan into market normalization and room constraints
  const marketNormalized = normalizeFurniturePlanForMarket(resolved, "north_america");
  const constrained = constrainFurniturePlanToRoom(marketNormalized, mockGeometry, mockOpenings);

  assert.equal(constrained.items.length, 2);
  const constrainedSofa = constrained.items.find((i) => i.item.id === "sofa-1");
  assert.ok(constrainedSofa);
  assert.equal(constrainedSofa.roomStatus, "ready");
  assert.equal(constrainedSofa.roomConstraint?.selectedWallId, "wall-1");
  assert.ok(constrainedSofa.roomConstraint?.selectedSpan);
  // Selected span on wall-1 starts at 105 (past the door clearance)
  assert.equal(constrainedSofa.roomConstraint.selectedSpan.startCm, 105);
  assert.equal(constrainedSofa.roomConstraint.selectedSpan.endCm, 500);
});

test("G. unsupported FLOATING semantic placement retains compatibility placement", () => {
  const normalizedSemantic = normalizeSemanticPlan(mockV11GeneratedPlan);
  const resolved = resolveSemanticPlan(normalizedSemantic, mockGeometry, mockOpenings);

  const resolvedTable = resolved.items.find((i) => i.id === "coffee-table-1");
  assert.ok(resolvedTable);
  assert.equal(resolvedTable.placement.anchorWallId, null);
  // approximatePosition is preserved from compatibility placement
  assert.deepEqual(resolvedTable.placement.approximatePosition, { xCm: 250, yCm: 170 });
  assert.equal(resolvedTable.placement.preferredOrientationDegrees, 0);

  // Downstream room constraints accepts it as freestanding
  const marketNormalized = normalizeFurniturePlanForMarket(resolved, "north_america");
  const constrained = constrainFurniturePlanToRoom(marketNormalized, mockGeometry, mockOpenings);
  const constrainedTable = constrained.items.find((i) => i.item.id === "coffee-table-1");
  assert.ok(constrainedTable);
  assert.equal(constrainedTable.roomStatus, "ready");
  assert.equal(constrainedTable.roomConstraint?.selectedWallId, null);
});

test("H. existing v1.0 compatibility remains available outside the new generation path", () => {
  const v10Plan = {
    schemaVersion: "1.0" as const,
    roomIntent: "Legacy v1 plan.",
    items: [
      {
        id: "sofa-legacy",
        category: "sofa",
        subtype: "2-seat",
        priority: "required" as const,
        placement: {
          preferredZone: "living",
          anchorWallId: "wall-1",
          approximatePosition: { xCm: 250, yCm: 50 },
          preferredOrientationDegrees: 0,
        },
        sizeRange: {
          widthMinCm: 160,
          widthMaxCm: 200,
          depthMinCm: 80,
          depthMaxCm: 95,
          heightMinCm: 75,
          heightMaxCm: 90,
        },
        styleHints: ["classic"],
        materialHints: ["fabric"],
        colorHints: ["blue"],
        functionalRequirements: ["seats 2"],
        reasoning: "Legacy placement.",
      },
    ],
    notes: [],
  };

  // v1.0 schema directly parses it
  const parsedV10 = furniturePlanSchema.safeParse(v10Plan);
  assert.equal(parsedV10.success, true);

  // Normalization converts v1.0 to v1.1
  const normalized = normalizeSemanticPlan(v10Plan);
  assert.equal(normalized.schemaVersion, "1.1");
  assert.equal(normalized.items[0].semanticPlacement.mode, "AGAINST_WALL");
  assert.equal(normalized.items[0].semanticPlacement.targetWallId, "wall-1");

  // Market normalization & room constraints work directly on v1.0 plans
  const marketNormalized = normalizeFurniturePlanForMarket(v10Plan, "north_america");
  const constrained = constrainFurniturePlanToRoom(marketNormalized, mockGeometry, mockOpenings);
  assert.equal(constrained.items[0].roomStatus, "ready");
});

test("createFurniturePlanningBrief builds brief accurately", () => {
  const brief = createFurniturePlanningBrief(mockProject, null, mockGeometry, mockOpenings);
  assert.equal(brief.project.name, "Living Room Design");
  assert.equal(brief.project.currency, "USD");
  assert.equal(brief.geometry.walls.length, 4);
  assert.equal(brief.geometry.openings.length, 1);
});

test("finalizeGeneratedFurniturePlan: performs semantic normalization and resolution through the production helper", () => {
  const finalized = finalizeGeneratedFurniturePlan(mockV11GeneratedPlan, mockGeometry, mockOpenings);

  assert.equal(finalized.schemaVersion, "1.1");
  assert.equal(finalized.items.length, 2);

  // AGAINST_WALL + CENTERED resolution overrides AI compatibility position (requirement C)
  const sofa = finalized.items.find((i) => i.id === "sofa-1");
  assert.ok(sofa);
  assert.equal(sofa.placement.anchorWallId, "wall-1");
  assert.notDeepEqual(sofa.placement.approximatePosition, mockV11GeneratedPlan.items[0].placement.approximatePosition);
  assert.equal(sofa.placement.approximatePosition?.xCm, 302.5);
  assert.equal(sofa.placement.approximatePosition?.yCm, 46.25);
  assert.equal(sofa.placement.preferredOrientationDegrees, 0);

  // FLOATING unsupported semantic placement retains its compatibility position (requirement D)
  const table = finalized.items.find((i) => i.id === "coffee-table-1");
  assert.ok(table);
  assert.equal(table.placement.anchorWallId, null);
  assert.deepEqual(table.placement.approximatePosition, mockV11GeneratedPlan.items[1].placement.approximatePosition);
  assert.equal(table.placement.preferredOrientationDegrees, 0);
});

test("finalizeGeneratedFurniturePlan: accepts actual non-rectangle RoomGeometry without reconstruction or casting", () => {
  // L-shape room with 6 walls, shapeType 'l_shape'
  const lShapeGeometry = createLShapeGeometry(600, 500, 260);
  assert.equal(lShapeGeometry.shapeType, "l_shape");
  assert.equal(lShapeGeometry.wallSegments.length, 6);

  // Item targeted to wall-1 of the L-shape geometry
  const planForLShape: FurniturePlanV11 = {
    ...mockV11GeneratedPlan,
    items: [
      {
        ...mockV11GeneratedPlan.items[0],
        placement: {
          ...mockV11GeneratedPlan.items[0].placement,
          anchorWallId: "wall-1",
          approximatePosition: { xCm: 100, yCm: 50 },
        },
        semanticPlacement: {
          ...mockV11GeneratedPlan.items[0].semanticPlacement,
          targetWallId: "wall-1",
        },
      },
    ],
  };

  const finalized = finalizeGeneratedFurniturePlan(planForLShape, lShapeGeometry, []);
  assert.equal(finalized.items[0].placement.anchorWallId, "wall-1");
  // wall-1 of L-shape spans x from 0 to 600 - 600*0.38 = 372 at y = 0. Center is 186.
  assert.ok(finalized.items[0].placement.approximatePosition);
  assert.equal(finalized.items[0].placement.approximatePosition?.xCm, 186);
  assert.equal(finalized.items[0].placement.approximatePosition?.yCm, 46.25);
});
