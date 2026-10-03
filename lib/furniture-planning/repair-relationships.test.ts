import assert from "node:assert/strict";
import test from "node:test";
import { createRectangleGeometry } from "@/lib/geometry/templates";
import type { FurniturePlanItemV11, FurniturePlanV11 } from "./types";
import { buildRepairRelationshipView, generateRelationshipRepairCandidates, completeRelationshipChanges, RELATIONSHIP_REPAIR_LIMITS } from "./repair-relationships";
import { computeFacesOrientation } from "./semantic-resolver";

const room = createRectangleGeometry(600, 400, 250);
function member(id: string, target?: string): FurniturePlanItemV11 {
  return {
    id, category: "armchair", subtype: null, priority: "required",
    placement: { preferredZone: null, anchorWallId: id === "anchor" ? "wall-1" : null, approximatePosition: { xCm: 300, yCm: 50 }, preferredOrientationDegrees: 0 },
    semanticPlacement: { role: id === "anchor" ? "PRIMARY_SEATING" : "SECONDARY_SEATING", mode: id === "anchor" ? "AGAINST_WALL" : "FLOATING", alignment: null, zoneId: "seating", targetWallId: id === "anchor" ? "wall-1" : null,
      relationships: target ? [{ type: "ADJACENT_TO", targetItemId: target }, { type: "FACES", targetItemId: target }] : [], fallbackModes: [] },
    sizeRange: { widthMinCm: 80, widthMaxCm: 80, depthMinCm: 80, depthMaxCm: 80, heightMinCm: 50, heightMaxCm: 100 },
    styleHints: [], materialHints: [], colorHints: [], functionalRequirements: [], reasoning: "Relationship repair fixture",
  };
}
function plan(items: FurniturePlanItemV11[]): FurniturePlanV11 { return { schemaVersion: "1.1", roomIntent: "Graph", items, notes: [] }; }

test("stable outgoing/dependent lookup and topological order are immutable and input-order independent", () => {
  const source = plan([member("b", "anchor"), member("anchor"), member("a", "anchor")]);
  const snapshot = structuredClone(source);
  const view = buildRepairRelationshipView(source);
  assert.deepEqual(view.nodes.find((node) => node.itemId === "anchor")?.dependentIds, ["a", "b"]);
  assert.ok(view.nodes.find((node) => node.itemId === "anchor")?.primaryAnchor);
  assert.deepEqual(buildRepairRelationshipView({ ...source, items: [...source.items].reverse() }), view);
  assert.deepEqual(source, snapshot);
});

test("coordinated candidates place sorted IDs on opposite anchor-relative sides and atomically face it", () => {
  const source = plan([member("b", "anchor"), member("anchor"), member("a", "anchor")]);
  const candidates = generateRelationshipRepairCandidates(source, "b", room);
  assert.equal(candidates[0].strategy, "RELATIONSHIP_COORDINATED");
  assert.deepEqual(candidates[0].changes, [
    { itemId: "a", position: { xCm: 390, yCm: 50 }, orientationDegrees: 90 },
    { itemId: "b", position: { xCm: 210, yCm: 50 }, orientationDegrees: 270 },
  ]);
  assert.deepEqual(generateRelationshipRepairCandidates({ ...source, items: [...source.items].reverse() }, "b", room), candidates);
  assert.ok(candidates.every((candidate) => candidate.changes.every((change) => change.itemId !== "anchor")));
});

test("missing references and cycles fail safely without recursive candidate generation", () => {
  for (const source of [plan([member("a", "missing")]), plan([member("a", "b"), member("b", "a")])]) {
    assert.ok(buildRepairRelationshipView(source).unresolvedItemIds.length > 0);
    assert.deepEqual(generateRelationshipRepairCandidates(source, "a", room), []);
  }
});

