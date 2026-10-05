import assert from "node:assert/strict";
import test from "node:test";

import { createRectangleGeometry } from "@/lib/geometry/templates";
import { resolveLivingRoomComposition } from "@/lib/furniture-planning/role-plan";
import { validateSpatialPlan } from "@/lib/furniture-planning/spatial-validator";
import type { Tables } from "@/types/database.types";
import { aestheticDesignContextSchema, createAestheticDesignContext, type CatalogAestheticMetadata } from "./aesthetic-context";
import { aestheticEvaluationReportSchema } from "./aesthetic-contracts";
import { evaluateCandidateStyleHarmony } from "./style-harmony";
import { evaluateStyleHarmony } from "./style-harmony-evaluation";

const geometry = createRectangleGeometry(800, 500, 250);
const composition = resolveLivingRoomComposition({ geometry, mustHaveItems: ["sofa", "chair"], roomFunctions: [] });
const project = { id: "style-harmony-project", room_type: "living_room" as const };
type Preferences = Pick<Tables<"room_preferences">,
  "primary_style" | "secondary_style" | "color_mood" | "primary_color" | "secondary_color" | "accent_color" | "metal_color"
  | "preferred_materials" | "avoid_materials" | "room_functions" | "must_have_items" | "nice_to_have_items"
  | "household_size" | "special_requirements" | "additional_notes" | "priority">;

function preferences(primary: string | null, secondary: string | null = null): Preferences {
  return {
    primary_style: primary, secondary_style: secondary, color_mood: null,
    primary_color: null, secondary_color: null, accent_color: null, metal_color: null,
    preferred_materials: [], avoid_materials: [], room_functions: [], must_have_items: [], nice_to_have_items: [],
    household_size: null, special_requirements: [], additional_notes: null, priority: null,
  };
}

function catalog(style: string | null, itemId: string): CatalogAestheticMetadata {
  return {
    productId: `catalog-${itemId}`, variantId: `variant-${itemId}`, normalizedStyle: style,
    normalizedColor: "cream", normalizedMaterial: "linen", seatingCapacity: null,
    widthCm: 200, depthCm: 90, heightCm: 80,
  };
}

function roleItemId(role: string) {
  const item = composition.plan.items.find((candidate) => candidate.semanticPlacement.role === role);
  assert.ok(item);
  return item.id;
}

function makeContext(options: {
  primaryStyle?: string | null;
  secondaryStyle?: string | null;
  stylesByItemId?: Readonly<Record<string, string | null>>;
  noPreferences?: boolean;
  reverseItems?: boolean;
} = {}) {
  const plan = options.reverseItems ? { ...composition.plan, items: [...composition.plan.items].reverse() } : composition.plan;
  const spatialReport = validateSpatialPlan(plan, geometry, [], composition.zones);
  const itemMetadataByPlanId = Object.fromEntries(plan.items.map((item) => {
    const style = options.stylesByItemId && Object.prototype.hasOwnProperty.call(options.stylesByItemId, item.id)
      ? options.stylesByItemId[item.id] : "modern";
    return [item.id, { catalog: catalog(style, item.id) }];
  }));
  return createAestheticDesignContext({
    designId: "style-harmony-design", project,
    preferences: options.noPreferences ? null : preferences(options.primaryStyle ?? null, options.secondaryStyle ?? null),
    plan, geometry, openings: [], zones: composition.zones, groups: [composition.group], spatialReport, itemMetadataByPlanId,
  });
}

function findingFor(report: ReturnType<typeof evaluateStyleHarmony>, itemId: string) {
  return report.findings.find((finding) => finding.findingId === `style.preference:${itemId}`);
}

test("exact primary style match is adapted as a positive B.1 finding", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const report = evaluateStyleHarmony(makeContext({ primaryStyle: "Modern", stylesByItemId: { [sofaId]: "modern" } }));
  const finding = findingFor(report, sofaId);
  assert.ok(finding);
  assert.equal(finding.compatibility, "compatible");
  assert.equal(finding.impact, "POSITIVE");
  assert.equal(finding.priority, "P3");
  assert.ok(report.strengths.includes(finding.findingId));
  assert.deepEqual(report.issues, []);
  const observation = finding.supportingEvidence[0].observation;
  assert.equal(observation.kind, "item_style_harmony");
  if (observation.kind === "item_style_harmony") {
    assert.deepEqual(observation.styleCode, "modern");
    assert.equal(observation.styleSource, "catalog");
    assert.equal(observation.matchedPreferenceRole, "primary");
    assert.equal(observation.alignment, "MATCHES_PRIMARY");
    assert.deepEqual(observation.reasons, ["candidate_matches_primary_style"]);
  }
  assert.equal(aestheticEvaluationReportSchema.safeParse(report).success, true);
});

