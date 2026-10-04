import assert from "node:assert/strict";
import test from "node:test";

import { createRectangleGeometry } from "@/lib/geometry/templates";
import type { RoomOpening } from "@/lib/geometry/types";
import { createAestheticDesignContext } from "./aesthetic-context";
import { aestheticDimensions, aestheticFindingSchema, aestheticItemSchema, aestheticEvaluationReportSchema } from "./aesthetic-contracts";
import { buildAestheticEvaluationReport, canonicalizeAestheticFindings } from "./aesthetic-report";
import { resolveLivingRoomComposition } from "@/lib/furniture-planning/role-plan";
import { validateSpatialPlan } from "@/lib/furniture-planning/spatial-validator";

const geometry = createRectangleGeometry(800, 500, 250);
const openings: RoomOpening[] = [{ id: "entry", openingType: "door", wallSegmentId: "wall-1", offsetCm: 650, widthCm: 100,
  heightCm: 210, sillHeightCm: null, hingeSide: "left", swingDirection: "inward" }];
const composition = resolveLivingRoomComposition({ geometry, mustHaveItems: ["sofa", "chair", "chair"], roomFunctions: ["relaxation"] }, openings);
const preferences = {
  primary_style: "Modern", secondary_style: "Warm Modern", color_mood: "warm and layered",
  primary_color: "cream", secondary_color: "sage", accent_color: "blue", metal_color: null,
  preferred_materials: ["linen", "oak"], avoid_materials: ["plastic"], room_functions: ["relaxation", "reading"],
  must_have_items: ["sofa", "reading chair"], nice_to_have_items: ["side table"], household_size: "2 adults",
  special_requirements: ["keep the entry clear"], additional_notes: "Prefer natural finishes.", priority: "comfort",
};
const project = { id: "project-1", room_type: "living_room" as const };
const catalog = {
  productId: "catalog-sofa", variantId: "catalog-sofa-variant", normalizedStyle: "modern", normalizedColor: "sage",
  normalizedMaterial: "linen", seatingCapacity: 3, widthCm: 220, depthCm: 90, heightCm: 80,
};

function makeContext(plan = composition.plan, report = validateSpatialPlan(plan, geometry, openings, composition.zones), prefs: typeof preferences | null = preferences, attachCatalog = true) {
  const itemMetadataByPlanId = attachCatalog ? { [plan.items[0].id]: { catalog } } : undefined;
  return createAestheticDesignContext({
    designId: "design-1", project, preferences: prefs, plan, geometry, openings, zones: composition.zones,
    groups: [composition.group], spatialReport: report, itemMetadataByPlanId,
  });
}

function finding(impact: "POSITIVE" | "MINOR_ISSUE" | "MAJOR_ISSUE", priority: "P2" | "P3", id: string, ruleId: string) {
  return aestheticFindingSchema.parse({
    findingId: id, code: `sofa.${ruleId}`, target: { kind: "dimension", dimension: "scale_proportion" },
    subjects: [{ kind: "ITEM", id: composition.plan.items[0].id }], itemIds: [composition.plan.items[0].id],
    compatibility: impact === "POSITIVE" ? "compatible" : "mixed", priority, impact,
    explanation: `Deterministic fixture finding: ${id}.`, evaluator: { evaluatorId: "fixture", ruleId, version: "1.0" },
    coverage: { status: "EVALUATED" }, evidenceCompleteness: "complete",
    supportingEvidence: [{ evidenceId: `${id}-evidence`, source: "measured_dimensions", dimension: "scale_proportion",
      itemIds: [composition.plan.items[0].id], description: "The measured item width is within the supplied role range.",
      observation: { kind: "measurement", attribute: "SCALE", subjectId: composition.plan.items[0].id,
        actualValue: 220, unit: "cm", expectedRange: { minimum: 200, maximum: 240 } } }],
    missingInformation: [], recommendationCategory: impact === "POSITIVE" ? "KEEP" : "REVIEW",
  });
}

