import assert from "node:assert/strict";
import test from "node:test";

import { createLShapeGeometry, createRectangleGeometry, createUShapeGeometry } from "@/lib/geometry/templates";
import { isPointInsideOrOnPolygon } from "@/lib/geometry/point-in-polygon";
import { deriveFunctionalZones, isValidFunctionalZone, PRIMARY_SEATING_ZONE_ID } from "./zones";
import type { FunctionalZone } from "./zones";
import { resolveSemanticPlan, resolveSemanticPlacement } from "./semantic-resolver";
import type { FurniturePlanItemV11, FurniturePlanV11 } from "./types";

const room = createRectangleGeometry(500, 400, 250);
const seatingZone = deriveFunctionalZones(room)[0];

function zoneItem(overrides: Partial<FurniturePlanItemV11> = {}): FurniturePlanItemV11 {
  return {
    id: "rug", category: "rug", subtype: null, priority: "required",
    placement: { preferredZone: "compatibility", anchorWallId: null, approximatePosition: { xCm: 100, yCm: 100 }, preferredOrientationDegrees: 37 },
    semanticPlacement: { role: "AREA_RUG", mode: "CENTERED_IN_ZONE", alignment: "CENTERED", zoneId: seatingZone.id, targetWallId: null, relationships: [], fallbackModes: [] },
    sizeRange: { widthMinCm: 100, widthMaxCm: 100, depthMinCm: 50, depthMaxCm: 50, heightMinCm: 1, heightMaxCm: 2 },
    styleHints: [], materialHints: [], colorHints: [], functionalRequirements: [], reasoning: "Zone intent",
    ...overrides,
  };
}

function zonePlan(items: FurniturePlanItemV11[]): FurniturePlanV11 {
  return { schemaVersion: "1.1", roomIntent: "Zone resolution", items, notes: [] };
}

test("PRIMARY_SEATING zone uses authoritative polygon and deterministic centroid without mutation", () => {
  const geometry = createRectangleGeometry(500, 400, 250);
  const snapshot = structuredClone(geometry);
  const zones = deriveFunctionalZones(geometry);
  assert.equal(zones.length, 1);
  assert.equal(zones[0].id, PRIMARY_SEATING_ZONE_ID);
  assert.equal(zones[0].type, "PRIMARY_SEATING");
  assert.deepEqual(zones[0].center, { xCm: 250, yCm: 200 });
  assert.equal(zones[0].orientationDegrees, 0);
  assert.deepEqual(zones[0].polygon, geometry.vertices);
  assert.notStrictEqual(zones[0].polygon[0], geometry.vertices[0]);
  assert.deepEqual(deriveFunctionalZones(geometry), zones);
  assert.deepEqual(geometry, snapshot);
});

for (const geometry of [createLShapeGeometry(600, 500, 250), createUShapeGeometry(600, 1000, 250)]) {
  test(`non-rectangular ${geometry.shapeType} zone has a valid deterministic interior center`, () => {
    const zones = deriveFunctionalZones(geometry);
    assert.equal(zones.length, 1);
    assert.ok(isValidFunctionalZone(zones[0], geometry));
    assert.ok(isPointInsideOrOnPolygon(zones[0].center, geometry.vertices));
    assert.deepEqual(deriveFunctionalZones(geometry), zones);
  });
}

test("invalid authoritative geometry yields no zones", () => {
  const geometry = createRectangleGeometry(500, 400, 250);
  assert.deepEqual(deriveFunctionalZones({ ...geometry, vertices: [] }), []);
});

test("CENTERED_IN_ZONE resolves center and orientation without mutating input", () => {
  const item = zoneItem();
  const snapshot = structuredClone(item);
  const resolved = resolveSemanticPlacement(item, room, [], undefined, [{ ...seatingZone, orientationDegrees: 359.6 }]);
  assert.deepEqual(resolved.placement.approximatePosition, seatingZone.center);
  assert.equal(resolved.placement.preferredOrientationDegrees, 0);
  assert.equal(resolved.placement.anchorWallId, null);
  assert.deepEqual(item, snapshot);
});

test("zone orientation is used and missing orientation deterministically defaults to zero", () => {
  const item = zoneItem();
  const { orientationDegrees: omitted, ...withoutOrientation } = seatingZone;
  assert.equal(omitted, 0);
  for (const [zone, expected] of [[{ ...seatingZone, orientationDegrees: 90 }, 90], [withoutOrientation, 0]] as const) {
    assert.equal(resolveSemanticPlacement(item, room, [], undefined, [zone]).placement.preferredOrientationDegrees, expected);
  }
});

const invalidZoneCases: Array<{ name: string; zones: FunctionalZone[] }> = [
  { name: "missing", zones: [] },
  { name: "duplicate IDs", zones: [seatingZone, seatingZone] },
  { name: "outside center", zones: [{ ...seatingZone, center: { xCm: 900, yCm: 900 } }] },
  { name: "nonfinite orientation", zones: [{ ...seatingZone, orientationDegrees: Infinity }] },
  { name: "invalid polygon", zones: [{ ...seatingZone, polygon: seatingZone.polygon.slice(0, 2) }] },
  { name: "outside polygon", zones: [{ ...seatingZone, polygon: seatingZone.polygon.map((vertex) => ({ ...vertex, xCm: vertex.xCm + 600 })) }] },
];
for (const { name, zones } of invalidZoneCases) {
  test(`${name} zone preserves exact compatibility placement and blocks dependents`, () => {
    const anchor = zoneItem();
    const dependent = zoneItem({ id: "dependent", semanticPlacement: { ...anchor.semanticPlacement, mode: "FLOATING", relationships: [{ type: "ADJACENT_TO", targetItemId: anchor.id }] } });
    const result = resolveSemanticPlan(zonePlan([dependent, anchor]), room, [], zones);
    assert.strictEqual(result.items[0].placement, dependent.placement);
    assert.strictEqual(result.items[1].placement, anchor.placement);
  });
}

