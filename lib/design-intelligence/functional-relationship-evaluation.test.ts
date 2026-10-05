import assert from "node:assert/strict";
import test from "node:test";

import { createRectangleGeometry } from "@/lib/geometry/templates";
import { resolveLivingRoomComposition } from "@/lib/furniture-planning/role-plan";
import { validateSpatialPlan } from "@/lib/furniture-planning/spatial-validator";
import { evaluateBedNightstandFunctionalRelationship } from "./bed-nightstand-relationship";
import { evaluateDeskOfficeChairFunctionalRelationship } from "./desk-office-chair-relationship";
import { evaluateDiningTableChairFunctionalRelationship } from "./dining-table-chair-relationship";
import { aestheticDesignContextSchema, createAestheticDesignContext, type CatalogAestheticMetadata } from "./aesthetic-context";
import { aestheticEvaluationReportSchema } from "./aesthetic-contracts";
import { evaluateFunctionalRelationships } from "./functional-relationship-evaluation";
import type { FurniturePlanItemV11 } from "@/lib/furniture-planning/types";

const geometry = createRectangleGeometry(900, 700, 250);
const projectFor = (roomType: "dining_room" | "bedroom" | "guest_room" | "home_office") => ({ id: `functional-${roomType}`, room_type: roomType });
function catalog(itemId: string, options: { height?: number | null; seatingCapacity?: number | null; color?: string | null; material?: string | null } = {}): CatalogAestheticMetadata {
  return {
    productId: `catalog-${itemId}`, variantId: `variant-${itemId}`, normalizedStyle: null,
    normalizedColor: options.color ?? null, normalizedMaterial: options.material ?? null,
    seatingCapacity: options.seatingCapacity ?? null, widthCm: 100, depthCm: 60,
    heightCm: options.height === undefined ? 75 : options.height,
  };
}

function makeContext(options: {
  pair: "dining_table_chair" | "bed_nightstand" | "desk_office_chair";
  association?: "GROUP" | "GROUPED_WITH" | "NONE";
  roomType?: "dining_room" | "bedroom" | "guest_room" | "home_office";
  tableCapacity?: number | null;
  nightstandHeight?: number | null;
  genericDimensions?: number | null;
  colors?: readonly [string | null, string | null];
  materials?: readonly [string | null, string | null];
  reverseItems?: boolean;
  extraPairs?: number;
}) {
  const composition = resolveLivingRoomComposition({ geometry, mustHaveItems: ["sofa", "chair"], roomFunctions: [] });
  const firstSource = composition.plan.items.find((item) => item.semanticPlacement.role === "PRIMARY_SEATING");
  const secondSource = composition.plan.items.find((item) => item.semanticPlacement.role === "SECONDARY_SEATING");
  assert.ok(firstSource && secondSource);
  const categories = options.pair === "dining_table_chair" ? ["dining_table", "dining_chair"] as const
    : options.pair === "bed_nightstand" ? ["bed", "nightstand"] as const : ["desk", "office_chair"] as const;
  const ids = ["functional-first", "functional-second"];
  const roleByCategory: Record<string, FurniturePlanItemV11["semanticPlacement"]["role"]> = {
    dining_table: "COFFEE_TABLE", dining_chair: "SECONDARY_SEATING",
    bed: "PRIMARY_SEATING", nightstand: "SIDE_TABLE",
    desk: "STORAGE", office_chair: "SECONDARY_SEATING",
  };
  const pairItems: FurniturePlanItemV11[] = categories.map((category, index) => {
    const source = index === 0 ? firstSource : secondSource;
    return {
      ...source,
      id: ids[index],
      category,
      semanticPlacement: { ...source.semanticPlacement, role: roleByCategory[category], relationships: [] },
    };
  });
  if ((options.extraPairs ?? 0) > 0) {
    for (let index = 0; index < (options.extraPairs ?? 0); index += 1) {
      const id = `functional-chair-${index + 1}`;
      pairItems.push({ ...pairItems[1], id });
    }
  }
  const association = options.association ?? "GROUP";
  if (association === "GROUPED_WITH") {
    pairItems[0] = {
      ...pairItems[0],
      semanticPlacement: { ...pairItems[0].semanticPlacement, relationships: [{ type: "GROUPED_WITH", targetItemId: pairItems[1].id }] },
    };
  }
  const items = options.reverseItems ? [...pairItems].reverse() : pairItems;
  const plan = { schemaVersion: "1.1" as const, roomIntent: "B.8 explicit functional relationship fixture", items, notes: [] };
  const group = {
    id: "primary-seating-group" as const,
    type: "PRIMARY_SEATING_GROUP" as const,
    itemIds: pairItems.map((item) => item.id),
    zoneId: "primary-seating",
    primaryAnchorItemId: pairItems[0].id,
    secondaryAnchorItemIds: pairItems.slice(1).map((item) => item.id),
    dependentItemIds: [],
  };
  const groups = association === "GROUP" ? [group] : [];
  const metadataByPlanId = Object.fromEntries(items.map((item) => [item.id, {
    catalog: catalog(item.id, {
      height: item.category === "nightstand" ? options.nightstandHeight : options.genericDimensions,
      seatingCapacity: item.category === "dining_table" ? options.tableCapacity : null,
      color: options.colors?.[pairItems.indexOf(item)] ?? null,
      material: options.materials?.[pairItems.indexOf(item)] ?? null,
    }),
  }]));
  const zones = composition.zones;
  const spatialReport = validateSpatialPlan(plan, geometry, [], zones);
  const context = createAestheticDesignContext({
    designId: "functional-relationship-design",
    project: projectFor(options.roomType ?? (options.pair === "dining_table_chair" ? "dining_room" : options.pair === "bed_nightstand" ? "bedroom" : "home_office")),
    preferences: null, plan, geometry, openings: [], zones, groups, spatialReport,
    itemMetadataByPlanId: metadataByPlanId,
  });
  return { context, pairItems, group };
}

