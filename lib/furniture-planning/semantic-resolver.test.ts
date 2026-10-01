import assert from "node:assert/strict";
import test from "node:test";

import { createLShapeGeometry, createRectangleGeometry } from "@/lib/geometry/templates";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";
import { isPointInsideOrOnPolygon } from "@/lib/geometry/point-in-polygon";
import type { FurniturePlanItemV11 } from "./types";
import {
  WALL_ALIGNMENT_MARGIN_CM,
  NEAR_WALL_GAP_CM,
  CORNER_ALIGNMENT_MARGIN_CM,
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

test("A. AGAINST_WALL + LEFT_ALIGNED on a clear rectangular wall", () => {
  const item = makeItem({
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "LEFT_ALIGNED",
      zoneId: "living",
      targetWallId: "wall-1",
      relationships: [],
      fallbackModes: [],
    },
  });

  const resolved = resolveSemanticPlacement(item, geometry, []);

  assert.equal(resolved.placement.anchorWallId, "wall-1");
  assert.equal(resolved.placement.preferredOrientationDegrees, 0);

  // planningWidth = (200 + 240) / 2 = 220; halfWidth = 110
  // centerDistance = 0 + WALL_ALIGNMENT_MARGIN_CM + 110 = 120
  // planningDepth = (80 + 100) / 2 = 90; halfDepth = 45
  assert.ok(resolved.placement.approximatePosition);
  assert.equal(resolved.placement.approximatePosition.xCm, 120);
  assert.equal(resolved.placement.approximatePosition.yCm, 45);

  // Furniture starts at x = 120 - 110 = 10, which matches WALL_ALIGNMENT_MARGIN_CM
  assert.equal(resolved.placement.approximatePosition.xCm - 110, WALL_ALIGNMENT_MARGIN_CM);
  assert.equal(isPointInsideOrOnPolygon(resolved.placement.approximatePosition, geometry.vertices), true);
});

test("B. AGAINST_WALL + RIGHT_ALIGNED on a clear rectangular wall", () => {
  const item = makeItem({
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "RIGHT_ALIGNED",
      zoneId: "living",
      targetWallId: "wall-1",
      relationships: [],
      fallbackModes: [],
    },
  });

  const resolved = resolveSemanticPlacement(item, geometry, []);

  assert.equal(resolved.placement.anchorWallId, "wall-1");
  assert.equal(resolved.placement.preferredOrientationDegrees, 0);

  // centerDistance = 500 - (WALL_ALIGNMENT_MARGIN_CM + 110) = 380
  assert.ok(resolved.placement.approximatePosition);
  assert.equal(resolved.placement.approximatePosition.xCm, 380);
  assert.equal(resolved.placement.approximatePosition.yCm, 45);

  // Furniture ends at x = 380 + 110 = 490 (10 cm margin from end of wall at 500)
  assert.equal(500 - (resolved.placement.approximatePosition.xCm + 110), WALL_ALIGNMENT_MARGIN_CM);
  assert.equal(isPointInsideOrOnPolygon(resolved.placement.approximatePosition, geometry.vertices), true);
});

test("C. LEFT_ALIGNED with a door blocking the beginning of the wall: result starts safely after blocked span + required margin", () => {
  const item = makeItem({
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "LEFT_ALIGNED",
      zoneId: "living",
      targetWallId: "wall-1",
      relationships: [],
      fallbackModes: [],
    },
  });
  // Door on wall-1 at offset 0, width 90. Clearance = 15cm. Blocked: [0, 105].
  // Usable span on wall-1: [105, 500].
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

  // centerDistance = 105 + WALL_ALIGNMENT_MARGIN_CM + 110 = 225
  assert.ok(resolved.placement.approximatePosition);
  assert.equal(resolved.placement.approximatePosition.xCm, 225);
  assert.equal(resolved.placement.approximatePosition.yCm, 45);

  // Start of furniture is at x = 225 - 110 = 115.
  // Distance from end of door blocked span (105) is 115 - 105 = 10 (WALL_ALIGNMENT_MARGIN_CM)
  assert.equal(resolved.placement.approximatePosition.xCm - 110 - 105, WALL_ALIGNMENT_MARGIN_CM);
});

