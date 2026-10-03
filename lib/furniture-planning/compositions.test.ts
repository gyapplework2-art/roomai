import assert from "node:assert/strict";
import test from "node:test";

import { createLShapeGeometry, createRectangleGeometry, createTShapeGeometry } from "@/lib/geometry/templates";
import { isPointInsideOrOnPolygon } from "@/lib/geometry/point-in-polygon";
import { livingRoomCompositions, type CompositionType } from "./compositions";
import { selectLivingRoomComposition, type RequirementDiagnostics } from "./composition-selector";
import { generateCompositionRolePlan, resolveLivingRoomComposition } from "./role-plan";
import { resolveSemanticPlan } from "./semantic-resolver";
import { PRIMARY_SEATING_ZONE_ID } from "./zones";

const room = createRectangleGeometry(500, 400, 250);
const expectedCategories: Array<Partial<Record<CompositionType, number>>> = [
  { sofa: 1, armchair: 2, coffee_table: 1, rug: 1 },
  { sofa: 1, armchair: 1, coffee_table: 1, rug: 1 },
  { sectional: 1, coffee_table: 1, rug: 1 },
  { loveseat: 1, armchair: 2, coffee_table: 1, rug: 1 },
  { sofa: 1, loveseat: 1, coffee_table: 1, rug: 1 },
  { modular_seating: 1, coffee_table: 1, rug: 1 },
];

test("T1 through T6 have stable IDs, exact multiplicities and explicit hierarchy", () => {
  assert.deepEqual(livingRoomCompositions.map((template) => template.id), ["T1", "T2", "T3", "T4", "T5", "T6"]);
  livingRoomCompositions.forEach((template, index) => {
    const counts: Partial<Record<CompositionType, number>> = {};
    for (const role of template.roles) {
      counts[role.category] = (counts[role.category] ?? 0) + role.count;
      assert.equal(role.count, role.placements.length);
      assert.equal(role.zoneType, "PRIMARY_SEATING");
    }
    assert.deepEqual(counts, expectedCategories[index]);
    assert.equal(template.group.type, "PRIMARY_SEATING_GROUP");
    assert.equal(template.group.primaryAnchorKey, "primary-seating");
    assert.deepEqual(template.group.secondaryAnchorKeys, ["area-rug", "coffee-table"]);
    assert.ok(template.roles.some((role) => role.key === template.group.primaryAnchorKey && role.role === "PRIMARY_SEATING"));
    assert.equal(JSON.stringify(template).includes("catalog"), false);
  });
});

test("selector policy covers sparse, small, medium and large rooms deterministically", () => {
  assert.equal(selectLivingRoomComposition().id, "T2");
  assert.equal(selectLivingRoomComposition({ geometry: createRectangleGeometry(300, 350, 250), roomFunctions: ["entertaining"] }).id, "T2");
  assert.equal(selectLivingRoomComposition({ geometry: room, roomFunctions: ["entertaining"] }).id, "T1");
  assert.equal(selectLivingRoomComposition({ geometry: createRectangleGeometry(600, 400, 250) }).id, "T3");
  assert.equal(selectLivingRoomComposition({ geometry: createRectangleGeometry(700, 500, 250), roomFunctions: ["entertaining"] }).id, "T6");
  assert.equal(selectLivingRoomComposition({ geometry: createRectangleGeometry(700, 500, 250), roomFunctions: ["reading"] }).id, "T1");
  const input = { geometry: room, roomFunctions: ["entertaining", "reading"] };
  assert.deepEqual(selectLivingRoomComposition(input), selectLivingRoomComposition(input));
});

for (const [requirements, expected] of [
  [["sectional"], "T3"], [["modular seating"], "T6"], [["loveseat"], "T4"],
  [["sofa", "loveseat"], "T5"], [["accent chair", "accent chair", "sofa"], "T1"],
] as const) {
  test(`represented requirements ${requirements.join(", ")} select ${expected} before small-room policy`, () => {
    const input = { geometry: createRectangleGeometry(300, 350, 250), mustHaveItems: requirements };
    assert.equal(selectLivingRoomComposition(input).id, expected);
    assert.equal(selectLivingRoomComposition({ ...input, mustHaveItems: [...requirements].reverse() }).id, expected);
  });
}