test("successfully zone-resolved anchor is eligible for relational dependents", () => {
  const anchor = zoneItem();
  const dependent = zoneItem({ id: "dependent", semanticPlacement: { ...anchor.semanticPlacement, mode: "FLOATING", relationships: [{ type: "ADJACENT_TO", targetItemId: anchor.id }] } });
  const result = resolveSemanticPlan(zonePlan([dependent, anchor]), room, [], [seatingZone]);
  assert.deepEqual(result.items[0].placement.approximatePosition, { xCm: 140, yCm: 200 });
  assert.deepEqual(result.items[1].placement.approximatePosition, seatingZone.center);
});

test("wall placement remains authoritative even with a supplied zone", () => {
  const item = zoneItem({ semanticPlacement: { ...zoneItem().semanticPlacement, mode: "AGAINST_WALL", targetWallId: "wall-1" } });
  const result = resolveSemanticPlan(zonePlan([item]), room, [], [seatingZone]);
  assert.deepEqual(result.items[0].placement.approximatePosition, { xCm: 250, yCm: 25 });
  assert.equal(result.items[0].placement.anchorWallId, "wall-1");
});

test("explicit positional relationship takes precedence over CENTERED_IN_ZONE even without a zone", () => {
  const anchor = zoneItem({ id: "sofa", semanticPlacement: { ...zoneItem().semanticPlacement, mode: "AGAINST_WALL", targetWallId: "wall-1" } });
  const source = zoneItem({ semanticPlacement: { ...zoneItem().semanticPlacement, relationships: [{ type: "IN_FRONT_OF", targetItemId: anchor.id }] } });
  const result = resolveSemanticPlan(zonePlan([source, anchor]), room, [], []);
  assert.deepEqual(result.items[0].placement.approximatePosition, { xCm: 250, yCm: 115 });
});

test("FACES changes zone orientation only and unresolved FACES causes atomic fallback", () => {
  const target = zoneItem({ id: "target", semanticPlacement: { ...zoneItem().semanticPlacement, mode: "FLOATING" } });
  const item = zoneItem({ semanticPlacement: { ...zoneItem().semanticPlacement, relationships: [{ type: "FACES", targetItemId: target.id }] } });
  const result = resolveSemanticPlan(zonePlan([item, target]), room, [], [seatingZone]);
  assert.deepEqual(result.items[0].placement.approximatePosition, seatingZone.center);
  assert.notEqual(result.items[0].placement.preferredOrientationDegrees, seatingZone.orientationDegrees);
  const coincident = { ...target, placement: { ...target.placement, approximatePosition: seatingZone.center } };
  for (const targets of [[], [coincident]]) {
    const failed = resolveSemanticPlan(zonePlan([item, ...targets]), room, [], [seatingZone]);
    assert.strictEqual(failed.items[0].placement, item.placement);
  }
});

test("concave room center fallback is the widest interior slab with a stable tie-break", () => {
  const geometry = createUShapeGeometry(600, 1000, 250);
  assert.deepEqual(deriveFunctionalZones(geometry)[0].center, { xCm: 300, yCm: 210 });
});

test("zone edges cannot bridge an exterior notch despite valid vertices and center", () => {
  const geometry = createUShapeGeometry(600, 1000, 250);
  const zone: FunctionalZone = {
    id: seatingZone.id, type: "PRIMARY_SEATING",
    polygon: [
      { id: "left", xCm: 100, yCm: 800 },
      { id: "right", xCm: 500, yCm: 800 },
      { id: "bottom", xCm: 300, yCm: 100 },
    ],
    center: { xCm: 300, yCm: 200 },
  };
  assert.ok(zone.polygon.every((vertex) => isPointInsideOrOnPolygon(vertex, geometry.vertices)));
  assert.equal(isValidFunctionalZone(zone, geometry), false);
  const item = zoneItem();
  assert.strictEqual(resolveSemanticPlan(zonePlan([item]), geometry, [], [zone]).items[0].placement, item.placement);
});

test("unsupported and conflicting relationships on a zone-centered item preserve atomic fallback", () => {
  const target = zoneItem({ id: "target", semanticPlacement: { ...zoneItem().semanticPlacement, mode: "FLOATING" } });
  const other = { ...target, id: "other" };
  const cases: FurniturePlanItemV11["semanticPlacement"]["relationships"][] = [
    [{ type: "FACES", targetItemId: target.id }, { type: "GROUPED_WITH", targetItemId: target.id }],
    [{ type: "FACES", targetItemId: target.id }, { type: "FACES", targetItemId: other.id }],
  ];
  for (const relationships of cases) {
    const item = zoneItem({ semanticPlacement: { ...zoneItem().semanticPlacement, relationships } });
    assert.strictEqual(resolveSemanticPlan(zonePlan([item, target, other]), room, [], [seatingZone]).items[0].placement, item.placement);
  }
});