test("D. RIGHT_ALIGNED with a door blocking the end side", () => {
  const item = makeItem({
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "RIGHT_ALIGNED",
      zoneId: "living",
      targetWallId: "wall-1",
      relationships: [],
      fallbackModes: [],
    },
  });
  // Door on wall-1 at offset 410, width 90. Clearance = 15cm. Blocked: [395, 500].
  // Usable span on wall-1: [0, 395].
  const door: RoomOpening = {
    openingType: "door",
    wallSegmentId: "wall-1",
    offsetCm: 410,
    widthCm: 90,
    heightCm: 210,
    sillHeightCm: null,
    hingeSide: "right",
    swingDirection: "inward",
  };

  const resolved = resolveSemanticPlacement(item, geometry, [door]);

  assert.equal(resolved.placement.anchorWallId, "wall-1");
  assert.equal(resolved.placement.preferredOrientationDegrees, 0);

  // centerDistance = 395 - (WALL_ALIGNMENT_MARGIN_CM + 110) = 275
  assert.ok(resolved.placement.approximatePosition);
  assert.equal(resolved.placement.approximatePosition.xCm, 275);
  assert.equal(resolved.placement.approximatePosition.yCm, 45);

  // End of furniture is at x = 275 + 110 = 385.
  // Distance before start of door blocked span (395) is 395 - 385 = 10 (WALL_ALIGNMENT_MARGIN_CM)
  assert.equal(395 - (resolved.placement.approximatePosition.xCm + 110), WALL_ALIGNMENT_MARGIN_CM);
});

test("E. reversed wall direction: LEFT/RIGHT follow wall segment start/end direction rather than screen direction", () => {
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

  const itemLeft = makeItem({
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "LEFT_ALIGNED",
      zoneId: null,
      targetWallId: "wall-reversed",
      relationships: [],
      fallbackModes: [],
    },
  });

  const resolvedLeft = resolveSemanticPlacement(itemLeft, reversedGeometry, []);
  assert.equal(resolvedLeft.placement.anchorWallId, "wall-reversed");
  // Wall starts at 500, so distance 120 along wall is x = 500 - 120 = 380 (screen right, segment start)
  assert.equal(resolvedLeft.placement.approximatePosition?.xCm, 380);
  assert.equal(resolvedLeft.placement.approximatePosition?.yCm, 45);

  const itemRight = makeItem({
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "RIGHT_ALIGNED",
      zoneId: null,
      targetWallId: "wall-reversed",
      relationships: [],
      fallbackModes: [],
    },
  });

  const resolvedRight = resolveSemanticPlacement(itemRight, reversedGeometry, []);
  assert.equal(resolvedRight.placement.anchorWallId, "wall-reversed");
  // Wall ends at 0, so distance 380 along wall is x = 500 - 380 = 120 (screen left, segment end)
  assert.equal(resolvedRight.placement.approximatePosition?.xCm, 120);
  assert.equal(resolvedRight.placement.approximatePosition?.yCm, 45);
});

test("F. AGAINST_WALL + CENTERED remains correct", () => {
  const item = makeItem();
  const resolved = resolveSemanticPlacement(item, geometry, []);

  assert.equal(resolved.placement.anchorWallId, "wall-1");
  assert.equal(resolved.placement.preferredOrientationDegrees, 0);

  // Midpoint of wall-1 is x = 250
  assert.ok(resolved.placement.approximatePosition);
  assert.equal(resolved.placement.approximatePosition.xCm, 250);
  assert.equal(resolved.placement.approximatePosition.yCm, 45);
  assert.equal(isPointInsideOrOnPolygon(resolved.placement.approximatePosition, geometry.vertices), true);
});