for (const composition of livingRoomCompositions) {
  test(`${composition.id} generates stable role IDs, supported relationships, and explicit group hierarchy`, () => {
    const snapshot = structuredClone(composition);
    const result = generateCompositionRolePlan(composition, room);
    assert.deepEqual(generateCompositionRolePlan(composition, room), result);
    assert.deepEqual(composition, snapshot);
    const { plan, group } = result;
    assert.equal(group.primaryAnchorItemId, "primary-seating-1");
    assert.deepEqual(group.secondaryAnchorItemIds, ["area-rug-1", "coffee-table-1"]);
    const ids = new Set(plan.items.map((item) => item.id));
    assert.equal(ids.size, plan.items.length);
    const table = plan.items.find((item) => item.category === "coffee_table");
    assert.deepEqual(table?.semanticPlacement.relationships, [{ type: "IN_FRONT_OF", targetItemId: group.primaryAnchorItemId }]);
    const rug = plan.items.find((item) => item.category === "rug");
    assert.equal(rug?.semanticPlacement.mode, "CENTERED_IN_ZONE");
    assert.equal(rug?.semanticPlacement.zoneId, PRIMARY_SEATING_ZONE_ID);
    for (const item of plan.items) {
      for (const relationship of item.semanticPlacement.relationships) {
        assert.ok(ids.has(relationship.targetItemId));
        assert.ok(["IN_FRONT_OF", "ADJACENT_TO", "FACES"].includes(relationship.type));
        assert.notEqual(item.id, relationship.targetItemId);
      }
    }
    for (const chair of plan.items.filter((item) => item.category === "armchair")) {
      assert.ok(group.dependentItemIds.includes(chair.id));
      assert.deepEqual(chair.semanticPlacement.relationships, [
        { type: "ADJACENT_TO", targetItemId: group.primaryAnchorItemId },
        { type: "FACES", targetItemId: group.primaryAnchorItemId },
      ]);
    }
    assert.equal(JSON.stringify(result).includes("catalog"), false);
    const reversed = generateCompositionRolePlan({ ...composition, roles: [...composition.roles].reverse() }, room);
    assert.deepEqual(reversed.group, group);
    for (const item of reversed.plan.items) assert.deepEqual(item, plan.items.find((candidate) => candidate.id === item.id));
  });
}

test("composition to role plan to resolver supports independent chair dependents and polygon zones", () => {
  const generated = generateCompositionRolePlan(livingRoomCompositions[0], room);
  const snapshot = structuredClone(generated);
  const resolved = resolveSemanticPlan(generated.plan, room, [], generated.zones);
  assert.deepEqual(resolved.items.find((item) => item.id === "primary-seating-1")?.placement.approximatePosition, { xCm: 250, yCm: 45 });
  assert.deepEqual(resolved.items.find((item) => item.id === "coffee-table-1")?.placement.approximatePosition, { xCm: 250, yCm: 160 });
  for (const id of ["chairs-1", "chairs-2"]) {
    const chair = resolved.items.find((item) => item.id === id);
    assert.ok(chair);
    assert.deepEqual(chair.placement.approximatePosition, { xCm: 90, yCm: 45 });
    assert.equal(chair.placement.preferredOrientationDegrees, 270);
    assert.notStrictEqual(chair.placement, generated.plan.items.find((item) => item.id === id)?.placement);
  }
  assert.deepEqual(resolved.items.find((item) => item.id === "area-rug-1")?.placement.approximatePosition, { xCm: 250, yCm: 200 });
  const reversed = resolveSemanticPlan({ ...generated.plan, items: [...generated.plan.items].reverse() }, room, [], generated.zones);
  for (const item of reversed.items) assert.deepEqual(item, resolved.items.find((candidate) => candidate.id === item.id));
  assert.deepEqual(generated, snapshot);
});