test("IN_FRONT_OF takes precedence over an existing ADJACENT_TO declaration", () => {
  const anchor = member("anchor");
  const source = member("a", "anchor");
  source.semanticPlacement.relationships.push({ type: "IN_FRONT_OF", targetItemId: "anchor" });
  const candidates = generateRelationshipRepairCandidates(plan([source, anchor]), "a", room);
  assert.deepEqual(candidates[0].changes[0].position, { xCm: 300, yCm: 170 });
  assert.equal(candidates[0].changes[0].orientationDegrees, 180);
});

test("a dependent without FACES keeps its own orientation under rotated anchor geometry", () => {
  const anchor = member("anchor");
  anchor.placement.preferredOrientationDegrees = 90;
  const source = member("a", "anchor");
  source.placement.preferredOrientationDegrees = 37;
  source.semanticPlacement.relationships = [{ type: "ADJACENT_TO", targetItemId: "anchor" }];
  const candidates = generateRelationshipRepairCandidates(plan([source, anchor]), "a", room);
  assert.deepEqual(candidates[0].changes[0], { itemId: "a", position: { xCm: 300, yCm: 140 }, orientationDegrees: 37 });
});

test("single ADJACENT_TO candidates use representative sizes, plus/minus sides, and bounded outward gaps", () => {
  const source = plan([member("anchor"), member("single", "anchor")]);
  const candidates = generateRelationshipRepairCandidates(source, "single", room);
  assert.equal(candidates.length, 12);
  assert.equal(candidates[0].strategy, "RELATIONSHIP_SINGLE");
  assert.deepEqual(candidates[0].changes[0].position, { xCm: 390, yCm: 50 });
  assert.deepEqual(candidates[1].changes[0].position, { xCm: 210, yCm: 50 });
  assert.deepEqual(candidates[2].changes[0].position, { xCm: 400, yCm: 50 });
  assert.deepEqual(candidates[11].changes[0].position, { xCm: 150, yCm: 50 });
});

test("arbitrary anchor orientation determines adjacency and FACES uses the shared A.2 width-axis helper", () => {
  const anchor = member("anchor");
  anchor.placement.preferredOrientationDegrees = 45;
  const source = plan([anchor, member("single", "anchor")]);
  const candidate = generateRelationshipRepairCandidates(source, "single", room)[0].changes[0];
  assert.deepEqual(candidate.position, { xCm: 363.64, yCm: 113.64 });
  assert.ok(anchor.placement.approximatePosition);
  assert.equal(candidate.orientationDegrees, computeFacesOrientation(candidate.position, anchor.placement.approximatePosition));
});

test("IN_FRONT_OF uses wall normal even when the stored width axis points elsewhere", () => {
  const anchor = member("anchor");
  anchor.placement.preferredOrientationDegrees = 135;
  const source = member("table");
  source.semanticPlacement.relationships = [{ type: "IN_FRONT_OF", targetItemId: anchor.id }];
  const candidate = generateRelationshipRepairCandidates(plan([anchor, source]), source.id, room)[0].changes[0];
  assert.deepEqual(candidate.position, { xCm: 300, yCm: 170 });
  assert.equal(candidate.orientationDegrees, 0);
});

test("front direction is not invented for an unanchored IN_FRONT_OF target", () => {
  const anchor = member("anchor");
  anchor.placement.anchorWallId = null;
  anchor.semanticPlacement.mode = "FLOATING";
  const source = member("table");
  source.semanticPlacement.relationships = [{ type: "IN_FRONT_OF", targetItemId: anchor.id }];
  assert.deepEqual(generateRelationshipRepairCandidates(plan([anchor, source]), source.id, room), []);
});

test("FACES-only update retains orientation when valid target geometry is unavailable", () => {
  const source = member("source");
  source.placement.preferredOrientationDegrees = 37;
  source.semanticPlacement.relationships = [{ type: "FACES", targetItemId: "missing" }];
  const changes = completeRelationshipChanges(plan([source]), [{ itemId: source.id, position: { xCm: 320, yCm: 80 }, orientationDegrees: 37 }], room);
  assert.equal(changes?.[0].orientationDegrees, 37);
});