test("context adapter preserves E.10-A plan, geometry, opening, zone, group, roles and spatial validity", () => {
  const context = makeContext();
  assert.equal(context.planReference.schemaVersion, composition.plan.schemaVersion);
  assert.deepEqual(context.planReference.itemIds, composition.plan.items.map((item) => item.id).sort());
  assert.deepEqual(context.items.map((item) => item.itemId), [...composition.plan.items.map((item) => item.id)].sort());
  assert.ok(context.items.every((item) => item.semanticRole !== null));
  assert.deepEqual(context.geometry, geometry);
  assert.deepEqual(context.openings, openings);
  assert.equal(context.groups[0].primaryAnchorItemId, composition.group.primaryAnchorItemId);
  assert.equal(context.groups[0].zoneId, composition.group.zoneId);
  const style = context.items.find((item) => item.itemId === composition.plan.items[0].id)?.metadata.style;
  assert.deepEqual(style, { status: "KNOWN", value: "modern", source: "catalog" });
  assert.equal(context.preferences?.intent.primaryStyle, "modern");
  assert.equal(context.preferences?.secondaryStyle.status, "KNOWN");
  if (context.preferences?.secondaryStyle.status === "KNOWN") assert.equal(context.preferences.secondaryStyle.value, "warm_modern");
  assert.deepEqual(context.preferences?.functionalRequirements.roomFunctions, ["reading", "relaxation"]);
  assert.deepEqual(context.preferences?.functionalRequirements.mustHaveItems, ["reading chair", "sofa"]);
  assert.equal(context.preferences?.priority, "comfort");
  assert.equal(context.preferences?.additionalNotes, "Prefer natural finishes.");
  assert.equal(context.spatialValidation.status, validateSpatialPlan(composition.plan, geometry, openings, composition.zones).status);
});

test("missing or unrecognized appearance remains unknown and coverage stays explicit", () => {
  const context = makeContext(composition.plan, validateSpatialPlan(composition.plan, geometry, openings, composition.zones), null, false);
  assert.equal(context.preferences, null);
  assert.equal(context.preferenceAvailability, "NOT_SUPPLIED");
  assert.ok(context.items.every((item) => item.metadata.style.status === "UNKNOWN"));
  assert.ok(context.items.every((item) => item.metadata.color.status === "UNKNOWN"));
  assert.ok(context.items.every((item) => item.catalogReference === null));
  assert.equal(context.metadataCoverage.find((entry) => entry.dimension === "style_harmony")?.status, "UNAVAILABLE");
  assert.equal(context.metadataCoverage.length, aestheticDimensions.length);
  const invalidStyleContext = createAestheticDesignContext({
    project, preferences: { ...preferences, primary_style: "designer signature" }, plan: composition.plan, geometry,
    openings, zones: composition.zones, groups: [composition.group],
    spatialReport: validateSpatialPlan(composition.plan, geometry, openings, composition.zones),
    itemMetadataByPlanId: { [composition.plan.items[0].id]: { catalog: { ...catalog, normalizedStyle: "unlisted designer style" } } },
  });
  assert.deepEqual(invalidStyleContext.preferences?.primaryStyle, { status: "UNKNOWN", raw: "designer signature", reason: "UNRECOGNIZED_VALUE" });
  assert.deepEqual(invalidStyleContext.items.find((item) => item.itemId === composition.plan.items[0].id)?.metadata.style,
    { status: "UNKNOWN", reason: "UNRECOGNIZED_VALUE" });
});

test("spatial invalidity and incomplete validation pass through without aesthetic reinterpretation", () => {
  const invalidPlan = structuredClone(composition.plan);
  invalidPlan.items[0].placement.approximatePosition = { xCm: 5000, yCm: 5000 };
  const invalidReport = validateSpatialPlan(invalidPlan, geometry, openings, composition.zones);
  assert.equal(invalidReport.status, "INVALID");
  const invalidContext = makeContext(invalidPlan, invalidReport);
  assert.deepEqual(invalidContext.spatialValidation, {
    status: invalidReport.status, valid: invalidReport.valid, physicallyValid: invalidReport.physicallyValid,
    functionallyValid: invalidReport.functionallyValid, violationIds: invalidReport.violations.map((entry) => entry.id).sort(),
    violatingItemIds: [...new Set(invalidReport.violations.flatMap((entry) => entry.itemIds))].sort(),
    circulationStatus: invalidReport.circulation.status,
  });
  const partialReport = { ...invalidReport, status: "NOT_FULLY_EVALUATED" as const };
  assert.equal(makeContext(invalidPlan, partialReport).spatialValidation.status, "NOT_FULLY_EVALUATED");
});