test("integrated selector and resolver are deterministic on non-rectangular authoritative geometry", () => {
  const geometry = createLShapeGeometry(600, 500, 250);
  const input = { geometry, mustHaveItems: ["sofa"], roomFunctions: ["reading"] };
  const snapshot = structuredClone(input);
  const result = resolveLivingRoomComposition(input);
  assert.deepEqual(resolveLivingRoomComposition(input), result);
  assert.deepEqual(result.zones[0].polygon, geometry.vertices);
  const generated = generateCompositionRolePlan(selectLivingRoomComposition(input), geometry);
  const semanticResolved = resolveSemanticPlan(generated.plan, geometry, [], generated.zones);
  assert.deepEqual(semanticResolved, result.plan);
  assert.deepEqual(result.plan.items.find((item) => item.id === "primary-seating-1")?.placement.approximatePosition, { xCm: 300, yCm: 455 });
  assert.deepEqual(result.plan.items.find((item) => item.id === "coffee-table-1")?.placement.approximatePosition, { xCm: 300, yCm: 340 });
  for (const id of ["chairs-1", "chairs-2"]) {
    const chair = result.plan.items.find((item) => item.id === id);
    assert.deepEqual(chair?.placement.approximatePosition, { xCm: 140, yCm: 455 });
    assert.equal(chair?.placement.preferredOrientationDegrees, 270);
  }
  const rug = result.plan.items.find((item) => item.category === "rug");
  assert.deepEqual(rug?.placement.approximatePosition, result.zones[0].center);
  for (const item of result.plan.items) {
    assert.ok(item.placement.approximatePosition);
    assert.ok(isPointInsideOrOnPolygon(item.placement.approximatePosition, geometry.vertices));
    assert.notStrictEqual(semanticResolved.items.find((resolved) => resolved.id === item.id)?.placement, generated.plan.items.find((original) => original.id === item.id)?.placement);
  }
  assert.deepEqual(input, snapshot);
});

test("invalid geometry and unknown preferences use the documented sparse fallback", () => {
  assert.equal(selectLivingRoomComposition({ geometry: { ...room, vertices: [] }, roomFunctions: ["other"], mustHaveItems: ["artwork"] }).id, "T2");
});

test("wall selection respects authoritative openings and primary anchor is explicit", () => {
  const openings = [{
    openingType: "door" as const, wallSegmentId: "wall-1", offsetCm: 0, widthCm: 500,
    heightCm: 210, sillHeightCm: null, hingeSide: "left" as const, swingDirection: "inward" as const,
  }];
  const generated = generateCompositionRolePlan(livingRoomCompositions[1], room, openings);
  const primary = generated.plan.items.find((item) => item.id === generated.group.primaryAnchorItemId);
  assert.equal(primary?.semanticPlacement.targetWallId, "wall-3");
  const resolved = resolveSemanticPlan(generated.plan, room, openings, generated.zones);
  assert.deepEqual(resolved.items.find((item) => item.id === primary?.id)?.placement.approximatePosition, { xCm: 250, yCm: 355 });
});