test("G. NEAR_WALL + CENTERED: same wall relationship but furniture center is farther inward than AGAINST_WALL by exactly NEAR_WALL_GAP_CM", () => {
  const itemAgainstWall = makeItem({
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "CENTERED",
      zoneId: "living",
      targetWallId: "wall-1",
      relationships: [],
      fallbackModes: [],
    },
  });
  const resolvedAgainst = resolveSemanticPlacement(itemAgainstWall, geometry, []);

  const itemNearWall = makeItem({
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "NEAR_WALL",
      alignment: "CENTERED",
      zoneId: "living",
      targetWallId: "wall-1",
      relationships: [],
      fallbackModes: [],
    },
  });
  const resolvedNear = resolveSemanticPlacement(itemNearWall, geometry, []);

  assert.equal(resolvedNear.placement.anchorWallId, "wall-1");
  assert.equal(resolvedNear.placement.preferredOrientationDegrees, 0);
  assert.equal(resolvedNear.placement.approximatePosition?.xCm, 250);

  // Inward offset is 45 + NEAR_WALL_GAP_CM = 60
  assert.equal(resolvedNear.placement.approximatePosition?.yCm, 45 + NEAR_WALL_GAP_CM);

  // Difference in distance from the wall is exactly NEAR_WALL_GAP_CM
  assert.equal(
    resolvedNear.placement.approximatePosition!.yCm - resolvedAgainst.placement.approximatePosition!.yCm,
    NEAR_WALL_GAP_CM,
  );
});

test("H. NEAR_WALL missing targetWallId: compatibility placement preserved exactly", () => {
  const item = makeItem({
    placement: {
      preferredZone: "center",
      anchorWallId: null,
      approximatePosition: { xCm: 200, yCm: 150 },
      preferredOrientationDegrees: 45,
    },
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "NEAR_WALL",
      alignment: "CENTERED",
      zoneId: "center",
      targetWallId: null,
      relationships: [],
      fallbackModes: [],
    },
  });

  const resolved = resolveSemanticPlacement(item, geometry, []);
  assert.deepEqual(resolved.placement, item.placement);
});

test("I. NEAR_WALL invalid targetWallId: compatibility placement preserved exactly", () => {
  const item = makeItem({
    placement: {
      preferredZone: "zone-a",
      anchorWallId: "wall-original",
      approximatePosition: { xCm: 100, yCm: 100 },
      preferredOrientationDegrees: 90,
    },
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "NEAR_WALL",
      alignment: "CENTERED",
      zoneId: "zone-a",
      targetWallId: "non_existent_wall",
      relationships: [],
      fallbackModes: [],
    },
  });

  const resolved = resolveSemanticPlacement(item, geometry, []);
  assert.deepEqual(resolved.placement, item.placement);
});

test("J. NEAR_WALL + unsupported LEFT/RIGHT alignment: compatibility placement preserved exactly", () => {
  const itemLeft = makeItem({
    placement: {
      preferredZone: "zone-left",
      anchorWallId: null,
      approximatePosition: { xCm: 100, yCm: 45 },
      preferredOrientationDegrees: 0,
    },
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "NEAR_WALL",
      alignment: "LEFT_ALIGNED",
      zoneId: "zone-left",
      targetWallId: "wall-1",
      relationships: [],
      fallbackModes: [],
    },
  });
  const resolvedLeft = resolveSemanticPlacement(itemLeft, geometry, []);
  assert.deepEqual(resolvedLeft.placement, itemLeft.placement);

  const itemRight = makeItem({
    placement: {
      preferredZone: "zone-right",
      anchorWallId: null,
      approximatePosition: { xCm: 380, yCm: 45 },
      preferredOrientationDegrees: 0,
    },
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "NEAR_WALL",
      alignment: "RIGHT_ALIGNED",
      zoneId: "zone-right",
      targetWallId: "wall-1",
      relationships: [],
      fallbackModes: [],
    },
  });
  const resolvedRight = resolveSemanticPlacement(itemRight, geometry, []);
  assert.deepEqual(resolvedRight.placement, itemRight.placement);
});

test("K. CORNER_PLACEMENT + LEFT_ALIGNED", () => {
  const item = makeItem({
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "CORNER_PLACEMENT",
      alignment: "LEFT_ALIGNED",
      zoneId: "living",
      targetWallId: "wall-1",
      relationships: [],
      fallbackModes: [],
    },
  });

  const resolved = resolveSemanticPlacement(item, geometry, []);

  assert.equal(resolved.placement.anchorWallId, "wall-1");
  assert.equal(resolved.placement.preferredOrientationDegrees, 0);

  // Start-side corner of wall-1 is offset 0
  // centerDistance = 0 + CORNER_ALIGNMENT_MARGIN_CM + 110 = 120
  assert.ok(resolved.placement.approximatePosition);
  assert.equal(resolved.placement.approximatePosition.xCm, 120);
  assert.equal(resolved.placement.approximatePosition.yCm, 45);
  assert.equal(resolved.placement.approximatePosition.xCm - 110, CORNER_ALIGNMENT_MARGIN_CM);
  assert.equal(isPointInsideOrOnPolygon(resolved.placement.approximatePosition, geometry.vertices), true);
});