test("context construction is canonical, JSON-safe and does not mutate E.10-A inputs", () => {
  const snapshot = structuredClone({ geometry, openings, zones: composition.zones, groups: [composition.group], plan: composition.plan, preferences });
  const first = makeContext();
  const reversed = createAestheticDesignContext({
    designId: "design-1", project, preferences: { ...preferences, preferred_materials: [...preferences.preferred_materials].reverse() },
    plan: { ...composition.plan, items: [...composition.plan.items].reverse() }, geometry,
    openings: [...openings].reverse(), zones: [...composition.zones].reverse(), groups: [composition.group],
    spatialReport: validateSpatialPlan(composition.plan, geometry, openings, composition.zones),
    itemMetadataByPlanId: { [composition.plan.items[0].id]: { catalog } },
  });
  assert.deepEqual(reversed, first);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.deepEqual({ geometry, openings, zones: composition.zones, groups: [composition.group], plan: composition.plan, preferences }, snapshot);
});

test("report assembly preserves spatial authority and partitions deterministically ordered strengths/issues", () => {
  const context = makeContext();
  const findings = [
    finding("POSITIVE", "P2", "strength-p2", "style"),
    finding("MINOR_ISSUE", "P3", "issue-p3", "balance"),
    finding("MAJOR_ISSUE", "P2", "issue-p2", "scale"),
  ];
  const report = buildAestheticEvaluationReport({
    context,
    items: context.items.map((item) => aestheticItemSchema.parse({ itemId: item.itemId })),
    relationships: [], findings,
    coverage: [{ dimension: "scale_proportion", status: "EVALUATED", itemIds: [composition.plan.items[0].id], reason: null }],
    diagnostics: [{ code: "context.partial", description: "Some dimensions have no evaluator.", itemIds: [] }],
  });
  assert.deepEqual(report.findings.map((entry) => entry.findingId), ["issue-p2", "strength-p2", "issue-p3"]);
  assert.deepEqual(report.issues, ["issue-p2", "issue-p3"]);
  assert.deepEqual(report.strengths, ["strength-p2"]);
  assert.deepEqual(report.evaluatedItemIds, [composition.plan.items[0].id]);
  assert.equal(report.status, "PARTIALLY_EVALUATED");
  assert.deepEqual(report.spatialStatus, {
    status: context.spatialValidation.status, valid: context.spatialValidation.valid,
    physicallyValid: context.spatialValidation.physicallyValid, functionallyValid: context.spatialValidation.functionallyValid,
    circulationStatus: context.spatialValidation.circulationStatus,
  });
  assert.equal("score" in report, false);
  assert.equal(aestheticEvaluationReportSchema.safeParse(report).success, true);
  assert.deepEqual(canonicalizeAestheticFindings([...findings].reverse()), report.findings);
  assert.equal(aestheticEvaluationReportSchema.safeParse({ ...report, findings: [...report.findings].reverse() }).success, false);
  const fullyEvaluated = buildAestheticEvaluationReport({
    context, items: context.items.map((item) => aestheticItemSchema.parse({ itemId: item.itemId })), relationships: [], findings: [],
    coverage: aestheticDimensions.map((dimension) => dimension === "scale_proportion"
      ? { dimension, status: "EVALUATED" as const, itemIds: [composition.plan.items[0].id], reason: null }
      : { dimension, status: "NOT_APPLICABLE" as const, itemIds: [], reason: null }),
  });
  assert.equal(fullyEvaluated.status, "EVALUATED");
  const notApplicable = buildAestheticEvaluationReport({
    context, items: context.items.map((item) => aestheticItemSchema.parse({ itemId: item.itemId })), relationships: [], findings: [],
    coverage: aestheticDimensions.map((dimension) => ({ dimension, status: "NOT_APPLICABLE", itemIds: [], reason: null })),
  });
  assert.equal(notApplicable.status, "NOT_EVALUATED");
});