function functionalFindings(report: ReturnType<typeof evaluateFunctionalRelationships>) {
  return report.findings.filter((finding) => finding.target.dimension === "functional_relationship");
}

function functionalObservation(finding: ReturnType<typeof evaluateFunctionalRelationships>["findings"][number]) {
  const observation = finding.supportingEvidence[0]?.observation;
  assert.ok(observation);
  assert.equal(observation.kind, "functional_relationship_observation");
  if (observation.kind !== "functional_relationship_observation") assert.fail("expected functional relationship evidence");
  return observation;
}

test("no explicitly associated supported pair is NOT_APPLICABLE", () => {
  const context = makeContext({ pair: "dining_table_chair", association: "NONE" }).context;
  const report = evaluateFunctionalRelationships(context);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.relationships, []);
  assert.equal(report.coverage.find((entry) => entry.dimension === "functional_relationship")?.status, "NOT_APPLICABLE");
});

test("explicit grouped dining table/chair preserves existing unknown capacity and count reasons", () => {
  const { context, pairItems, group } = makeContext({ pair: "dining_table_chair", tableCapacity: 6 });
  const report = evaluateFunctionalRelationships(context);
  const finding = functionalFindings(report)[0];
  assert.ok(finding);
  const source = evaluateDiningTableChairFunctionalRelationship({ seatingCapacity: 6 });
  const observation = functionalObservation(finding);
  assert.equal(finding.target.kind, "relationship");
  assert.equal(finding.target.relationshipType, "dining_table_chair");
  assert.equal(finding.coverage.status, "NOT_EVALUATED");
  assert.equal(finding.evidenceCompleteness, "partial");
  assert.deepEqual(finding.missingInformation, [{
    code: "functional_relationship.required_evidence_unavailable",
    dimension: "functional_relationship",
    itemIds: pairItems.map((item) => item.id).sort(),
    description: "The functional evidence required to determine relationship fit is unavailable in the existing source evaluator inputs.",
  }]);
  assert.equal(finding.compatibility, "unknown");
  assert.deepEqual(observation.reasons, source.reasons);
  assert.equal(observation.sourceEvaluatorId, "dining-table-chair-relationship");
  assert.deepEqual(observation.relationshipSources, [{ kind: "E10A_GROUP", groupId: group.id }]);
  assert.deepEqual(finding.itemIds, pairItems.map((item) => item.id).sort());
  assert.deepEqual(report.issues, []);
});

