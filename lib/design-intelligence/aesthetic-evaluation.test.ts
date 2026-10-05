import assert from "node:assert/strict";
import test from "node:test";

import { createRectangleGeometry } from "@/lib/geometry/templates";
import { resolveLivingRoomComposition } from "@/lib/furniture-planning/role-plan";
import { validateSpatialPlan } from "@/lib/furniture-planning/spatial-validator";
import type { Tables } from "@/types/database.types";
import { aestheticDesignContextSchema, createAestheticDesignContext, type CatalogAestheticMetadata } from "./aesthetic-context";
import { aestheticDimensions, aestheticEvaluationReportSchema } from "./aesthetic-contracts";
import { aggregateScaleProportionCoverage, evaluateAestheticDesign } from "./aesthetic-evaluation";
import { evaluateFurnitureProportions } from "./furniture-proportion";
import { evaluateFunctionalRelationships } from "./functional-relationship-evaluation";
import { evaluateFurnitureGroupComposition } from "./furniture-group-composition";
import { evaluateLightingIntelligence } from "./lighting-intelligence";
import { evaluatePaletteMaterialComposition } from "./palette-material-composition";
import { evaluateRoomFurnitureScale } from "./room-furniture-scale";
import { evaluateRugZoneIntelligence } from "./rug-zone-intelligence";
import { evaluateStyleHarmony } from "./style-harmony-evaluation";
import { evaluateVisualWeight } from "./visual-weight";

const geometry = createRectangleGeometry(800, 500, 250);
const composition = resolveLivingRoomComposition({ geometry, mustHaveItems: ["sofa"], roomFunctions: ["reading"] });
const project = { id: "aesthetic-evaluation-project", room_type: "living_room" as const };
type Preferences = Pick<Tables<"room_preferences">,
  "primary_style" | "secondary_style" | "color_mood" | "primary_color" | "secondary_color" | "accent_color" | "metal_color"
  | "preferred_materials" | "avoid_materials" | "room_functions" | "must_have_items" | "nice_to_have_items"
  | "household_size" | "special_requirements" | "additional_notes" | "priority">;

function preferences(style: string | null = "modern"): Preferences {
  return {
    primary_style: style, secondary_style: null, color_mood: null,
    primary_color: "cream", secondary_color: null, accent_color: null, metal_color: null,
    preferred_materials: ["oak"], avoid_materials: [], room_functions: ["reading"], must_have_items: [],
    nice_to_have_items: [], household_size: null, special_requirements: [], additional_notes: null, priority: null,
  };
}

function catalog(itemId: string, measurements: { widthCm: number | null; depthCm: number | null; heightCm: number | null } = {
  widthCm: 220, depthCm: 90, heightCm: 80,
}): CatalogAestheticMetadata {
  return {
    productId: `catalog-${itemId}`, variantId: `variant-${itemId}`, normalizedStyle: "modern",
    normalizedColor: "cream", normalizedMaterial: "oak", seatingCapacity: null, ...measurements,
  };
}

function makeContext(options: { empty?: boolean; knownWeight?: "LIGHT" | "MEDIUM" | "HEAVY"; missingSofaDimensions?: boolean } = {}) {
  const basePlan = composition.plan;
  const sofa = basePlan.items.find((item) => item.semanticPlacement.role === "PRIMARY_SEATING");
  assert.ok(sofa);
  const plan = options.empty ? { ...basePlan, items: [], roomIntent: "Empty plan" } : basePlan;
  const spatialReport = validateSpatialPlan(plan, geometry, [], composition.zones);
  const itemMetadataByPlanId = Object.fromEntries(plan.items.map((item) => [item.id, {
    catalog: catalog(item.id, options.missingSofaDimensions && item.id === sofa.id
      ? { widthCm: null, depthCm: null, heightCm: null } : undefined),
    ...(options.knownWeight && item.id === sofa.id ? { visualWeight: options.knownWeight } : {}),
  }]));
  const context = createAestheticDesignContext({
    designId: "aesthetic-evaluation-design", project, preferences: options.empty ? null : preferences(),
    plan, geometry, openings: [], zones: composition.zones, groups: options.empty ? [] : [composition.group],
    spatialReport, itemMetadataByPlanId,
  });
  return { context, sofaId: sofa.id };
}

function addSpatiallyInvalidPrimary(context: ReturnType<typeof makeContext>["context"], sourceItemId: string) {
  const source = context.items.find((item) => item.itemId === sourceItemId);
  assert.ok(source);
  const extra = { ...source, itemId: "invalid-primary", category: "sofa", semanticRole: "PRIMARY_SEATING" as const };
  return aestheticDesignContextSchema.parse({
    ...context,
    planReference: { ...context.planReference, itemIds: [...context.planReference.itemIds, extra.itemId] },
    items: [...context.items, extra],
    spatialValidation: { ...context.spatialValidation, violatingItemIds: [...context.spatialValidation.violatingItemIds, extra.itemId] },
  });
}