const requirementCases: Array<{
  requested: string[];
  selected: string;
  diagnostics: RequirementDiagnostics;
}> = [
  {
    requested: ["sofa", "sectional"], selected: "T2",
    diagnostics: { recognized: [
      { category: "sectional", requested: 1, satisfied: 0, unmet: 1 },
      { category: "sofa", requested: 1, satisfied: 1, unmet: 0 },
    ], unrecognized: [] },
  },
  {
    requested: ["chair", "chair", "chair"], selected: "T1",
    diagnostics: { recognized: [{ category: "armchair", requested: 3, satisfied: 2, unmet: 1 }], unrecognized: [] },
  },
  {
    requested: ["sofa", "sofa"], selected: "T2",
    diagnostics: { recognized: [{ category: "sofa", requested: 2, satisfied: 1, unmet: 1 }], unrecognized: [] },
  },
  {
    requested: ["desk"], selected: "T2",
    diagnostics: { recognized: [], unrecognized: ["desk"] },
  },
];
for (const { requested, selected, diagnostics } of requirementCases) {
  test(`structured requirement diagnostics for ${requested.join(", ")} are exact and deterministic`, () => {
    const input = { geometry: room, mustHaveItems: requested };
    const snapshot = structuredClone(input);
    const selection = selectLivingRoomComposition(input);
    assert.equal(selection.id, selected);
    assert.deepEqual(selection.requirementDiagnostics, diagnostics);
    const result = resolveLivingRoomComposition(input);
    assert.equal(result.templateId, selected);
    assert.deepEqual(result.requirementDiagnostics, diagnostics);
    assert.deepEqual(selectLivingRoomComposition(input), selection);
    assert.deepEqual(resolveLivingRoomComposition(input), result);
    assert.deepEqual(resolveLivingRoomComposition({ ...input, mustHaveItems: [...requested].reverse() }), result);
    assert.deepEqual(input, snapshot);
  });
}

test("all represented composition categories are recognized and unknown requests preserve multiplicity", () => {
  const input = { mustHaveItems: ["area rug", "coffee table", "rug", "Desk", "artwork", "Desk"] };
  const selection = selectLivingRoomComposition(input);
  assert.equal(selection.id, "T2");
  assert.deepEqual(selection.requirementDiagnostics, {
    recognized: [
      { category: "coffee_table", requested: 1, satisfied: 1, unmet: 0 },
      { category: "rug", requested: 2, satisfied: 1, unmet: 1 },
    ],
    unrecognized: ["Desk", "Desk", "artwork"],
  });
  assert.deepEqual(selectLivingRoomComposition({ mustHaveItems: [...input.mustHaveItems].reverse() }), selection);
});

for (const composition of livingRoomCompositions.filter((template) => template.id === "T1" || template.id === "T4")) {
  test(`${composition.id} chairs independently target primary seating with exact directed resolution`, () => {
    const generated = generateCompositionRolePlan(composition, room);
    const resolved = resolveSemanticPlan(generated.plan, room, [], generated.zones);
    const chairs = generated.plan.items.filter((item) => item.category === "armchair");
    assert.equal(chairs.length, 2);
    for (const chair of chairs) {
      assert.deepEqual(chair.semanticPlacement.relationships, [
        { type: "ADJACENT_TO", targetItemId: generated.group.primaryAnchorItemId },
        { type: "FACES", targetItemId: generated.group.primaryAnchorItemId },
      ]);
      const result = resolved.items.find((item) => item.id === chair.id);
      assert.ok(result);
      assert.deepEqual(result.placement.approximatePosition, { xCm: composition.id === "T1" ? 90 : 120, yCm: 45 });
      assert.equal(result.placement.preferredOrientationDegrees, 270);
      assert.notStrictEqual(result.placement, chair.placement);
    }
    const onlySecond = { ...generated.plan, items: generated.plan.items.filter((item) => item.id !== "chairs-1") };
    assert.deepEqual(resolveSemanticPlan(onlySecond, room, [], generated.zones).items.find((item) => item.id === "chairs-2"), resolved.items.find((item) => item.id === "chairs-2"));
  });
}