test("L. CORNER_PLACEMENT + RIGHT_ALIGNED", () => {
  const item = makeItem({
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "CORNER_PLACEMENT",
      alignment: "RIGHT_ALIGNED",
      zoneId: "living",
      targetWallId: "wall-1",
      relationships: [],
      fallbackModes: [],
    },
  });

  const resolved = resolveSemanticPlacement(item, geometry, []);

  assert.equal(resolved.placement.anchorWallId, "wall-1");
  assert.equal(resolved.placement.preferredOrientationDegrees, 0);

  // End-side corner of wall-1 is offset 500
  // centerDistance = 500 - (CORNER_ALIGNMENT_MARGIN_CM + 110) = 380
  assert.ok(resolved.placement.approximatePosition);
  assert.equal(resolved.placement.approximatePosition.xCm, 380);
  assert.equal(resolved.placement.approximatePosition.yCm, 45);
  assert.equal(500 - (resolved.placement.approximatePosition.xCm + 110), CORNER_ALIGNMENT_MARGIN_CM);
  assert.equal(isPointInsideOrOnPolygon(resolved.placement.approximatePosition, geometry.vertices), true);
});

test("M. CORNER_PLACEMENT + CENTERED: compatibility placement preserved", () => {
  const item = makeItem({
    placement: {
      preferredZone: "original",
      anchorWallId: null,
      approximatePosition: { xCm: 250, yCm: 200 },
      preferredOrientationDegrees: 0,
    },
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "CORNER_PLACEMENT",
      alignment: "CENTERED",
      zoneId: "original",
      targetWallId: "wall-1",
      relationships: [],
      fallbackModes: [],
    },
  });

  const resolved = resolveSemanticPlacement(item, geometry, []);
  assert.deepEqual(resolved.placement, item.placement);
});

test("N. unsafe/unresolvable corner: compatibility placement preserved exactly", () => {
  // Door on wall-1 at offset 0, width 90. Clearance = 15. Blocked: [0, 105].
  // The start-side corner is blocked by the door!
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

  const item = makeItem({
    placement: {
      preferredZone: "fallback",
      anchorWallId: "wall-fallback",
      approximatePosition: { xCm: 150, yCm: 80 },
      preferredOrientationDegrees: 90,
    },
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "CORNER_PLACEMENT",
      alignment: "LEFT_ALIGNED",
      zoneId: "fallback",
      targetWallId: "wall-1",
      relationships: [],
      fallbackModes: [],
    },
  });

  const resolved = resolveSemanticPlacement(item, geometry, [door]);
  assert.deepEqual(resolved.placement, item.placement);
});

test("O. window on target wall: does not automatically remove the usable span", () => {
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

test("P. deterministic repeat: resolving identical input twice produces deep-equal output", () => {
  const item = makeItem({
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "LEFT_ALIGNED",
      zoneId: "living",
      targetWallId: "wall-1",
      relationships: [],
      fallbackModes: [],
    },
  });

  const resolvedFirst = resolveSemanticPlacement(item, geometry, []);
  const resolvedSecond = resolveSemanticPlacement(item, geometry, []);
  assert.deepEqual(resolvedFirst, resolvedSecond);
});

test("Q. non-rectangle geometry: supported wall placement uses authoritative polygon geometry and derived center is inside/on polygon", () => {
  const lShapeGeometry = createLShapeGeometry(600, 500, 260);

  const itemLeft = makeItem({
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "LEFT_ALIGNED",
      zoneId: null,
      targetWallId: "wall-1",
      relationships: [],
      fallbackModes: [],
    },
  });
  const resolvedLeft = resolveSemanticPlacement(itemLeft, lShapeGeometry, []);
  assert.ok(resolvedLeft.placement.approximatePosition);
  assert.equal(isPointInsideOrOnPolygon(resolvedLeft.placement.approximatePosition, lShapeGeometry.vertices), true);

  const itemCentered = makeItem({
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "CENTERED",
      zoneId: null,
      targetWallId: "wall-1",
      relationships: [],
      fallbackModes: [],
    },
  });
  const resolvedCentered = resolveSemanticPlacement(itemCentered, lShapeGeometry, []);
  assert.ok(resolvedCentered.placement.approximatePosition);
  assert.equal(isPointInsideOrOnPolygon(resolvedCentered.placement.approximatePosition, lShapeGeometry.vertices), true);
});