function addLightingAndDiningPair(context: ReturnType<typeof makeContext>["context"]) {
  const source = context.items.find((item) => item.semanticRole === "COFFEE_TABLE");
  assert.ok(source);
  const diningChair = { ...source, itemId: "dining-chair", category: "dining_chair" };
  const diningTable = {
    ...source,
    itemId: "dining-table",
    category: "dining_table",
    placement: { ...source.placement, relationships: [{ type: "GROUPED_WITH", targetItemId: diningChair.itemId }] },
  };
  const light = {
    ...source,
    itemId: "task-light",
    category: "floor_lamp",
    semanticRole: "TASK_LIGHTING" as const,
  };
  return aestheticDesignContextSchema.parse({
    ...context,
    planReference: { ...context.planReference, itemIds: [...context.planReference.itemIds, diningTable.itemId, diningChair.itemId, light.itemId] },
    items: [...context.items, diningTable, diningChair, light],
  });
}

test("empty context produces a valid report with owned N/A and default unowned coverage", () => {
  const { context } = makeContext({ empty: true });
  const report = evaluateAestheticDesign(context);
  assert.deepEqual(report.items, []);
  assert.equal(aestheticEvaluationReportSchema.safeParse(report).success, true);
  for (const dimension of ["scale_proportion", "visual_weight", "color_harmony", "material_harmony", "texture_harmony", "composition", "rug_zone_coherence", "lighting_composition", "style_harmony", "functional_relationship"] as const) {
    assert.equal(report.coverage.find((entry) => entry.dimension === dimension)?.status, "NOT_APPLICABLE");
  }
  for (const dimension of ["rhythm_repetition", "contrast", "vertical_composition", "room_specific_coherence"] as const) {
    assert.equal(report.coverage.find((entry) => entry.dimension === dimension)?.status, "NOT_EVALUATED");
  }
});

test("integrates living-room evaluator evidence without changing source findings or pair identities", () => {
  const context = addLightingAndDiningPair(makeContext().context);
  const reports = [
    evaluateRoomFurnitureScale(context),
    evaluateFurnitureProportions(context),
    evaluatePaletteMaterialComposition(context),
    evaluateVisualWeight(context),
    evaluateFurnitureGroupComposition(context),
    evaluateRugZoneIntelligence(context),
    evaluateLightingIntelligence(context),
    evaluateStyleHarmony(context),
    evaluateFunctionalRelationships(context),
  ];
  const integrated = evaluateAestheticDesign(context);
  const integratedFindings = new Map(integrated.findings.map((finding) => [finding.findingId, finding]));
  for (const report of reports) for (const finding of report.findings) assert.deepEqual(integratedFindings.get(finding.findingId), finding);
  for (const dimension of ["color_harmony", "material_harmony", "style_harmony", "composition", "rug_zone_coherence"] as const) {
    assert.ok(integrated.findings.some((finding) => finding.target.dimension === dimension));
  }
  assert.ok(integrated.findings.some((finding) => finding.target.dimension === "lighting_composition"));
  assert.ok(integrated.findings.some((finding) => finding.target.dimension === "functional_relationship"));
  assert.ok(integrated.items.every((item) => item.visualWeightEvidence !== null));
  assert.equal(aestheticEvaluationReportSchema.safeParse(integrated).success, true);
  assert.equal("score" in integrated, false);
  assert.ok(integrated.findings.every((finding) => finding.recommendationCategory === null));

  const sofaRugIds = reports[1].relationships.find((relationship) => relationship.type === "sofa_rug")?.itemIds;
  assert.ok(sofaRugIds);
  const sofaRugRelationships = integrated.relationships.filter((relationship) => JSON.stringify(relationship.itemIds) === JSON.stringify(sofaRugIds));
  assert.ok(sofaRugRelationships.length >= 2);
  assert.equal(new Set(integrated.relationships.map((relationship) => relationship.relationshipId)).size, integrated.relationships.length);
  for (const finding of integrated.findings) if (finding.target.kind === "relationship") {
    const target = finding.target;
    assert.ok(integrated.relationships.some((relationship) => relationship.relationshipId === target.relationshipId
      && relationship.type === target.relationshipType));
  }
});