test("missing table seating capacity preserves the source evaluator boundary", () => {
  const { context } = makeContext({ pair: "dining_table_chair", tableCapacity: null });
  const report = evaluateFunctionalRelationships(context);
  const observation = functionalObservation(functionalFindings(report)[0]);
  const source = evaluateDiningTableChairFunctionalRelationship({ seatingCapacity: null });
  assert.deepEqual(observation.reasons, source.reasons);
  assert.ok(observation.reasons.includes("chair_count_not_represented_by_candidate"));
  assert.equal(observation.compatibility, "unknown");
});

test("bed/nightstand preserves existing reasons and reports missing functional evidence", () => {
  const { context } = makeContext({ pair: "bed_nightstand", nightstandHeight: 60 });
  const report = evaluateFunctionalRelationships(context);
  const observation = functionalObservation(functionalFindings(report)[0]);
  const source = evaluateBedNightstandFunctionalRelationship(60);
  assert.equal(observation.sourceEvaluatorId, "bed-nightstand-relationship");
  assert.deepEqual(observation.reasons, source.reasons);
  assert.deepEqual(observation.reasons, [
    "bed_sleeping_surface_height_not_represented",
    "nightstand_height_known_but_not_comparable_to_bed_total_height",
    "bedside_height_alignment_unknown",
  ]);
  assert.equal(observation.compatibility, "unknown");
  const finding = functionalFindings(report)[0];
  assert.equal(finding.evidenceCompleteness, "partial");
  assert.equal(finding.missingInformation[0].code, "functional_relationship.required_evidence_unavailable");
  assert.deepEqual(finding.missingInformation[0].itemIds, finding.itemIds);
});

test("missing nightstand height preserves its existing functional unknown output", () => {
  const { context } = makeContext({ pair: "bed_nightstand", nightstandHeight: null });
  const observation = functionalObservation(functionalFindings(evaluateFunctionalRelationships(context))[0]);
  const source = evaluateBedNightstandFunctionalRelationship(null);
  assert.deepEqual(observation.reasons, source.reasons);
  assert.equal(observation.pairItems.find((item) => item.category === "nightstand")?.heightCm, null);
  assert.equal(observation.compatibility, "unknown");
});

test("desk/office chair records existing ergonomic evidence gaps without claiming fit", () => {
  const { context } = makeContext({ pair: "desk_office_chair", genericDimensions: 140 });
  const report = evaluateFunctionalRelationships(context);
  const finding = functionalFindings(report)[0];
  const observation = functionalObservation(finding);
  assert.deepEqual(observation.reasons, evaluateDeskOfficeChairFunctionalRelationship().reasons);
  assert.equal(observation.sourceEvaluatorId, "desk-office-chair-relationship");
  assert.ok(observation.reasons.includes("ergonomic_fit_unknown"));
  assert.equal(finding.compatibility, "unknown");
  assert.equal(finding.impact, "NEUTRAL");
  assert.equal(finding.evidenceCompleteness, "partial");
  assert.equal(finding.missingInformation[0].code, "functional_relationship.required_evidence_unavailable");
});

test("explicit GROUPED_WITH relationship independently establishes supported pair scope", () => {
  const { context, pairItems } = makeContext({ pair: "desk_office_chair", association: "GROUPED_WITH" });
  const report = evaluateFunctionalRelationships(context);
  const finding = functionalFindings(report)[0];
  assert.ok(finding);
  const observation = functionalObservation(finding);
  assert.deepEqual(observation.relationshipSources, [{ kind: "SEMANTIC_RELATIONSHIP", relationshipType: "GROUPED_WITH" }]);
  assert.deepEqual(finding.itemIds, pairItems.map((item) => item.id).sort());
});