test("R. insufficient usable span: original compatibility placement preserved exactly", () => {
  // Door blocking 0 to 350 on a 500 cm wall (clearance = 15, blocked = [0, 365]).
  // Usable span is [365, 500], length = 135 cm.
  // Item width is 200..240 (minimum width = 200 cm).
  // 135 cm < 200 cm, so span cannot fit even the minimum width of the sofa!
  const door: RoomOpening = {
    openingType: "door",
    wallSegmentId: "wall-1",
    offsetCm: 0,
    widthCm: 350,
    heightCm: 210,
    sillHeightCm: null,
    hingeSide: "left",
    swingDirection: "inward",
  };

  const item = makeItem({
    placement: {
      preferredZone: "original",
      anchorWallId: "original-wall",
      approximatePosition: { xCm: 300, yCm: 200 },
      preferredOrientationDegrees: 0,
    },
  });

  const resolved = resolveSemanticPlacement(item, geometry, [door]);
  assert.deepEqual(resolved.placement, item.placement);
});

test("1. Width range 200–240, free span 210: semantic placement resolves successfully rather than falling back", () => {
  // Door blocking offset 210 to 500 (blocked: [195, 500]).
  // Free span on wall-1: [0, 195] which is 195 cm (less than 200).
  // Let's create a door so free span is exactly 210 cm:
  // e.g. door at offset 225 with clearance 15 -> blocked span [210, 500].
  // Free span: [0, 210]. Length = 210 cm.
  // Item sizeRange: widthMinCm = 200, widthMaxCm = 240.
  // preferredPlanningWidth = 220 cm.
  // For CENTERED: requiredSpan = minimumWidthCm = 200 cm <= 210 cm. Feasible!
  const door: RoomOpening = {
    openingType: "door",
    wallSegmentId: "wall-1",
    offsetCm: 225,
    widthCm: 275,
    heightCm: 210,
    sillHeightCm: null,
    hingeSide: "left",
    swingDirection: "inward",
  };

  const item = makeItem(); // widthMinCm: 200, widthMaxCm: 240
  const resolved = resolveSemanticPlacement(item, geometry, [door]);

  assert.equal(resolved.placement.anchorWallId, "wall-1");
  assert.ok(resolved.placement.approximatePosition);
  // Center of span [0, 210] is 105
  assert.equal(resolved.placement.approximatePosition.xCm, 105);
  assert.equal(resolved.placement.approximatePosition.yCm, 45);
});

test("2. The resolved effective planning width is constrained to available width when midpoint 220 does not fit", () => {
  // Free span [0, 220].
  // For LEFT_ALIGNED: availableWidthCm = 220 - 10 (margin) = 210 cm.
  // minimumWidthCm = 200 <= 210. Feasible!
  // preferredPlanningWidth = 220 > 210, so resolvedPlanningWidthCm = 210 cm.
  // centerDistance = start (0) + margin (10) + resolvedPlanningWidthCm / 2 (105) = 115 cm.
  // If midpoint 220 had been used, center would have been 10 + 110 = 120 cm.
  const door: RoomOpening = {
    openingType: "door",
    wallSegmentId: "wall-1",
    offsetCm: 235,
    widthCm: 265,
    heightCm: 210,
    sillHeightCm: null,
    hingeSide: "left",
    swingDirection: "inward",
  };

  const item = makeItem({
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "LEFT_ALIGNED",
      zoneId: "living",
      targetWallId: "wall-1",
      relationships: [],
      fallbackModes: [],
    },
  });

  const resolved = resolveSemanticPlacement(item, geometry, [door]);
  assert.equal(resolved.placement.anchorWallId, "wall-1");
  assert.ok(resolved.placement.approximatePosition);
  assert.equal(resolved.placement.approximatePosition.xCm, 115);
  // End of sofa: 115 + 210/2 = 220, exactly at end of usable span!
  assert.equal(resolved.placement.approximatePosition.xCm + 210 / 2, 220);
});