test("scale coverage precedence is conservative for all owner-status combinations", () => {
  const coverage = (status: "EVALUATED" | "INSUFFICIENT_EVIDENCE" | "NOT_EVALUATED" | "NOT_APPLICABLE", itemIds: string[]) => ({
    dimension: "scale_proportion" as const,
    status,
    itemIds,
    reason: status === "EVALUATED" || status === "NOT_APPLICABLE" ? null : "source reason",
  });
  assert.deepEqual(aggregateScaleProportionCoverage([coverage("NOT_APPLICABLE", []), coverage("EVALUATED", ["sofa"])]),
    coverage("EVALUATED", ["sofa"]));
  assert.deepEqual(aggregateScaleProportionCoverage([coverage("NOT_APPLICABLE", []), coverage("NOT_APPLICABLE", [])]),
    coverage("NOT_APPLICABLE", []));
  assert.equal(aggregateScaleProportionCoverage([coverage("EVALUATED", ["sofa"]), coverage("INSUFFICIENT_EVIDENCE", ["rug"])]).status,
    "INSUFFICIENT_EVIDENCE");
  const notEvaluated = aggregateScaleProportionCoverage([coverage("EVALUATED", ["sofa"]), coverage("NOT_EVALUATED", ["chair"])]);
  assert.equal(notEvaluated.status, "NOT_EVALUATED");
  assert.deepEqual(notEvaluated.itemIds, ["chair", "sofa"]);
  assert.equal(aggregateScaleProportionCoverage([coverage("INSUFFICIENT_EVIDENCE", ["rug"]), coverage("NOT_EVALUATED", ["chair"])]).status,
    "INSUFFICIENT_EVIDENCE");
});

test("scale coverage ignores N/A when another owner applies and insufficient evidence dominates evaluated coverage", () => {
  const base = makeContext();
  const noGroup = aestheticDesignContextSchema.parse({ ...base.context, groups: [] });
  const applicable = evaluateAestheticDesign(noGroup).coverage.find((entry) => entry.dimension === "scale_proportion");
  assert.equal(applicable?.status, "EVALUATED");
  assert.ok(applicable?.itemIds.includes(base.sofaId));

  const invalidContext = addSpatiallyInvalidPrimary(base.context, base.sofaId);
  const scale = evaluateAestheticDesign(invalidContext).coverage.find((entry) => entry.dimension === "scale_proportion");
  assert.equal(scale?.status, "INSUFFICIENT_EVIDENCE");
  assert.deepEqual(scale?.itemIds, [...(scale?.itemIds ?? [])].sort());
});

test("single-owner coverage is preserved and incomplete owner statuses remain explicit", () => {
  const { context } = makeContext({ missingSofaDimensions: true });
  const report = evaluateAestheticDesign(context);
  assert.equal(report.coverage.find((entry) => entry.dimension === "visual_weight")?.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(report.coverage.find((entry) => entry.dimension === "style_harmony")?.status, "EVALUATED");
  assert.equal(report.coverage.find((entry) => entry.dimension === "functional_relationship")?.status, "NOT_APPLICABLE");
  assert.equal(report.coverage.find((entry) => entry.dimension === "scale_proportion")?.status, "INSUFFICIENT_EVIDENCE");
});

test("canonical item projection preserves known visual weight and only attaches compatible observations", () => {
  const unknownContext = makeContext().context;
  const unknownReport = evaluateAestheticDesign(unknownContext);
  const unknownSofaId = unknownContext.items.find((entry) => entry.semanticRole === "PRIMARY_SEATING")?.itemId;
  const sofaUnknown = unknownReport.items.find((item) => item.itemId === unknownSofaId);
  assert.ok(sofaUnknown);
  assert.equal(sofaUnknown.visualWeight, "UNKNOWN");
  assert.equal(sofaUnknown.visualWeightEvidence?.classification, "UNKNOWN");

  const knownContext = makeContext({ knownWeight: "HEAVY" }).context;
  const knownReport = evaluateAestheticDesign(knownContext);
  const knownSofaId = knownContext.items.find((entry) => entry.semanticRole === "PRIMARY_SEATING")?.itemId;
  const sofaKnown = knownReport.items.find((item) => item.itemId === knownSofaId);
  assert.ok(sofaKnown);
  assert.equal(sofaKnown.visualWeight, "HEAVY");
  assert.equal(sofaKnown.visualWeightEvidence, null);
  assert.equal(aestheticEvaluationReportSchema.safeParse(knownReport).success, true);
});

test("integration is deterministic, permutation-invariant, immutable, JSON-safe, and canonically ordered", () => {
  const { context } = makeContext();
  const snapshot = structuredClone(context);
  const first = evaluateAestheticDesign(context);
  const second = evaluateAestheticDesign(context);
  assert.deepEqual(second, first);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.deepEqual(context, snapshot);
  const permuted = aestheticDesignContextSchema.parse({ ...context, items: [...context.items].reverse() });
  assert.deepEqual(evaluateAestheticDesign(permuted), first);
  assert.deepEqual(first.coverage.map((entry) => entry.dimension), aestheticDimensions);
  assert.equal(new Set(first.findings.map((finding) => finding.findingId)).size, first.findings.length);
  assert.equal(new Set(first.relationships.map((relationship) => relationship.relationshipId)).size, first.relationships.length);
});