test("exact secondary style match keeps the secondary preference role", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const report = evaluateStyleHarmony(makeContext({ primaryStyle: "Modern", secondaryStyle: "Scandinavian", stylesByItemId: { [sofaId]: "scandinavian" } }));
  const finding = findingFor(report, sofaId);
  assert.ok(finding);
  const observation = finding.supportingEvidence[0].observation;
  assert.equal(observation.kind, "item_style_harmony");
  if (observation.kind === "item_style_harmony") {
    assert.equal(observation.matchedPreferenceRole, "secondary");
    assert.equal(observation.alignment, "MATCHES_SECONDARY");
    assert.deepEqual(observation.stylePreferences, [
      { role: "primary", styleCode: "modern" },
      { role: "secondary", styleCode: "scandinavian" },
    ]);
  }
});

test("existing primary and secondary adjacency rules become supported coordination findings", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const primaryAdjacent = evaluateStyleHarmony(makeContext({ primaryStyle: "Modern", stylesByItemId: { [sofaId]: "warm_modern" } }));
  const primaryFinding = findingFor(primaryAdjacent, sofaId);
  assert.ok(primaryFinding);
  if (primaryFinding.supportingEvidence[0].observation.kind === "item_style_harmony") {
    assert.equal(primaryFinding.supportingEvidence[0].observation.alignment, "ADJACENT_TO_PRIMARY");
    assert.equal(primaryFinding.supportingEvidence[0].observation.compatibility, "compatible");
  }
  const secondaryAdjacent = evaluateStyleHarmony(makeContext({ primaryStyle: "Traditional", secondaryStyle: "Scandinavian", stylesByItemId: { [sofaId]: "japandi" } }));
  const secondaryFinding = findingFor(secondaryAdjacent, sofaId);
  assert.ok(secondaryFinding);
  if (secondaryFinding.supportingEvidence[0].observation.kind === "item_style_harmony") {
    assert.equal(secondaryFinding.supportingEvidence[0].observation.alignment, "ADJACENT_TO_SECONDARY");
    assert.equal(secondaryFinding.supportingEvidence[0].observation.matchedPreferenceRole, "secondary");
  }
});

test("valid but unaligned styles remain mixed and neutral rather than conflicting", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const report = evaluateStyleHarmony(makeContext({ primaryStyle: "Traditional", stylesByItemId: { [sofaId]: "industrial" } }));
  const finding = findingFor(report, sofaId);
  assert.ok(finding);
  assert.equal(finding.compatibility, "mixed");
  assert.equal(finding.coverage.status, "EVALUATED");
  assert.equal(finding.impact, "NEUTRAL");
  assert.deepEqual(report.issues, []);
  assert.deepEqual(report.strengths, []);
  if (finding.supportingEvidence[0].observation.kind === "item_style_harmony") {
    assert.equal(finding.supportingEvidence[0].observation.alignment, "VALID_BUT_NOT_ALIGNED");
  }
});

test("missing and unrecognized item style remain unknown with insufficient evidence", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  for (const [style, reason] of [[null, "candidate_style_missing"], ["future_unlisted_style", "candidate_style_unknown"]] as const) {
    const report = evaluateStyleHarmony(makeContext({ primaryStyle: "Modern", stylesByItemId: { [sofaId]: style } }));
    const finding = findingFor(report, sofaId);
    assert.ok(finding);
    assert.equal(finding.compatibility, "unknown");
    assert.equal(finding.coverage.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(finding.impact, "NEUTRAL");
    if (finding.supportingEvidence[0].observation.kind === "item_style_harmony") {
      assert.deepEqual(finding.supportingEvidence[0].observation.reasons, [reason]);
      assert.equal(finding.supportingEvidence[0].observation.alignment, "UNKNOWN");
    }
  }
});

test("unsupported customer style preference remains unknown rather than mixed", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const unsupportedPreferenceReport = evaluateStyleHarmony(makeContext({ primaryStyle: "designer signature", stylesByItemId: { [sofaId]: "modern" } }));
  const unsupportedFinding = findingFor(unsupportedPreferenceReport, sofaId);
  assert.ok(unsupportedFinding);
  assert.equal(unsupportedFinding.compatibility, "unknown");
  const unsupported = createAestheticDesignContext({
    designId: "unsupported-style-intent", project,
    preferences: {
      primary_style: "designer signature", secondary_style: null, color_mood: null,
      primary_color: null, secondary_color: null, accent_color: null, metal_color: null,
      preferred_materials: [], avoid_materials: [], room_functions: [], must_have_items: [], nice_to_have_items: [],
      household_size: null, special_requirements: [], additional_notes: null, priority: null,
    },
    plan: composition.plan, geometry, openings: [], zones: composition.zones, groups: [composition.group],
    spatialReport: validateSpatialPlan(composition.plan, geometry, [], composition.zones),
    itemMetadataByPlanId: { [sofaId]: { catalog: catalog("modern", sofaId) } },
  });
  const unsupportedReport = evaluateStyleHarmony(unsupported);
  assert.equal(findingFor(unsupportedReport, sofaId)?.compatibility, "unknown");
  const observation = findingFor(unsupportedReport, sofaId)?.supportingEvidence[0].observation;
  if (observation?.kind === "item_style_harmony") assert.deepEqual(observation.reasons, ["design_style_intent_missing"]);
});

