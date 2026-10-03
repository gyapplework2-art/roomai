import assert from "node:assert/strict";
import test from "node:test";

import type { FurniturePlanItem } from "./types";
import { createFurnitureFootprint } from "./footprints";

function item(overrides: Partial<FurniturePlanItem> = {}): FurniturePlanItem {
  return {
    id: "chair", category: "armchair", subtype: null, priority: "required",
    placement: { preferredZone: null, anchorWallId: null, approximatePosition: { xCm: 100, yCm: 100 }, preferredOrientationDegrees: 0 },
    sizeRange: { widthMinCm: 60, widthMaxCm: 100, depthMinCm: 30, depthMaxCm: 50, heightMinCm: 50, heightMaxCm: 100 },
    styleHints: [], materialHints: [], colorHints: [], functionalRequirements: [], reasoning: "Footprint test",
    ...overrides,
  };
}

test("0 degree footprint uses planning midpoints and exact deterministic corners without mutation", () => {
  const source = item();
  const snapshot = structuredClone(source);
  const result = createFurnitureFootprint(source);
  assert.ok(result.valid);
  assert.equal(result.footprint.widthCm, 80);
  assert.equal(result.footprint.depthCm, 40);
  assert.deepEqual(result.footprint.corners, [
    { xCm: 60, yCm: 80 }, { xCm: 140, yCm: 80 }, { xCm: 140, yCm: 120 }, { xCm: 60, yCm: 120 },
  ]);
  assert.deepEqual(result.footprint.polygon, result.footprint.corners);
  assert.notStrictEqual(result.footprint.center, source.placement.approximatePosition);
  assert.deepEqual(createFurnitureFootprint(source), result);
  assert.deepEqual(source, snapshot);
});

test("90 degree rotation represents the width axis with exact corner order", () => {
  const result = createFurnitureFootprint(item({ placement: { ...item().placement, preferredOrientationDegrees: 90 } }));
  assert.ok(result.valid);
  assert.deepEqual(result.footprint.corners, [
    { xCm: 120, yCm: 60 }, { xCm: 120, yCm: 140 }, { xCm: 80, yCm: 140 }, { xCm: 80, yCm: 60 },
  ]);
});

test("45 degree corners use both oriented axes with tight irrational-coordinate assertions", () => {
  const result = createFurnitureFootprint(item({ placement: { ...item().placement, preferredOrientationDegrees: 45 } }));
  assert.ok(result.valid);
  const diagonal = Math.SQRT1_2;
  const expected = [
    { xCm: 100 - 20 * diagonal, yCm: 100 - 60 * diagonal },
    { xCm: 100 + 60 * diagonal, yCm: 100 + 20 * diagonal },
    { xCm: 100 + 20 * diagonal, yCm: 100 + 60 * diagonal },
    { xCm: 100 - 60 * diagonal, yCm: 100 - 20 * diagonal },
  ];
  result.footprint.corners.forEach((corner, index) => {
    assert.ok(Math.abs(corner.xCm - expected[index].xCm) < 1e-12);
    assert.ok(Math.abs(corner.yCm - expected[index].yCm) < 1e-12);
  });
});

for (const angle of [-315, 45, 405, 765]) {
  test(`equivalent angle ${angle} normalizes without changing corner order`, () => {
    const result = createFurnitureFootprint(item({ placement: { ...item().placement, preferredOrientationDegrees: angle } }));
    const expected = createFurnitureFootprint(item({ placement: { ...item().placement, preferredOrientationDegrees: 45 } }));
    assert.deepEqual(result, expected);
  });
}

for (const key of ["widthMinCm", "widthMaxCm", "depthMinCm", "depthMaxCm"] as const) {
  for (const value of [0, -1, Infinity, NaN]) {
    test(`invalid dimension ${key}=${value} is not clamped or fabricated`, () => {
      assert.deepEqual(createFurnitureFootprint(item({ sizeRange: { ...item().sizeRange, [key]: value } })), { valid: false, reasons: ["INVALID_DIMENSIONS"] });
    });
  }
}

test("inverted planning ranges are invalid", () => {
  assert.deepEqual(createFurnitureFootprint(item({ sizeRange: { ...item().sizeRange, widthMinCm: 200 } })), { valid: false, reasons: ["INVALID_DIMENSIONS"] });
});

test("missing position and orientation are explicit failures", () => {
  assert.deepEqual(createFurnitureFootprint(item({ placement: { ...item().placement, approximatePosition: null, preferredOrientationDegrees: null } })), {
    valid: false, reasons: ["MISSING_ORIENTATION", "MISSING_POSITION"],
  });
});

for (const position of [{ xCm: Infinity, yCm: 100 }, { xCm: 100, yCm: NaN }]) {
  test(`nonfinite position ${JSON.stringify(position)} is invalid`, () => {
    assert.deepEqual(createFurnitureFootprint(item({ placement: { ...item().placement, approximatePosition: position } })), { valid: false, reasons: ["INVALID_POSITION"] });
  });
}

for (const angle of [Infinity, NaN]) {
  test(`nonfinite orientation ${angle} is invalid`, () => {
    assert.deepEqual(createFurnitureFootprint(item({ placement: { ...item().placement, preferredOrientationDegrees: angle } })), { valid: false, reasons: ["INVALID_ORIENTATION"] });
  });
}

test("arbitrary fractional orientation is preserved, not rounded", () => {
  const result = createFurnitureFootprint(item({ placement: { ...item().placement, preferredOrientationDegrees: 12.25 } }));
  assert.ok(result.valid);
  assert.equal(result.footprint.orientationDegrees, 12.25);
});

test("unrepresentable corners fail rather than fabricating a footprint at extreme coordinates", () => {
  const result = createFurnitureFootprint(item({ placement: { ...item().placement, approximatePosition: { xCm: Number.MAX_VALUE, yCm: Number.MAX_VALUE } } }));
  assert.deepEqual(result, { valid: false, reasons: ["INVALID_CORNERS"] });
});