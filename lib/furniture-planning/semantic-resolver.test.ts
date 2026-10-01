import assert from "node:assert/strict";
import test from "node:test";

import { createRectangleGeometry } from "@/lib/geometry/templates";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";
import { isPointInsideOrOnPolygon } from "@/lib/geometry/point-in-polygon";
import type { FurniturePlanItemV11 } from "./types";
import {
  resolveSemanticPlacement,
  resolveSemanticPlan,
} from "./semantic-resolver";

function makeItem(overrides: Partial<FurniturePlanItemV11> = {}): FurniturePlanItemV11 {
  return {
    id: "sofa-1",
    category: "sofa",
    subtype: "3-seat",
    priority: "required",
    placement: {
      preferredZone: "living",
      anchorWallId: null,
      approximatePosition: null,
      preferredOrientationDegrees: null,
    },
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "CENTERED",
      zoneId: "living",
      targetWallId: "wall-1",
      relationships: [],
      fallbackModes: ["NEAR_WALL", "FLOATING"],
    },
    sizeRange: {
      widthMinCm: 200,
      widthMaxCm: 240,
      depthMinCm: 80,
      depthMaxCm: 100,
      heightMinCm: 75,
      heightMaxCm: 90,
    },
    styleHints: ["modern"],
    materialHints: ["fabric"],
    colorHints: ["gray"],
    functionalRequirements: ["seats 3"],
    reasoning: "Placed against the wall.",
    ...overrides,
  };
}

// 500 cm wide x 400 cm long rectangle room:
// wall-1: bottom wall (0,0) -> (500,0)
// wall-2: right wall (500,0) -> (500,400)
// wall-3: top wall (500,400) -> (0,400)
// wall-4: left wall (0,400) -> (0,0)
const geometry = createRectangleGeometry(500, 400, 250);

test("AGAINST_WALL + CENTERED resolves a valid wall", () => {
  const item = makeItem();
  const resolved = resolveSemanticPlacement(item, geometry, []);

  assert.equal(resolved.placement.anchorWallId, "wall-1");
  assert.equal(resolved.placement.preferredOrientationDegrees, 0);

  // Midpoint of wall-1 is x = 250
  // Average depth is (80 + 100) / 2 = 90; half depth into the room (+Y) is 45
  assert.ok(resolved.placement.approximatePosition);
  assert.equal(resolved.placement.approximatePosition.xCm, 250);
  assert.equal(resolved.placement.approximatePosition.yCm, 45);

  // Position is inside the room
  assert.equal(isPointInsideOrOnPolygon(resolved.placement.approximatePosition, geometry.vertices), true);
});

test("resolver chooses usable wall space when an opening occupies part of wall", () => {
  const item = makeItem();
  // Door on wall-1 at offset 0, width 90. Clearance = 15cm. Blocked: [0, 105].
  // Usable span on wall-1: [105, 500].
  // Center of usable span: (105 + 500) / 2 = 302.5.
  const door: RoomOpening = {
    openingType: "door",
    wallSegmentId: "wall-1",
    offsetCm: 0,
    widthCm: 90,
    heightCm: 210,
    sillHeightCm: null,
    hingeSide: "left",
    swingDirection: "inward",
  };

  const resolved = resolveSemanticPlacement(item, geometry, [door]);

  assert.equal(resolved.placement.anchorWallId, "wall-1");
  assert.equal(resolved.placement.preferredOrientationDegrees, 0);
  assert.ok(resolved.placement.approximatePosition);
  assert.equal(resolved.placement.approximatePosition.xCm, 302.5);
  assert.equal(resolved.placement.approximatePosition.yCm, 45);
});

test("window does not automatically block wall span in semantic resolution stage", () => {
  const item = makeItem();
  // Window occupies the center of wall-1: offset 190, width 120 (spans 190 to 310)
  const window: RoomOpening = {
    openingType: "window",
    wallSegmentId: "wall-1",
    offsetCm: 190,
    widthCm: 120,
    heightCm: 140,
    sillHeightCm: 90,
    hingeSide: null,
    swingDirection: null,
  };

  const resolved = resolveSemanticPlacement(item, geometry, [window]);

  // Window does not block: full wall-1 span [0, 500] is usable and centered at x = 250
  assert.equal(resolved.placement.anchorWallId, "wall-1");
  assert.equal(resolved.placement.preferredOrientationDegrees, 0);
  assert.ok(resolved.placement.approximatePosition);
  assert.equal(resolved.placement.approximatePosition.xCm, 250);
  assert.equal(resolved.placement.approximatePosition.yCm, 45);
});

test("invalid targetWallId safely preserves legacy placement", () => {
  const item = makeItem({
    placement: {
      preferredZone: "original_zone",
      anchorWallId: "original_wall",
      approximatePosition: { xCm: 120, yCm: 80 },
      preferredOrientationDegrees: 90,
    },
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "CENTERED",
      zoneId: null,
      targetWallId: "non_existent_wall",
      relationships: [],
      fallbackModes: [],
    },
  });

  const resolved = resolveSemanticPlacement(item, geometry, []);

  // Preserves existing placement
  assert.equal(resolved.placement.anchorWallId, "original_wall");
  assert.deepEqual(resolved.placement.approximatePosition, { xCm: 120, yCm: 80 });
  assert.equal(resolved.placement.preferredOrientationDegrees, 90);
  assert.equal(resolved.placement.preferredZone, "original_zone");
});