test("3. Width range 200–240, free span < 200: compatibility placement is preserved", () => {
  // Free span [0, 190]. minimumWidthCm = 200.
  // 190 < 200 -> cannot fit even minimum width!
  const door: RoomOpening = {
    openingType: "door",
    wallSegmentId: "wall-1",
    offsetCm: 205,
    widthCm: 295,
    heightCm: 210,
    sillHeightCm: null,
    hingeSide: "left",
    swingDirection: "inward",
  };

  const item = makeItem({
    placement: {
      preferredZone: "compat",
      anchorWallId: "compat-wall",
      approximatePosition: { xCm: 50, yCm: 50 },
      preferredOrientationDegrees: 0,
    },
  });

  const resolved = resolveSemanticPlacement(item, geometry, [door]);
  assert.deepEqual(resolved.placement, item.placement);
});

test("4. LEFT_ALIGNED constrained-width position uses span.start + margin + resolvedWidth/2", () => {
  // Span starts at 100, ends at 320. Length = 220 cm.
  // margin = 10. availableWidth = 220 - 10 = 210 cm.
  // widthMinCm = 200, widthMaxCm = 240. resolvedPlanningWidthCm = min(220, 210) = 210 cm.
  // expected center = 100 + 10 + 210 / 2 = 215 cm.
  const door1: RoomOpening = {
    openingType: "door",
    wallSegmentId: "wall-1",
    offsetCm: 0,
    widthCm: 85, // blocked [0, 100]
    heightCm: 210,
    sillHeightCm: null,
    hingeSide: "left",
    swingDirection: "inward",
  };
  const door2: RoomOpening = {
    openingType: "door",
    wallSegmentId: "wall-1",
    offsetCm: 335, // blocked [320, 500]
    widthCm: 165,
    heightCm: 210,
    sillHeightCm: null,
    hingeSide: "left",
    swingDirection: "inward",
  };

  const item = makeItem({
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "LEFT_ALIGNED",
      zoneId: "living",
      targetWallId: "wall-1",
      relationships: [],
      fallbackModes: [],
    },
  });

  const resolved = resolveSemanticPlacement(item, geometry, [door1, door2]);
  assert.ok(resolved.placement.approximatePosition);
  assert.equal(resolved.placement.approximatePosition.xCm, 215);
});

test("5. RIGHT_ALIGNED constrained-width position uses span.end - margin - resolvedWidth/2", () => {
  // Same span [100, 320], length = 220 cm.
  // margin = 10. availableWidth = 210 cm.
  // resolvedPlanningWidthCm = 210 cm.
  // expected center = 320 - 10 - 210 / 2 = 205 cm.
  const door1: RoomOpening = {
    openingType: "door",
    wallSegmentId: "wall-1",
    offsetCm: 0,
    widthCm: 85, // blocked [0, 100]
    heightCm: 210,
    sillHeightCm: null,
    hingeSide: "left",
    swingDirection: "inward",
  };
  const door2: RoomOpening = {
    openingType: "door",
    wallSegmentId: "wall-1",
    offsetCm: 335, // blocked [320, 500]
    widthCm: 165,
    heightCm: 210,
    sillHeightCm: null,
    hingeSide: "left",
    swingDirection: "inward",
  };

  const item = makeItem({
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "RIGHT_ALIGNED",
      zoneId: "living",
      targetWallId: "wall-1",
      relationships: [],
      fallbackModes: [],
    },
  });

  const resolved = resolveSemanticPlacement(item, geometry, [door1, door2]);
  assert.ok(resolved.placement.approximatePosition);
  assert.equal(resolved.placement.approximatePosition.xCm, 205);
});