const boundaryCases = [
  { name: "small area below", width: 500, length: 359.99, functions: ["entertaining"], expected: "T2" },
  { name: "small area at", width: 500, length: 360, functions: ["entertaining"], expected: "T1" },
  { name: "small area above", width: 500, length: 360.01, functions: ["entertaining"], expected: "T1" },
  { name: "small side below", width: 600, length: 349.99, functions: ["entertaining"], expected: "T2" },
  { name: "small side at", width: 600, length: 350, functions: ["entertaining"], expected: "T1" },
  { name: "small side above", width: 600, length: 350.01, functions: ["entertaining"], expected: "T1" },
  { name: "large boundary below", width: 599.99, length: 400, functions: [], expected: "T2" },
  { name: "large boundary at", width: 600, length: 400, functions: [], expected: "T3" },
  { name: "large boundary above", width: 600.01, length: 400, functions: [], expected: "T3" },
  { name: "large short side below", width: 700, length: 399.99, functions: [], expected: "T2" },
  { name: "large short side above", width: 700, length: 400.01, functions: [], expected: "T3" },
  { name: "large long side below", width: 599.99, length: 500, functions: [], expected: "T2" },
  { name: "large long side above", width: 600.01, length: 500, functions: [], expected: "T3" },
];
for (const { name, width, length, functions, expected } of boundaryCases) {
  test(`selector strategy threshold: ${name}`, () => {
    assert.equal(selectLivingRoomComposition({ geometry: createRectangleGeometry(width, length, 250), roomFunctions: functions }).id, expected);
  });
}

for (const area of [239999, 240001]) {
  test(`large-room strategy uses actual irregular polygon area ${area}, not bounding area`, () => {
    const length = area / (600 * (1 - 0.38 * 0.38));
    const geometry = createLShapeGeometry(600, length, 250);
    assert.ok(length > 400 && 600 * length > 240000);
    assert.equal(selectLivingRoomComposition({ geometry }).id, area < 240000 ? "T2" : "T3");
  });
}

test("irregular-room failed relationships preserve exact compatibility instead of claiming containment success", () => {
  const geometry = createTShapeGeometry(600, 1500, 250);
  const input = { geometry, roomFunctions: ["entertaining"] };
  const selection = selectLivingRoomComposition(input);
  assert.equal(selection.id, "T6");
  const generated = generateCompositionRolePlan(selection, geometry);
  const result = resolveSemanticPlan(generated.plan, geometry, [], generated.zones);
  const primary = result.items.find((item) => item.id === generated.group.primaryAnchorItemId);
  assert.deepEqual(primary?.placement.approximatePosition, { xCm: 309.5, yCm: 960 });
  const originalTable = generated.plan.items.find((item) => item.id === "coffee-table-1");
  const table = result.items.find((item) => item.id === "coffee-table-1");
  assert.ok(originalTable && table);
  assert.strictEqual(table.placement, originalTable.placement);
  assert.deepEqual(table.placement.approximatePosition, generated.zones[0].center);
  const rug = result.items.find((item) => item.id === "area-rug-1");
  assert.deepEqual(rug?.placement.approximatePosition, generated.zones[0].center);
  assert.notStrictEqual(rug?.placement, generated.plan.items.find((item) => item.id === "area-rug-1")?.placement);
  assert.deepEqual(resolveLivingRoomComposition(input).plan, result);
  assert.deepEqual(resolveLivingRoomComposition(input), resolveLivingRoomComposition(input));
  assert.ok(result.notes.some((note) => note.includes("physical fit and circulation are not certified")));
});

test("whole-room zone remains a documented bootstrap rather than final rug placement", () => {
  const geometry = createRectangleGeometry(1000, 800, 250);
  const result = resolveLivingRoomComposition({ geometry, mustHaveItems: ["sofa"] });
  assert.deepEqual(result.zones[0].polygon, geometry.vertices);
  assert.deepEqual(result.plan.items.find((item) => item.id === "area-rug-1")?.placement.approximatePosition, { xCm: 500, yCm: 400 });
  assert.deepEqual(result.plan.items.find((item) => item.id === "coffee-table-1")?.placement.approximatePosition, { xCm: 500, yCm: 160 });
  assert.ok(result.plan.notes.some((note) => note.includes("not exclusive seating ownership") && note.includes("final rug placement quality")));
  assert.ok(result.plan.notes.some((note) => note.includes("do not guarantee symmetric or separated placement")));
});