test("missing style preferences are NOT_APPLICABLE rather than fabricated misalignment", () => {
  const report = evaluateStyleHarmony(makeContext({ primaryStyle: null, secondaryStyle: null }));
  assert.deepEqual(report.findings, []);
  assert.equal(report.coverage.find((entry) => entry.dimension === "style_harmony")?.status, "NOT_APPLICABLE");
});

test("style findings are item-to-customer intent only and create no pair relationships", () => {
  const report = evaluateStyleHarmony(makeContext({ primaryStyle: "Modern", secondaryStyle: "Scandinavian" }));
  assert.ok(report.findings.length > 0);
  assert.ok(report.findings.every((finding) => finding.target.kind === "dimension" && finding.target.dimension === "style_harmony"));
  assert.deepEqual(report.relationships, []);
  assert.ok(report.findings.every((finding) => finding.recommendationCategory === null));
});

test("color/material metadata and spatial status do not reinterpret style results", () => {
  const base = makeContext({ primaryStyle: "Modern", stylesByItemId: Object.fromEntries(composition.plan.items.map((item) => [item.id, "warm_modern"])) });
  const changed = aestheticDesignContextSchema.parse({
    ...base,
    spatialValidation: { ...base.spatialValidation, status: "INVALID", valid: false },
    items: base.items.map((item) => ({ ...item, metadata: {
      ...item.metadata,
      color: { status: "KNOWN", value: { value: "blue", family: "blue" }, source: "catalog" },
      materials: { status: "KNOWN", values: [{ value: "oak", family: "wood" }], source: "catalog" },
    } })),
  });
  const baseReport = evaluateStyleHarmony(base);
  const changedReport = evaluateStyleHarmony(changed);
  assert.deepEqual(changedReport.findings, baseReport.findings);
  assert.equal(changedReport.spatialStatus.status, "INVALID");
});

test("unrelated names and product identifiers do not replace normalized style evidence", () => {
  const base = makeContext({ primaryStyle: "Modern", stylesByItemId: { [roleItemId("PRIMARY_SEATING")]: null } });
  const noisy = aestheticDesignContextSchema.parse({
    ...base,
    items: base.items.map((item) => ({ ...item, catalogReference: { productId: "luxury-scandinavian-product", variantId: "warm-modern-variant" } })),
  });
  assert.deepEqual(evaluateStyleHarmony(noisy), evaluateStyleHarmony(base));
});

test("style report is deterministic, permutation-invariant, immutable, and JSON-safe", () => {
  const base = makeContext({ primaryStyle: "Modern", secondaryStyle: "Scandinavian" });
  const permuted = aestheticDesignContextSchema.parse({ ...base, items: [...base.items].reverse(), groups: [...base.groups].reverse() });
  const snapshot = structuredClone(permuted);
  const report = evaluateStyleHarmony(permuted);
  assert.deepEqual(evaluateStyleHarmony(permuted), report);
  assert.deepEqual(evaluateStyleHarmony(base), report);
  assert.deepEqual(permuted, snapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  assert.equal(aestheticEvaluationReportSchema.safeParse(report).success, true);
  assert.deepEqual(report.findings.map((finding) => finding.findingId), [...report.findings.map((finding) => finding.findingId)].sort());
});

test("style findings preserve source evaluator results without thresholds or scores", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const context = makeContext({ primaryStyle: "Modern", stylesByItemId: { [sofaId]: "warm_modern" } });
  const source = evaluateCandidateStyleHarmony(context.preferences!.intent, { normalizedStyle: "warm_modern" });
  const finding = findingFor(evaluateStyleHarmony(context), sofaId);
  assert.ok(finding);
  assert.equal(finding.compatibility, source.compatibility);
  assert.deepEqual(finding.supportingEvidence[0].observation.kind === "item_style_harmony" ? finding.supportingEvidence[0].observation.reasons : [], source.reasons);
  assert.equal("score" in finding, false);
});