test("nearby but ungrouped and unlinked furniture does not create functional pair findings", () => {
  const { context } = makeContext({ pair: "bed_nightstand", association: "NONE" });
  const nearby = aestheticDesignContextSchema.parse({
    ...context,
    items: context.items.map((item) => ({ ...item, placement: { ...item.placement, approximatePosition: { xCm: 50, yCm: 50 } } })),
  });
  assert.deepEqual(functionalFindings(evaluateFunctionalRelationships(nearby)), []);
});

test("unsupported category pair remains out of scope even when explicitly grouped", () => {
  const base = makeContext({ pair: "dining_table_chair" });
  const context = aestheticDesignContextSchema.parse({
    ...base.context,
    items: base.context.items.map((item) => ({ ...item, category: "accent_chair" })),
  });
  const report = evaluateFunctionalRelationships(context);
  assert.deepEqual(functionalFindings(report), []);
  assert.equal(report.coverage.find((entry) => entry.dimension === "functional_relationship")?.status, "NOT_APPLICABLE");
});

test("multiple chair members create only explicit supported table-chair relationships", () => {
  const { context } = makeContext({ pair: "dining_table_chair", extraPairs: 2, tableCapacity: 6 });
  const report = evaluateFunctionalRelationships(context);
  assert.equal(functionalFindings(report).length, 3);
  assert.equal(report.relationships.length, 3);
  assert.ok(functionalFindings(report).every((finding) => finding.itemIds.includes("functional-first")));
  assert.deepEqual(report.issues, []);
  assert.deepEqual(report.strengths, []);
});

test("B.2/B.3 dimensions are excluded and no positive/issue score is created", () => {
  const report = evaluateFunctionalRelationships(makeContext({ pair: "dining_table_chair", colors: ["cream", "blue"], materials: ["oak", "leather"] }).context);
  assert.ok(report.findings.every((finding) => finding.target.dimension === "functional_relationship"));
  assert.deepEqual(report.strengths, []);
  assert.deepEqual(report.issues, []);
  assert.equal("score" in report, false);
  for (const dimension of ["scale_proportion", "color_harmony", "material_harmony", "texture_harmony"] as const) {
    assert.equal(report.findings.some((finding) => finding.target.dimension === dimension), false);
  }
});

test("spatial validity is preserved without copying physical violations into functional issues", () => {
  const base = makeContext({ pair: "desk_office_chair" }).context;
  for (const status of ["VALID", "INVALID", "NOT_FULLY_EVALUATED"] as const) {
    const context = aestheticDesignContextSchema.parse({
      ...base,
      spatialValidation: { ...base.spatialValidation, status, valid: status === "INVALID" ? false : base.spatialValidation.valid },
    });
    const report = evaluateFunctionalRelationships(context);
    assert.equal(report.spatialStatus.status, status);
    assert.deepEqual(report.issues, []);
  }
});

test("functional evidence and source findings are deterministic, immutable, permutation-invariant, and schema-valid", () => {
  const base = makeContext({ pair: "dining_table_chair", association: "GROUPED_WITH" }).context;
  const permuted = aestheticDesignContextSchema.parse({
    ...base,
    items: [...base.items].reverse(),
    groups: [...base.groups].reverse().map((group) => ({ ...group, itemIds: [...group.itemIds].reverse() })),
  });
  const snapshot = structuredClone(permuted);
  const report = evaluateFunctionalRelationships(permuted);
  assert.deepEqual(evaluateFunctionalRelationships(permuted), report);
  assert.deepEqual(evaluateFunctionalRelationships(base), report);
  assert.deepEqual(permuted, snapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  assert.equal(aestheticEvaluationReportSchema.safeParse(report).success, true);
  assert.deepEqual(report.findings.map((finding) => finding.findingId), [...report.findings.map((finding) => finding.findingId)].sort());
});
