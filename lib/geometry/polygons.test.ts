import assert from "node:assert/strict";
import test from "node:test";

import { createOrientedRectangle, minimumPolygonDistance, minimumSegmentPolygonDistance, findInwardNormal } from "./polygons";
import { createRectangleGeometry } from "./templates";

const rectangle = createOrientedRectangle({ xCm: 100, yCm: 100 }, 100, 40, 0);

for (const { name, center, expected } of [
  { name: "separated", center: { xCm: 240, yCm: 100 }, expected: 40 },
  { name: "edge touching", center: { xCm: 200, yCm: 100 }, expected: 0 },
  { name: "corner touching", center: { xCm: 200, yCm: 140 }, expected: 0 },
  { name: "overlapping", center: { xCm: 120, yCm: 110 }, expected: 0 },
]) {
  test(`polygon distance: ${name} is exact and symmetric`, () => {
    const other = createOrientedRectangle(center, 100, 40, 0);
    assert.equal(minimumPolygonDistance(rectangle, other), expected);
    assert.equal(minimumPolygonDistance(other, rectangle), expected);
    assert.equal(minimumPolygonDistance(rectangle, other), minimumPolygonDistance(rectangle, other));
  });
}

test("rotated rectangles use actual boundary distance, not center or AABB distance", () => {
  const first = createOrientedRectangle({ xCm: 200, yCm: 200 }, 100, 40, 45);
  const second = createOrientedRectangle({ xCm: 200 - 80 * Math.SQRT1_2, yCm: 200 + 80 * Math.SQRT1_2 }, 100, 40, 45);
  const snapshot = structuredClone([first, second]);
  assert.ok(Math.abs(minimumPolygonDistance(first, second) - 40) < 1e-12);
  assert.equal(minimumPolygonDistance(first, second), minimumPolygonDistance(second, first));
  assert.deepEqual([first, second], snapshot);
});

test("contained and identical polygons have zero distance", () => {
  assert.equal(minimumPolygonDistance(rectangle, rectangle), 0);
  const inner = createOrientedRectangle({ xCm: 100, yCm: 100 }, 10, 10, 30);
  assert.equal(minimumPolygonDistance(rectangle, inner), 0);
  assert.equal(minimumPolygonDistance(inner, rectangle), 0);
});

test("inward normals are independent of wall direction and polygon winding", () => {
  const geometry = createRectangleGeometry(500, 400, 250);
  const inward = findInwardNormal({ xCm: 150, yCm: 0 }, 1, 0, geometry.vertices);
  assert.ok(inward);
  assert.equal(inward.xCm + 0, 0);
  assert.equal(inward.yCm, 1);
  assert.deepEqual(findInwardNormal({ xCm: 150, yCm: 0 }, -1, 0, [...geometry.vertices].reverse()), { xCm: 0, yCm: 1 });
  assert.deepEqual(findInwardNormal({ xCm: 500, yCm: 150 }, 0, 1, geometry.vertices), { xCm: -1, yCm: 0 });
});

test("door-span boundary distance is Euclidean and does not fabricate a thin polygon", () => {
  const footprint = createOrientedRectangle({ xCm: 150, yCm: 50 }, 40, 20, 0);
  assert.equal(minimumSegmentPolygonDistance({ xCm: 100, yCm: 0 }, { xCm: 200, yCm: 0 }, footprint), 40);
  assert.equal(minimumSegmentPolygonDistance({ xCm: 200, yCm: 0 }, { xCm: 100, yCm: 0 }, footprint), 40);
  assert.equal(minimumSegmentPolygonDistance({ xCm: 100, yCm: 40 }, { xCm: 200, yCm: 40 }, footprint), 0);
});