test("6. CORNER_PLACEMENT follows the same minimum/preferred-width policy", () => {
  // Corner span at start: [0, 220].
  // margin = 10. availableWidth = 220 - 10 = 210 cm.
  // resolvedPlanningWidthCm = 210 cm.
  // center = 0 + 10 + 210 / 2 = 115 cm.
  const door: RoomOpening = {
    openingType: "door",
    wallSegmentId: "wall-1",
    offsetCm: 235,
    widthCm: 265, // blocked [220, 500]
    heightCm: 210,
    sillHeightCm: null,
    hingeSide: "left",
    swingDirection: "inward",
  };

  const item = makeItem({
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "CORNER_PLACEMENT",
      alignment: "LEFT_ALIGNED",
      zoneId: "living",
      targetWallId: "wall-1",
      relationships: [],
      fallbackModes: [],
    },
  });

  const resolved = resolveSemanticPlacement(item, geometry, [door]);
  assert.ok(resolved.placement.approximatePosition);
  assert.equal(resolved.placement.approximatePosition.xCm, 115);

  // If corner span is too narrow for minimum width, it safely preserves compatibility placement
  const tightDoor: RoomOpening = {
    openingType: "door",
    wallSegmentId: "wall-1",
    offsetCm: 215, // blocked [200, 500] -> corner span [0, 200]
    // available width = 200 - 10 = 190 < minimum width 200
    widthCm: 285,
    heightCm: 210,
    sillHeightCm: null,
    hingeSide: "left",
    swingDirection: "inward",
  };

  const unresolvable = resolveSemanticPlacement(item, geometry, [tightDoor]);
  assert.deepEqual(unresolvable.placement, item.placement);
});

test("7. Existing midpoint behavior remains unchanged when enough space exists", () => {
  // Clear wall 500 cm.
  // For LEFT_ALIGNED: availableWidth = 490 > preferredPlanningWidth 220.
  // resolvedPlanningWidthCm = 220.
  // center = 0 + 10 + 110 = 120. Exactly same as before!
  const itemLeft = makeItem({
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "LEFT_ALIGNED",
      zoneId: "living",
      targetWallId: "wall-1",
      relationships: [],
      fallbackModes: [],
    },
  });
  const resolvedLeft = resolveSemanticPlacement(itemLeft, geometry, []);
  assert.equal(resolvedLeft.placement.approximatePosition?.xCm, 120);

  // For RIGHT_ALIGNED: center = 500 - 10 - 110 = 380. Exactly same as before!
  const itemRight = makeItem({
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "RIGHT_ALIGNED",
      zoneId: "living",
      targetWallId: "wall-1",
      relationships: [],
      fallbackModes: [],
    },
  });
  const resolvedRight = resolveSemanticPlacement(itemRight, geometry, []);
  assert.equal(resolvedRight.placement.approximatePosition?.xCm, 380);
});

test("8. Unresolvable inward normal preserves compatibility placement", () => {
  // Construct a degenerate 1D line geometry where vertices are collinear: (0,0) -> (500,0) -> (0,0)
  // Inside/on polygon will never penetrate into an interior.
  const flatGeometry: RoomGeometry = {
    schemaVersion: "1.0",
    shapeType: "rectangle",
    templateTransform: { rotationDegrees: 0, mirroredHorizontal: false, mirroredVertical: false },
    ceilingHeightCm: 250,
    vertices: [
      { id: "v1", xCm: 0, yCm: 0 },
      { id: "v2", xCm: 500, yCm: 0 },
      { id: "v3", xCm: 0, yCm: 0 },
    ],
    wallSegments: [
      { id: "wall-flat", startVertexId: "v1", endVertexId: "v2" },
      { id: "wall-back", startVertexId: "v2", endVertexId: "v3" },
      { id: "wall-close", startVertexId: "v3", endVertexId: "v1" },
    ],
  };

  const item = makeItem({
    placement: {
      preferredZone: "safe_fallback",
      anchorWallId: "wall-orig",
      approximatePosition: { xCm: 100, yCm: 100 },
      preferredOrientationDegrees: 0,
    },
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "CENTERED",
      zoneId: null,
      targetWallId: "wall-flat",
      relationships: [],
      fallbackModes: [],
    },
  });

  const resolved = resolveSemanticPlacement(item, flatGeometry, []);
  // Should safely preserve compatibility placement because findInwardNormal returns null
  assert.deepEqual(resolved.placement, item.placement);
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

  const itemCenteredInZone = makeItem({
    placement: {
      preferredZone: "lounge",
      anchorWallId: null,
      approximatePosition: { xCm: 200, yCm: 200 },
      preferredOrientationDegrees: 0,
    },
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "CENTERED_IN_ZONE",
      alignment: null,
      zoneId: "lounge",
      targetWallId: null,
      relationships: [],
      fallbackModes: [],
    },
  });

  const resolvedCenteredInZone = resolveSemanticPlacement(itemCenteredInZone, geometry, []);
  assert.deepEqual(resolvedCenteredInZone.placement, itemCenteredInZone.placement);
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