test("bounded dependency propagation carries IN_FRONT_OF to an ADJACENT_TO descendant atomically", () => {
  const anchor = member("anchor");
  const table = member("table", anchor.id);
  table.semanticPlacement.role = "COFFEE_TABLE";
  table.semanticPlacement.relationships = [{ type: "IN_FRONT_OF", targetItemId: anchor.id }, { type: "FACES", targetItemId: anchor.id }];
  const child = member("child", table.id);
  const source = plan([child, table, anchor]);
  const candidates = generateRelationshipRepairCandidates(source, table.id, room);
  assert.equal(candidates[0].strategy, "RELATIONSHIP_COORDINATED");
  assert.deepEqual(candidates[0].changes.map((change) => change.itemId), ["child", "table"]);
  assert.deepEqual(candidates[0].changes.find((change) => change.itemId === "table")?.position, { xCm: 300, yCm: 170 });
  assert.deepEqual(candidates[0].changes.find((change) => change.itemId === "child")?.position, { xCm: 210, yCm: 170 });
  assert.deepEqual(generateRelationshipRepairCandidates({ ...source, items: [...source.items].reverse() }, table.id, room), candidates);
});

test("malformed conflicting/unsupported references and duplicate item IDs do not create a graph overwrite", () => {
  const source = member("a", "anchor");
  source.semanticPlacement.relationships.push({ type: "ADJACENT_TO", targetItemId: "other" });
  assert.deepEqual(generateRelationshipRepairCandidates(plan([source, member("anchor"), member("other")]), source.id, room), []);
  const unsupported = member("a", "anchor");
  unsupported.semanticPlacement.relationships.push({ type: "GROUPED_WITH", targetItemId: "anchor" });
  assert.deepEqual(generateRelationshipRepairCandidates(plan([unsupported, member("anchor")]), source.id, room), []);
  assert.deepEqual(buildRepairRelationshipView(plan([member("same"), member("same")])), { nodes: [], dependencyOrder: [], unresolvedItemIds: ["same"] });
});

test("more than two dependents use bounded deterministic side lanes with no combinatorial search", () => {
  const source = plan([member("anchor"), ...["a", "b", "c", "d", "e"].map((id) => member(id, "anchor"))]);
  const candidates = generateRelationshipRepairCandidates(source, "e", room);
  const coordinated = candidates.filter((candidate) => candidate.strategy === "RELATIONSHIP_COORDINATED");
  assert.ok(coordinated.length <= RELATIONSHIP_REPAIR_LIMITS.maxCoordinatedAssignments);
  assert.ok(candidates.every((candidate) => candidate.changes.length <= RELATIONSHIP_REPAIR_LIMITS.maxDependents));
  assert.ok(coordinated[0].changes.some((change) => change.itemId === "e"));
  assert.equal(new Set(coordinated[0].changes.map((change) => JSON.stringify(change.position))).size, coordinated[0].changes.length);
});

test("chains exceeding the member bound fail as complete candidates rather than leaving dependents behind", () => {
  const sources = [member("anchor"), ...["a", "b", "c", "d", "e"].map((id, index, ids) => member(id, index === 0 ? "anchor" : ids[index - 1]))];
  assert.deepEqual(generateRelationshipRepairCandidates(plan(sources), "a", room), []);
});

test("coordinated assignment bound also covers nominally single candidates that propagate descendants", () => {
  const source = plan([member("anchor"), member("a", "anchor"), member("b", "anchor"), member("child", "a")]);
  const candidates = generateRelationshipRepairCandidates(source, "a", room);
  assert.ok(candidates.length > 0);
  assert.ok(candidates.filter((candidate) => candidate.strategy === "RELATIONSHIP_COORDINATED").length <= 16);
  assert.ok(candidates.every((candidate) => candidate.changes.length <= 4));
});