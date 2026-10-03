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
  IN_FRONT_OF_GAP_CM,
  ADJACENT_GAP_CM,
  computeFacesOrientation,
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

// =========================================================================
// E.10-A.2.2 Relationship Resolution Tests (A through U)
// =========================================================================

test("REL-A. coffee table FLOATING + IN_FRONT_OF wall-resolved sofa", () => {
  const sofa = makeItem({
    id: "sofa-1",
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

  const table = makeItem({
    id: "table-1",
    category: "coffee_table",
    sizeRange: {
      widthMinCm: 100,
      widthMaxCm: 120,
      depthMinCm: 50,
      depthMaxCm: 70, // depth = 60
      heightMinCm: 40,
      heightMaxCm: 50,
    },
    placement: {
      preferredZone: "living",
      anchorWallId: null,
      approximatePosition: { xCm: 100, yCm: 100 },
      preferredOrientationDegrees: 45,
    },
    semanticPlacement: {
      role: "COFFEE_TABLE",
      mode: "FLOATING",
      alignment: null,
      zoneId: "living",
      targetWallId: null,
      relationships: [{ type: "IN_FRONT_OF", targetItemId: "sofa-1" }],
      fallbackModes: [],
    },
  });

  const plan = {
    schemaVersion: "1.1" as const,
    roomIntent: "Living space",
    items: [sofa, table],
    notes: [],
  };

  const resolved = resolveSemanticPlan(plan, geometry, []);
  const resolvedTable = resolved.items.find((i) => i.id === "table-1")!;

  assert.equal(resolvedTable.placement.anchorWallId, null);
  // Sofa at (250, 45). Target depth = 90, source depth = 60.
  // distance = 45 + IN_FRONT_OF_GAP_CM + 30 = 115.
  // y = 45 + 115 = 160.
  assert.equal(resolvedTable.placement.approximatePosition?.xCm, 250);
  assert.equal(resolvedTable.placement.approximatePosition?.yCm, 160);
  assert.equal(resolvedTable.placement.preferredOrientationDegrees, 0);
});

test("REL-B. coffee table appears BEFORE sofa in plan.items: still resolves correctly", () => {
  const sofa = makeItem({
    id: "sofa-1",
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

  const table = makeItem({
    id: "table-1",
    sizeRange: {
      widthMinCm: 100,
      widthMaxCm: 120,
      depthMinCm: 50,
      depthMaxCm: 70,
      heightMinCm: 40,
      heightMaxCm: 50,
    },
    semanticPlacement: {
      role: "COFFEE_TABLE",
      mode: "FLOATING",
      alignment: null,
      zoneId: null,
      targetWallId: null,
      relationships: [{ type: "IN_FRONT_OF", targetItemId: "sofa-1" }],
      fallbackModes: [],
    },
  });

  // Table appears BEFORE sofa
  const plan = {
    schemaVersion: "1.1" as const,
    roomIntent: "Living room",
    items: [table, sofa],
    notes: [],
  };

  const resolved = resolveSemanticPlan(plan, geometry, []);

  // Preserves array ordering
  assert.equal(resolved.items[0].id, "table-1");
  assert.equal(resolved.items[1].id, "sofa-1");

  // Both resolved properly
  assert.equal(resolved.items[1].placement.approximatePosition?.xCm, 250);
  assert.equal(resolved.items[1].placement.approximatePosition?.yCm, 45);
  assert.equal(resolved.items[0].placement.approximatePosition?.xCm, 250);
  assert.equal(resolved.items[0].placement.approximatePosition?.yCm, 160);
});

test("REL-C. resulting IN_FRONT_OF distance equals targetDepth/2 + gap + sourceDepth/2", () => {
  const sofa = makeItem({
    id: "sofa-1",
    sizeRange: {
      widthMinCm: 200,
      widthMaxCm: 240,
      depthMinCm: 80,
      depthMaxCm: 100, // targetDepth = 90
      heightMinCm: 75,
      heightMaxCm: 90,
    },
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

  const table = makeItem({
    id: "table-1",
    sizeRange: {
      widthMinCm: 100,
      widthMaxCm: 120,
      depthMinCm: 50,
      depthMaxCm: 70, // sourceDepth = 60
      heightMinCm: 40,
      heightMaxCm: 50,
    },
    semanticPlacement: {
      role: "COFFEE_TABLE",
      mode: "FLOATING",
      alignment: null,
      zoneId: null,
      targetWallId: null,
      relationships: [{ type: "IN_FRONT_OF", targetItemId: "sofa-1" }],
      fallbackModes: [],
    },
  });

  const plan = {
    schemaVersion: "1.1" as const,
    roomIntent: "Testing distance",
    items: [sofa, table],
    notes: [],
  };

  const resolved = resolveSemanticPlan(plan, geometry, []);
  const resolvedSofa = resolved.items[0];
  const resolvedTable = resolved.items[1];

  const actualDistance = Math.hypot(
    resolvedTable.placement.approximatePosition!.xCm - resolvedSofa.placement.approximatePosition!.xCm,
    resolvedTable.placement.approximatePosition!.yCm - resolvedSofa.placement.approximatePosition!.yCm,
  );

  const expectedDistance = 90 / 2 + IN_FRONT_OF_GAP_CM + 60 / 2;
  assert.equal(Math.round(actualDistance * 100) / 100, expectedDistance);
});

test("REL-D. IN_FRONT_OF source orientation parallel to target width axis", () => {
  // Target sofa anchored to wall-2 (right wall at x=500). Orientation = 90 degrees.
  const sofa = makeItem({
    id: "sofa-1",
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

  const table = makeItem({
    id: "table-1",
    sizeRange: {
      widthMinCm: 100,
      widthMaxCm: 120,
      depthMinCm: 50,
      depthMaxCm: 70,
      heightMinCm: 40,
      heightMaxCm: 50,
    },
    semanticPlacement: {
      role: "COFFEE_TABLE",
      mode: "FLOATING",
      alignment: null,
      zoneId: null,
      targetWallId: null,
      relationships: [{ type: "IN_FRONT_OF", targetItemId: "sofa-1" }],
      fallbackModes: [],
    },
  });

  const plan = {
    schemaVersion: "1.1" as const,
    roomIntent: "Orientation test",
    items: [sofa, table],
    notes: [],
  };

  const resolved = resolveSemanticPlan(plan, geometry, []);
  const resolvedSofa = resolved.items[0];
  const resolvedTable = resolved.items[1];

  assert.equal(resolvedSofa.placement.preferredOrientationDegrees, 90);
  assert.equal(resolvedTable.placement.preferredOrientationDegrees, 90);
});

test("REL-E. IN_FRONT_OF missing target: compatibility placement preserved", () => {
  const table = makeItem({
    id: "table-1",
    placement: {
      preferredZone: "original_zone",
      anchorWallId: null,
      approximatePosition: { xCm: 200, yCm: 200 },
      preferredOrientationDegrees: 45,
    },
    semanticPlacement: {
      role: "COFFEE_TABLE",
      mode: "FLOATING",
      alignment: null,
      zoneId: "original_zone",
      targetWallId: null,
      relationships: [{ type: "IN_FRONT_OF", targetItemId: "non_existent_target" }],
      fallbackModes: [],
    },
  });

  const plan = {
    schemaVersion: "1.1" as const,
    roomIntent: "Missing target",
    items: [table],
    notes: [],
  };

  const resolved = resolveSemanticPlan(plan, geometry, []);
  assert.deepEqual(resolved.items[0].placement, table.placement);
});

test("REL-F. IN_FRONT_OF target without reliable front direction: compatibility placement preserved", () => {
  // Target is a floating sofa (no anchorWallId)
  const floatingSofa = makeItem({
    id: "sofa-floating",
    placement: {
      preferredZone: "center",
      anchorWallId: null,
      approximatePosition: { xCm: 250, yCm: 200 },
      preferredOrientationDegrees: 0,
    },
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "FLOATING",
      alignment: null,
      zoneId: "center",
      targetWallId: null,
      relationships: [],
      fallbackModes: [],
    },
  });

  const table = makeItem({
    id: "table-1",
    placement: {
      preferredZone: "center",
      anchorWallId: null,
      approximatePosition: { xCm: 250, yCm: 300 },
      preferredOrientationDegrees: 0,
    },
    semanticPlacement: {
      role: "COFFEE_TABLE",
      mode: "FLOATING",
      alignment: null,
      zoneId: "center",
      targetWallId: null,
      relationships: [{ type: "IN_FRONT_OF", targetItemId: "sofa-floating" }],
      fallbackModes: [],
    },
  });

  const plan = {
    schemaVersion: "1.1" as const,
    roomIntent: "No reliable front test",
    items: [floatingSofa, table],
    notes: [],
  };

  const resolved = resolveSemanticPlan(plan, geometry, []);
  const resolvedTable = resolved.items[1];
  assert.deepEqual(resolvedTable.placement, table.placement);
});

test("REL-G. side table FLOATING + ADJACENT_TO sofa", () => {
  const sofa = makeItem({
    id: "sofa-1",
    sizeRange: {
      widthMinCm: 200,
      widthMaxCm: 240, // width = 220, half = 110
      depthMinCm: 80,
      depthMaxCm: 100,
      heightMinCm: 75,
      heightMaxCm: 90,
    },
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

  const sideTable = makeItem({
    id: "side-1",
    category: "side_table",
    sizeRange: {
      widthMinCm: 40,
      widthMaxCm: 60, // width = 50, half = 25
      depthMinCm: 40,
      depthMaxCm: 60,
      heightMinCm: 50,
      heightMaxCm: 60,
    },
    semanticPlacement: {
      role: "SIDE_TABLE",
      mode: "FLOATING",
      alignment: null,
      zoneId: null,
      targetWallId: null,
      relationships: [{ type: "ADJACENT_TO", targetItemId: "sofa-1" }],
      fallbackModes: [],
    },
  });

  const plan = {
    schemaVersion: "1.1" as const,
    roomIntent: "Adjacent test",
    items: [sofa, sideTable],
    notes: [],
  };

  const resolved = resolveSemanticPlan(plan, geometry, []);
  const resolvedSide = resolved.items[1];

  assert.equal(resolvedSide.placement.anchorWallId, null);
  assert.ok(resolvedSide.placement.approximatePosition);
  assert.equal(isPointInsideOrOnPolygon(resolvedSide.placement.approximatePosition, geometry.vertices), true);
  assert.equal(resolvedSide.placement.preferredOrientationDegrees, 0);
});

test("REL-H. ADJACENT_TO chooses only valid side when other side falls outside room", () => {
  // Place sofa near left edge: wall-1 LEFT_ALIGNED
  // Sofa center will be x = 120, y = 45. Width = 220, half-width = 110.
  const sofa = makeItem({
    id: "sofa-1",
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

  // Side table width = 50, half-width = 25.
    const expectedDistance = 220 / 2 + ADJACENT_GAP_CM + 50 / 2;
    assert.equal(expectedDistance, 145);
  // Candidate B (left): x = 120 - 145 = -25 (OUTSIDE room < 0)
  // Candidate A (right): x = 120 + 145 = 265 (INSIDE room)
  const sideTable = makeItem({
    id: "side-1",
    sizeRange: {
      widthMinCm: 40,
      widthMaxCm: 60,
      depthMinCm: 40,
      depthMaxCm: 60,
      heightMinCm: 50,
      heightMaxCm: 60,
    },
    semanticPlacement: {
      role: "SIDE_TABLE",
      mode: "FLOATING",
      alignment: null,
      zoneId: null,
      targetWallId: null,
      relationships: [{ type: "ADJACENT_TO", targetItemId: "sofa-1" }],
      fallbackModes: [],
    },
  });

  const plan = {
    schemaVersion: "1.1" as const,
    roomIntent: "Left edge sofa",
    items: [sofa, sideTable],
    notes: [],
  };

  const resolved = resolveSemanticPlan(plan, geometry, []);
  const resolvedSide = resolved.items[1];

  assert.ok(resolvedSide.placement.approximatePosition);
  assert.equal(resolvedSide.placement.approximatePosition.xCm, 265);
  assert.equal(resolvedSide.placement.approximatePosition.yCm, 45);
});

test("REL-I. ADJACENT_TO both sides valid: deterministic repeated result", () => {
  // Sofa centered at x = 250, y = 45.
  // Distance = 145. Both x = 105 and x = 395 are inside room [0, 500].
  // Stable tie-breaker chooses smaller x = 105.
  const sofa = makeItem({
    id: "sofa-1",
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

  const sideTable = makeItem({
    id: "side-1",
    sizeRange: {
      widthMinCm: 40,
      widthMaxCm: 60,
      depthMinCm: 40,
      depthMaxCm: 60,
      heightMinCm: 50,
      heightMaxCm: 60,
    },
    semanticPlacement: {
      role: "SIDE_TABLE",
      mode: "FLOATING",
      alignment: null,
      zoneId: null,
      targetWallId: null,
      relationships: [{ type: "ADJACENT_TO", targetItemId: "sofa-1" }],
      fallbackModes: [],
    },
  });

  const plan = {
    schemaVersion: "1.1" as const,
    roomIntent: "Both sides valid",
    items: [sofa, sideTable],
    notes: [],
  };

  const resolvedFirst = resolveSemanticPlan(plan, geometry, []);
  const resolvedSecond = resolveSemanticPlan(plan, geometry, []);

  assert.equal(resolvedFirst.items[1].placement.approximatePosition?.xCm, 105);
  assert.deepEqual(resolvedFirst.items[1].placement, resolvedSecond.items[1].placement);
});

test("REL-J. ADJACENT_TO neither side valid: compatibility placement preserved", () => {
  // Use narrow 250x400 room geometry
  const narrowGeometry = createRectangleGeometry(250, 400, 250);

  // Sofa width 220 centered at x = 125.
  // Side table distance = 145.
  // Candidate A: 125 + 145 = 270 (> 250, outside)
  // Candidate B: 125 - 145 = -20 (< 0, outside)
  const sofa = makeItem({
    id: "sofa-1",
    sizeRange: {
      widthMinCm: 200,
      widthMaxCm: 240,
      depthMinCm: 80,
      depthMaxCm: 100,
      heightMinCm: 75,
      heightMaxCm: 90,
    },
    placement: {
      preferredZone: null,
      anchorWallId: "wall-1",
      approximatePosition: { xCm: 125, yCm: 45 },
      preferredOrientationDegrees: 0,
    },
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

  const sideTable = makeItem({
    id: "side-1",
    placement: {
      preferredZone: "compat",
      anchorWallId: null,
      approximatePosition: { xCm: 125, yCm: 250 },
      preferredOrientationDegrees: 90,
    },
    sizeRange: {
      widthMinCm: 40,
      widthMaxCm: 60,
      depthMinCm: 40,
      depthMaxCm: 60,
      heightMinCm: 50,
      heightMaxCm: 60,
    },
    semanticPlacement: {
      role: "SIDE_TABLE",
      mode: "FLOATING",
      alignment: null,
      zoneId: "compat",
      targetWallId: null,
      relationships: [{ type: "ADJACENT_TO", targetItemId: "sofa-1" }],
      fallbackModes: [],
    },
  });

  const plan = {
    schemaVersion: "1.1" as const,
    roomIntent: "Neither side valid",
    items: [sofa, sideTable],
    notes: [],
  };

  const resolved = resolveSemanticPlan(plan, narrowGeometry, []);
  assert.deepEqual(resolved.items[1].placement, sideTable.placement);
});

test("REL-K. FACES changes orientation without moving source position", () => {
  const sofa = makeItem({
    id: "sofa-1",
    placement: {
      preferredZone: null,
      anchorWallId: "wall-1",
      approximatePosition: { xCm: 250, yCm: 50 },
      preferredOrientationDegrees: 0,
    },
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

  const chair = makeItem({
    id: "chair-1",
    placement: {
      preferredZone: null,
      anchorWallId: null,
      approximatePosition: { xCm: 250, yCm: 300 },
      preferredOrientationDegrees: 0,
    },
    semanticPlacement: {
      role: "SECONDARY_SEATING",
      mode: "FLOATING",
      alignment: null,
      zoneId: null,
      targetWallId: null,
      relationships: [{ type: "FACES", targetItemId: "sofa-1" }],
      fallbackModes: [],
    },
  });

  const plan = {
    schemaVersion: "1.1" as const,
    roomIntent: "FACES orientation test",
    items: [sofa, chair],
    notes: [],
  };

  const resolved = resolveSemanticPlan(plan, geometry, []);
  const resolvedChair = resolved.items[1];

  // Position is unchanged
  assert.deepEqual(resolvedChair.placement.approximatePosition, { xCm: 250, yCm: 300 });

  // Chair is at (250, 300), sofa is at (250, 45). Vector is (0, -255), facing south (180 deg)
  assert.equal(resolvedChair.placement.preferredOrientationDegrees, 180);
});

test("REL-L. FACES points source front axis toward target center within numerical tolerance", () => {
  const source = { xCm: 100, yCm: 100 };
  const target = { xCm: 300, yCm: 300 };

  const angle = computeFacesOrientation(source, target);
  assert.ok(angle !== null);

  const thetaRad = (angle * Math.PI) / 180;
  // In RoomAI convention, depth/front axis is (-sin(theta), cos(theta))
  const frontAxis = { xCm: -Math.sin(thetaRad), yCm: Math.cos(thetaRad) };

  const dx = target.xCm - source.xCm;
  const dy = target.yCm - source.yCm;
  const len = Math.hypot(dx, dy);
  const targetUnit = { xCm: dx / len, yCm: dy / len };

  const dot = frontAxis.xCm * targetUnit.xCm + frontAxis.yCm * targetUnit.yCm;
  assert.ok(dot > 0.9999);
});

test("REL-M. FACES missing target: placement unchanged", () => {
  const chair = makeItem({
    id: "chair-1",
    placement: {
      preferredZone: null,
      anchorWallId: null,
      approximatePosition: { xCm: 250, yCm: 300 },
      preferredOrientationDegrees: 45,
    },
    semanticPlacement: {
      role: "SECONDARY_SEATING",
      mode: "FLOATING",
      alignment: null,
      zoneId: null,
      targetWallId: null,
      relationships: [{ type: "FACES", targetItemId: "missing-target" }],
      fallbackModes: [],
    },
  });

  const plan = {
    schemaVersion: "1.1" as const,
    roomIntent: "Missing target FACES",
    items: [chair],
    notes: [],
  };

  const resolved = resolveSemanticPlan(plan, geometry, []);
  assert.deepEqual(resolved.items[0].placement, chair.placement);
});

test("REL-N. wall placement + relationship: wall-derived position remains authoritative", () => {
  // Item has mode AGAINST_WALL on wall-1, but also IN_FRONT_OF another sofa
  const sofa = makeItem({
    id: "sofa-1",
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "CENTERED",
      zoneId: null,
      targetWallId: "wall-1",
      relationships: [{ type: "IN_FRONT_OF", targetItemId: "other-sofa" }],
      fallbackModes: [],
    },
  });

  const plan = {
    schemaVersion: "1.1" as const,
    roomIntent: "Wall precedence test",
    items: [sofa],
    notes: [],
  };

  const resolved = resolveSemanticPlan(plan, geometry, []);
  // Wall-derived position (250, 45) is authoritative
  assert.equal(resolved.items[0].placement.approximatePosition?.xCm, 250);
  assert.equal(resolved.items[0].placement.approximatePosition?.yCm, 45);
  assert.equal(resolved.items[0].placement.anchorWallId, "wall-1");
});

test("REL-O. wall placement + FACES: wall-derived orientation remains authoritative", () => {
  const sofa = makeItem({
    id: "sofa-1",
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "AGAINST_WALL",
      alignment: "CENTERED",
      zoneId: null,
      targetWallId: "wall-1",
      relationships: [{ type: "FACES", targetItemId: "other-sofa" }],
      fallbackModes: [],
    },
  });

  const plan = {
    schemaVersion: "1.1" as const,
    roomIntent: "Wall orientation precedence",
    items: [sofa],
    notes: [],
  };

  const resolved = resolveSemanticPlan(plan, geometry, []);
  // Wall-derived orientation (0 degrees) remains authoritative
  assert.equal(resolved.items[0].placement.preferredOrientationDegrees, 0);
});

test("REL-P. dependency chain: A wall-resolved, B IN_FRONT_OF A, C ADJACENT_TO B resolves deterministically even if input array order is C, B, A", () => {
  const itemA = makeItem({
    id: "item-A",
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

  const itemB = makeItem({
    id: "item-B",
    sizeRange: {
      widthMinCm: 100,
      widthMaxCm: 120, // width = 110
      depthMinCm: 50,
      depthMaxCm: 70, // depth = 60
      heightMinCm: 40,
      heightMaxCm: 50,
    },
    semanticPlacement: {
      role: "COFFEE_TABLE",
      mode: "FLOATING",
      alignment: null,
      zoneId: null,
      targetWallId: null,
      relationships: [{ type: "IN_FRONT_OF", targetItemId: "item-A" }],
      fallbackModes: [],
    },
  });

  const itemC = makeItem({
    id: "item-C",
    sizeRange: {
      widthMinCm: 40,
      widthMaxCm: 60, // width = 50
      depthMinCm: 40,
      depthMaxCm: 60,
      heightMinCm: 40,
      heightMaxCm: 50,
    },
    semanticPlacement: {
      role: "SIDE_TABLE",
      mode: "FLOATING",
      alignment: null,
      zoneId: null,
      targetWallId: null,
      relationships: [{ type: "ADJACENT_TO", targetItemId: "item-B" }],
      fallbackModes: [],
    },
  });

  // Input order is C, B, A
  const plan = {
    schemaVersion: "1.1" as const,
    roomIntent: "Dependency chain test",
    items: [itemC, itemB, itemA],
    notes: [],
  };

  const resolved = resolveSemanticPlan(plan, geometry, []);

  // Output order must be exactly C, B, A
  assert.equal(resolved.items[0].id, "item-C");
  assert.equal(resolved.items[1].id, "item-B");
  assert.equal(resolved.items[2].id, "item-A");

  // A resolved at wall-1: (250, 45)
  assert.equal(resolved.items[2].placement.approximatePosition?.xCm, 250);
  assert.equal(resolved.items[2].placement.approximatePosition?.yCm, 45);

  // B resolved in front of A: (250, 160)
  assert.equal(resolved.items[1].placement.approximatePosition?.xCm, 250);
  assert.equal(resolved.items[1].placement.approximatePosition?.yCm, 160);

  // C resolved adjacent to B: x = 250 - (110/2 + 10 + 50/2) = 250 - 90 = 160, y = 160
  assert.equal(resolved.items[0].placement.approximatePosition?.xCm, 160);
  assert.equal(resolved.items[0].placement.approximatePosition?.yCm, 160);
});

test("REL-Q. dependency cycle: A references B, B references A terminates safely with compatibility placements", () => {
  const itemA = makeItem({
    id: "item-A",
    placement: {
      preferredZone: "compat-A",
      anchorWallId: null,
      approximatePosition: { xCm: 100, yCm: 100 },
      preferredOrientationDegrees: 0,
    },
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "FLOATING",
      alignment: null,
      zoneId: "compat-A",
      targetWallId: null,
      relationships: [{ type: "IN_FRONT_OF", targetItemId: "item-B" }],
      fallbackModes: [],
    },
  });

  const itemB = makeItem({
    id: "item-B",
    placement: {
      preferredZone: "compat-B",
      anchorWallId: null,
      approximatePosition: { xCm: 200, yCm: 200 },
      preferredOrientationDegrees: 90,
    },
    semanticPlacement: {
      role: "COFFEE_TABLE",
      mode: "FLOATING",
      alignment: null,
      zoneId: "compat-B",
      targetWallId: null,
      relationships: [{ type: "IN_FRONT_OF", targetItemId: "item-A" }],
      fallbackModes: [],
    },
  });

  const plan = {
    schemaVersion: "1.1" as const,
    roomIntent: "Cycle test",
    items: [itemA, itemB],
    notes: [],
  };

  const resolved = resolveSemanticPlan(plan, geometry, []);
  assert.deepEqual(resolved.items[0].placement, itemA.placement);
  assert.deepEqual(resolved.items[1].placement, itemB.placement);
});

test("REL-R. self-reference terminates safely", () => {
  const item = makeItem({
    id: "self-ref",
    placement: {
      preferredZone: "self",
      anchorWallId: null,
      approximatePosition: { xCm: 150, yCm: 150 },
      preferredOrientationDegrees: 0,
    },
    semanticPlacement: {
      role: "PRIMARY_SEATING",
      mode: "FLOATING",
      alignment: null,
      zoneId: "self",
      targetWallId: null,
      relationships: [{ type: "IN_FRONT_OF", targetItemId: "self-ref" }],
      fallbackModes: [],
    },
  });

  const plan = {
    schemaVersion: "1.1" as const,
    roomIntent: "Self ref test",
    items: [item],
    notes: [],
  };

  const resolved = resolveSemanticPlan(plan, geometry, []);
  assert.deepEqual(resolved.items[0].placement, item.placement);
});

test("REL-S. repeated resolution of identical plan: deep-equal output", () => {
  const sofa = makeItem({
    id: "sofa-1",
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

  const table = makeItem({
    id: "table-1",
    sizeRange: {
      widthMinCm: 100,
      widthMaxCm: 120,
      depthMinCm: 50,
      depthMaxCm: 70,
      heightMinCm: 40,
      heightMaxCm: 50,
    },
    semanticPlacement: {
      role: "COFFEE_TABLE",
      mode: "FLOATING",
      alignment: null,
      zoneId: null,
      targetWallId: null,
      relationships: [{ type: "IN_FRONT_OF", targetItemId: "sofa-1" }],
      fallbackModes: [],
    },
  });

  const plan = {
    schemaVersion: "1.1" as const,
    roomIntent: "Deterministic test",
    items: [sofa, table],
    notes: [],
  };

  const first = resolveSemanticPlan(plan, geometry, []);
  const second = resolveSemanticPlan(plan, geometry, []);
  assert.deepEqual(first, second);
});

test("REL-T. plan.items output order remains exactly input order", () => {
  const item1 = makeItem({ id: "item-1" });
  const item2 = makeItem({ id: "item-2" });
  const item3 = makeItem({ id: "item-3" });

  const plan = {
    schemaVersion: "1.1" as const,
    roomIntent: "Order test",
    items: [item3, item1, item2],
    notes: [],
  };

  const resolved = resolveSemanticPlan(plan, geometry, []);
  assert.deepEqual(
    resolved.items.map((i) => i.id),
    ["item-3", "item-1", "item-2"],
  );
});

test("REL-U. non-rectangle authoritative geometry: relational result remains inside/on polygon", () => {
  const lShapeGeometry = createLShapeGeometry(600, 500, 260);

  const sofa = makeItem({
    id: "sofa-1",
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

  const table = makeItem({
    id: "table-1",
    sizeRange: {
      widthMinCm: 100,
      widthMaxCm: 120,
      depthMinCm: 50,
      depthMaxCm: 70,
      heightMinCm: 40,
      heightMaxCm: 50,
    },
    semanticPlacement: {
      role: "COFFEE_TABLE",
      mode: "FLOATING",
      alignment: null,
      zoneId: null,
      targetWallId: null,
      relationships: [{ type: "IN_FRONT_OF", targetItemId: "sofa-1" }],
      fallbackModes: [],
    },
  });

  const plan = {
    schemaVersion: "1.1" as const,
    roomIntent: "LShape relational test",
    items: [sofa, table],
    notes: [],
  };

  const resolved = resolveSemanticPlan(plan, lShapeGeometry, []);
  const resolvedTable = resolved.items.find((i) => i.id === "table-1")!;

  assert.deepEqual(resolvedTable.placement.approximatePosition, { xCm: 186, yCm: 160 });
  assert.ok(resolvedTable.placement.approximatePosition);
  assert.equal(isPointInsideOrOnPolygon(resolvedTable.placement.approximatePosition, lShapeGeometry.vertices), true);
});

type Relationships = FurniturePlanItemV11["semanticPlacement"]["relationships"];

function makeFloatingItem(
  id: string,
  relationships: Relationships = [],
  overrides: Partial<FurniturePlanItemV11> = {},
): FurniturePlanItemV11 {
  return makeItem({
    id,
    placement: {
      preferredZone: "compatibility",
      anchorWallId: null,
      approximatePosition: { xCm: 333, yCm: 277 },
      preferredOrientationDegrees: 37,
    },
    semanticPlacement: {
      role: "SIDE_TABLE",
      mode: "FLOATING",
      alignment: null,
      zoneId: "semantic",
      targetWallId: null,
      relationships,
      fallbackModes: [],
    },
    sizeRange: {
      widthMinCm: 50, widthMaxCm: 50,
      depthMinCm: 50, depthMaxCm: 50,
      heightMinCm: 50, heightMaxCm: 50,
    },
    ...overrides,
  });
}

function makeRelationshipPlan(items: FurniturePlanItemV11[]) {
  return { schemaVersion: "1.1" as const, roomIntent: "Relationship hardening", items, notes: [] };
}

for (const type of ["IN_FRONT_OF", "ADJACENT_TO"] as const) {
  for (const failure of ["missing", "invalid", "coincident"] as const) {
    test(`atomic ${type} + ${failure} FACES preserves exact compatibility placement`, () => {
      const source = makeFloatingItem("source", [
        { type, targetItemId: "sofa-1" },
        { type: "FACES", targetItemId: "faces-target" },
      ]);
      const facesTarget = makeFloatingItem("faces-target", [], {
        placement: {
          preferredZone: null, anchorWallId: null,
          approximatePosition: failure === "invalid" ? null : type === "IN_FRONT_OF"
            ? { xCm: 250, yCm: 155 } : { xCm: 105, yCm: 45 },
          preferredOrientationDegrees: null,
        },
      });
      const items = [source, makeItem(), ...(failure === "missing" ? [] : [facesTarget])];
      const plan = makeRelationshipPlan(items);
      const snapshot = structuredClone(plan);
      const resolved = resolveSemanticPlan(plan, geometry, []);
      assert.deepEqual(resolved.items[0].placement, source.placement);
      assert.strictEqual(resolved.items[0].placement, source.placement);
      assert.deepEqual(plan, snapshot);
      const anchors = new Map(items.slice(1).map((item) => [item.id, item]));
      anchors.set("sofa-1", resolveSemanticPlacement(makeItem(), geometry, []));
      assert.deepEqual(resolveSemanticPlacement(source, geometry, [], anchors).placement, source.placement);
    });
  }
  test(`successful ${type} + FACES resolves position and directed orientation atomically`, () => {
    const source = makeFloatingItem("source", [
      { type, targetItemId: "sofa-1" },
      { type: "FACES", targetItemId: "sofa-1" },
    ]);
    const resolved = resolveSemanticPlan(makeRelationshipPlan([source, makeItem()]), geometry);
    assert.deepEqual(resolved.items[0].placement.approximatePosition,
      type === "IN_FRONT_OF" ? { xCm: 250, yCm: 155 } : { xCm: 105, yCm: 45 });
    assert.equal(resolved.items[0].placement.preferredOrientationDegrees, type === "IN_FRONT_OF" ? 180 : 270);
  });
}

for (const unsupported of ["FLANKS", "GROUPED_WITH", "ANCHORS"] as const) {
  test(`supported relationship mixed with ${unsupported} preserves full fallback`, () => {
    const source = makeFloatingItem("source", [
      { type: "ADJACENT_TO", targetItemId: "sofa-1" },
      { type: unsupported, targetItemId: "sofa-1" },
    ]);
    const result = resolveSemanticPlan(makeRelationshipPlan([source, makeItem()]), geometry);
    assert.strictEqual(result.items[0].placement, source.placement);
  });
}

for (const type of ["IN_FRONT_OF", "ADJACENT_TO", "FACES"] as const) {
  test(`conflicting ${type} targets preserve full fallback in either declaration order`, () => {
    const relationships: Relationships = [
      { type, targetItemId: "sofa-1" }, { type, targetItemId: "other" },
    ];
    for (const declarations of [relationships, [...relationships].reverse()]) {
      const source = makeFloatingItem("source", declarations);
      const result = resolveSemanticPlan(makeRelationshipPlan([source, makeItem(), makeItem({ id: "other" })]), geometry);
      assert.strictEqual(result.items[0].placement, source.placement);
    }
  });
  test(`exact duplicate ${type} declarations equal a single declaration`, () => {
    const relationship = { type, targetItemId: "sofa-1" };
    const single = makeFloatingItem("source", [relationship]);
    const duplicate = makeFloatingItem("source", [relationship, { ...relationship }]);
    const resolve = (source: FurniturePlanItemV11) => resolveSemanticPlan(makeRelationshipPlan([source, makeItem()]), geometry).items[0].placement;
    assert.deepEqual(resolve(duplicate), resolve(single));
    assert.notDeepEqual(resolve(single), single.placement);
  });
}

test("IN_FRONT_OF takes precedence over ADJACENT_TO independent of declaration order", () => {
  const relationships: Relationships = [
    { type: "ADJACENT_TO", targetItemId: "unused-target" },
    { type: "IN_FRONT_OF", targetItemId: "sofa-1" },
  ];
  for (const declarations of [relationships, [...relationships].reverse()]) {
    const source = makeFloatingItem("source", declarations);
    const result = resolveSemanticPlan(makeRelationshipPlan([source, makeItem(), makeFloatingItem("unused-target")]), geometry);
    assert.deepEqual(result.items[0].placement.approximatePosition, { xCm: 250, yCm: 155 });
  }
});

test("duplicate plan IDs preserve the complete original plan, placements, and order", () => {
  const first = makeItem();
  const second = makeFloatingItem(first.id);
  const third = makeFloatingItem("dependent", [{ type: "ADJACENT_TO", targetItemId: first.id }]);
  const plan = makeRelationshipPlan([first, third, second]);
  const snapshot = structuredClone(plan);
  const result = resolveSemanticPlan(plan, geometry);
  assert.deepEqual(result, snapshot);
  assert.equal(result.items.length, 3);
  result.items.forEach((item, index) => assert.strictEqual(item.placement, plan.items[index].placement));
  assert.deepEqual(plan, snapshot);
});

for (const degrees of [359.6, -0.4, 0, 45, 90, 180, 270]) {
  test(`FACES canonicalizes directed angle ${degrees} after rounding`, () => {
    const radians = degrees * Math.PI / 180;
    const angle = computeFacesOrientation({ xCm: 0, yCm: 0 }, { xCm: -Math.sin(radians), yCm: Math.cos(radians) });
    assert.equal(angle, ((Math.round(degrees) % 360) + 360) % 360);
    assert.ok(angle !== null && angle >= 0 && angle < 360);
  });
}

test("unresolved relational targets cannot anchor downstream relationships in either input order", () => {
  const unresolved = makeFloatingItem("unresolved", [{ type: "FACES", targetItemId: "missing" }]);
  const dependent = makeFloatingItem("dependent", [{ type: "ADJACENT_TO", targetItemId: unresolved.id }]);
  for (const items of [[unresolved, dependent], [dependent, unresolved]]) {
    const result = resolveSemanticPlan(makeRelationshipPlan(items), geometry);
    result.items.forEach((item, index) => assert.strictEqual(item.placement, items[index].placement));
  }
});

test("valid three-level chain is immutable and identical by ID across all six permutations", () => {
  const sofa = makeItem();
  const table = makeFloatingItem("table", [{ type: "IN_FRONT_OF", targetItemId: sofa.id }]);
  const side = makeFloatingItem("side", [{ type: "ADJACENT_TO", targetItemId: table.id }]);
  const permutations = [
    [sofa, table, side], [sofa, side, table], [table, sofa, side],
    [table, side, sofa], [side, sofa, table], [side, table, sofa],
  ];
  const expected = new Map([
    [sofa.id, { xCm: 250, yCm: 45 }], [table.id, { xCm: 250, yCm: 155 }], [side.id, { xCm: 190, yCm: 155 }],
  ]);
  const baseline = resolveSemanticPlan(makeRelationshipPlan(permutations[0]), geometry);
  for (const items of permutations) {
    const plan = makeRelationshipPlan(items);
    const snapshot = structuredClone(plan);
    const result = resolveSemanticPlan(plan, geometry);
    assert.deepEqual(result.items.map((item) => item.id), items.map((item) => item.id));
    for (const item of result.items) {
      assert.deepEqual(item.placement.approximatePosition, expected.get(item.id));
      assert.deepEqual(item, baseline.items.find((candidate) => candidate.id === item.id));
    }
    assert.deepEqual(plan, snapshot);
  }
});

test("ADJACENT_TO uses the effective wall-constrained width rather than original midpoint", () => {
  const door: RoomOpening = {
    openingType: "door", wallSegmentId: "wall-1", offsetCm: 235, widthCm: 265,
    heightCm: 210, sillHeightCm: null, hingeSide: "left", swingDirection: "inward",
  };
  const sofa = makeItem({ semanticPlacement: { ...makeItem().semanticPlacement, alignment: "LEFT_ALIGNED" } });
  const side = makeFloatingItem("side", [{ type: "ADJACENT_TO", targetItemId: sofa.id }]);
  const result = resolveSemanticPlan(makeRelationshipPlan([side, sofa]), geometry, [door]);
  assert.deepEqual(result.items[1].placement.approximatePosition, { xCm: 115, yCm: 45 });
  assert.deepEqual(result.items[0].placement.approximatePosition, { xCm: 255, yCm: 45 });
  assert.equal(255 - 115, 210 / 2 + ADJACENT_GAP_CM + 50 / 2);
  assert.deepEqual(result.items[1].sizeRange, sofa.sizeRange);
});

test("independent compatibility anchors remain eligible for positional relationships", () => {
  const anchor = makeFloatingItem("compatibility-anchor", [], {
    placement: {
      preferredZone: null, anchorWallId: "wall-1",
      approximatePosition: { xCm: 250, yCm: 45 }, preferredOrientationDegrees: 0,
    },
  });
  const dependent = makeFloatingItem("dependent", [{ type: "IN_FRONT_OF", targetItemId: anchor.id }]);
  const result = resolveSemanticPlan(makeRelationshipPlan([dependent, anchor]), geometry);
  assert.strictEqual(result.items[1].placement, anchor.placement);
  assert.deepEqual(result.items[0].placement.approximatePosition, { xCm: 250, yCm: 135 });
});

test("failed wall semantic resolution is not an eligible compatibility anchor", () => {
  const anchor = makeItem({
    placement: {
      preferredZone: "compatibility", anchorWallId: "wall-1",
      approximatePosition: { xCm: 250, yCm: 45 }, preferredOrientationDegrees: 0,
    },
    semanticPlacement: { ...makeItem().semanticPlacement, targetWallId: "missing-wall" },
  });
  const dependent = makeFloatingItem("dependent", [{ type: "IN_FRONT_OF", targetItemId: anchor.id }]);
  const result = resolveSemanticPlan(makeRelationshipPlan([dependent, anchor]), geometry);
  assert.strictEqual(result.items[0].placement, dependent.placement);
  assert.strictEqual(result.items[1].placement, anchor.placement);
});

test("unsupported-only targets cannot anchor supported dependents", () => {
  const anchor = makeFloatingItem("unsupported", [{ type: "ANCHORS", targetItemId: "sofa-1" }]);
  const dependent = makeFloatingItem("dependent", [{ type: "ADJACENT_TO", targetItemId: anchor.id }]);
  const result = resolveSemanticPlan(makeRelationshipPlan([dependent, anchor, makeItem()]), geometry);
  assert.strictEqual(result.items[0].placement, dependent.placement);
  assert.strictEqual(result.items[1].placement, anchor.placement);
});

test("shadowed ADJACENT_TO does not create a dependency after IN_FRONT_OF precedence", () => {
  const source = makeFloatingItem("source", [
    { type: "IN_FRONT_OF", targetItemId: "sofa-1" },
    { type: "ADJACENT_TO", targetItemId: "missing-shadowed-target" },
  ]);
  const result = resolveSemanticPlan(makeRelationshipPlan([source, makeItem()]), geometry);
  assert.deepEqual(result.items[0].placement.approximatePosition, { xCm: 250, yCm: 155 });
});

test("nonfinite planning dimensions preserve compatibility placement", () => {
  const source = makeFloatingItem("source", [{ type: "ADJACENT_TO", targetItemId: "sofa-1" }]);
  const anchor = makeItem({ sizeRange: { ...makeItem().sizeRange, depthMaxCm: Infinity } });
  const result = resolveSemanticPlacement(source, geometry, [], new Map([[anchor.id, anchor]]));
  assert.strictEqual(result.placement, source.placement);
});