test("unsupported semantic mode safely preserves placement", () => {
  const itemFloating = makeItem({
    placement: {
      preferredZone: "center",
      anchorWallId: null,
      approximatePosition: { xCm: 250, yCm: 200 },
      preferredOrientationDegrees: 0,
    },
    semanticPlacement: {
      role: "COFFEE_TABLE",
      mode: "FLOATING",
      alignment: null,
      zoneId: "center",
      targetWallId: null,
      relationships: [],
      fallbackModes: [],
    },
  });

  const resolvedFloating = resolveSemanticPlacement(itemFloating, geometry, []);
  assert.deepEqual(resolvedFloating.placement, itemFloating.placement);

  const itemLeftAligned = makeItem({
    placement: {
      preferredZone: "side",
      anchorWallId: "wall-1",
      approximatePosition: { xCm: 100, yCm: 45 },
      preferredOrientationDegrees: 0,
    },
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "LEFT_ALIGNED",
      zoneId: "side",
      targetWallId: "wall-1",
      relationships: [],
      fallbackModes: [],
    },
  });

  const resolvedLeftAligned = resolveSemanticPlacement(itemLeftAligned, geometry, []);
  assert.deepEqual(resolvedLeftAligned.placement, itemLeftAligned.placement);
});

test("inward orientation works for reversed wall direction", () => {
  // Create geometry where wall-1 is defined from (500,0) to (0,0) (reversed vertex order)
  const reversedGeometry: RoomGeometry = {
    ...geometry,
    wallSegments: [
      {
        id: "wall-reversed",
        startVertexId: "v2", // (500, 0)
        endVertexId: "v1", // (0, 0)
      },
      ...geometry.wallSegments.slice(1),
    ],
  };

  const item = makeItem({
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "CENTERED",
      zoneId: null,
      targetWallId: "wall-reversed",
      relationships: [],
      fallbackModes: [],
    },
  });

  const resolved = resolveSemanticPlacement(item, reversedGeometry, []);

  assert.equal(resolved.placement.anchorWallId, "wall-reversed");
  // The room is at y > 0, so inward normal still points in +Y direction (orientation 0 degrees)
  assert.equal(resolved.placement.preferredOrientationDegrees, 0);
  assert.ok(resolved.placement.approximatePosition);
  assert.equal(resolved.placement.approximatePosition.xCm, 250);
  assert.equal(resolved.placement.approximatePosition.yCm, 45);
});

test("resolves placement against right, top, and left walls with correct cardinal orientations", () => {
  // wall-2: right wall (500,0) -> (500,400). Inward normal is (-1, 0) -> 90 degrees
  const itemWall2 = makeItem({
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "CENTERED",
      zoneId: null,
      targetWallId: "wall-2",
      relationships: [],
      fallbackModes: [],
    },
  });
  const resolvedWall2 = resolveSemanticPlacement(itemWall2, geometry, []);
  assert.equal(resolvedWall2.placement.preferredOrientationDegrees, 90);
  assert.equal(resolvedWall2.placement.approximatePosition?.xCm, 455); // 500 - 45
  assert.equal(resolvedWall2.placement.approximatePosition?.yCm, 200);

  // wall-3: top wall (500,400) -> (0,400). Inward normal is (0, -1) -> 180 degrees
  const itemWall3 = makeItem({
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "CENTERED",
      zoneId: null,
      targetWallId: "wall-3",
      relationships: [],
      fallbackModes: [],
    },
  });
  const resolvedWall3 = resolveSemanticPlacement(itemWall3, geometry, []);
  assert.equal(resolvedWall3.placement.preferredOrientationDegrees, 180);
  assert.equal(resolvedWall3.placement.approximatePosition?.xCm, 250);
  assert.equal(resolvedWall3.placement.approximatePosition?.yCm, 355); // 400 - 45

  // wall-4: left wall (0,400) -> (0,0). Inward normal is (1, 0) -> 270 degrees
  const itemWall4 = makeItem({
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "CENTERED",
      zoneId: null,
      targetWallId: "wall-4",
      relationships: [],
      fallbackModes: [],
    },
  });
  const resolvedWall4 = resolveSemanticPlacement(itemWall4, geometry, []);
  assert.equal(resolvedWall4.placement.preferredOrientationDegrees, 270);
  assert.equal(resolvedWall4.placement.approximatePosition?.xCm, 45); // 0 + 45
  assert.equal(resolvedWall4.placement.approximatePosition?.yCm, 200);
});

test("resolveSemanticPlan resolves all items in a v1.1 plan", () => {
  const plan = {
    schemaVersion: "1.1" as const,
    roomIntent: "Cozy lounge.",
    items: [
      makeItem({ id: "sofa-1", semanticPlacement: { role: "PRIMARY_SEATING", mode: "AGAINST_WALL", alignment: "CENTERED", zoneId: null, targetWallId: "wall-1", relationships: [], fallbackModes: [] } }),
      makeItem({ id: "table-1", semanticPlacement: { role: "COFFEE_TABLE", mode: "FLOATING", alignment: null, zoneId: null, targetWallId: null, relationships: [], fallbackModes: [] } }),
    ],
    notes: [],
  };

  const resolvedPlan = resolveSemanticPlan(plan, geometry, []);

  assert.equal(resolvedPlan.items[0].placement.anchorWallId, "wall-1");
  assert.equal(resolvedPlan.items[0].placement.approximatePosition?.xCm, 250);
  assert.equal(resolvedPlan.items[1].placement.anchorWallId, null);
});
