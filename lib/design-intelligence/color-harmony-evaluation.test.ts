import assert from "node:assert/strict";
import test from "node:test";

import { createRectangleGeometry } from "@/lib/geometry/templates";
import { resolveLivingRoomComposition } from "@/lib/furniture-planning/role-plan";
import { validateSpatialPlan } from "@/lib/furniture-planning/spatial-validator";
import type { Tables } from "@/types/database.types";
import { aestheticDesignContextSchema, createAestheticDesignContext, type CatalogAestheticMetadata, type DesignObjectAestheticMetadata } from "./aesthetic-context";
import { aestheticEvaluationReportSchema } from "./aesthetic-contracts";
import { evaluateColorHarmony } from "./color-harmony-evaluation";

const geometry = createRectangleGeometry(800, 500, 250);
const composition = resolveLivingRoomComposition({ geometry, mustHaveItems: ["sofa", "chair", "chair"], roomFunctions: [] });
const project = { id: "color-eval-project", room_type: "living_room" as const };
type Preferences = Pick<Tables<"room_preferences">,
  "primary_style" | "secondary_style" | "color_mood" | "primary_color" | "secondary_color" | "accent_color" | "metal_color"
  | "preferred_materials" | "avoid_materials" | "room_functions" | "must_have_items" | "nice_to_have_items"
  | "household_size" | "special_requirements" | "additional_notes" | "priority">;

function preferences(colors: { primary_color: string | null; secondary_color?: string | null; accent_color?: string | null; metal_color?: string | null }): Preferences {
  return {
    primary_style: null, secondary_style: null, color_mood: null,
    primary_color: colors.primary_color, secondary_color: colors.secondary_color ?? null,
    accent_color: colors.accent_color ?? null, metal_color: colors.metal_color ?? null,
    preferred_materials: [], avoid_materials: [], room_functions: [], must_have_items: [], nice_to_have_items: [],
    household_size: null, special_requirements: [], additional_notes: null, priority: null,
  };
}

function catalog(normalizedColor: string | null, overrides: Partial<CatalogAestheticMetadata> = {}): CatalogAestheticMetadata {
  return {
    productId: "catalog-product", variantId: "catalog-variant", normalizedStyle: "modern", normalizedColor,
    normalizedMaterial: "linen", seatingCapacity: null, widthCm: 220, depthCm: 90, heightCm: 80,
    ...overrides,
  };
}

function makeContext(options: {
  colorsByPlanId?: Readonly<Record<string, string | null>>;
  preference?: Preferences | null;
  includeGroup?: boolean;
  includeCatalog?: boolean;
  designObjectByPlanId?: Readonly<Record<string, DesignObjectAestheticMetadata>>;
  reverseItems?: boolean;
} = {}) {
  const plan = options.reverseItems ? { ...composition.plan, items: [...composition.plan.items].reverse() } : composition.plan;
  const spatialReport = validateSpatialPlan(plan, geometry, [], composition.zones);
  const colors = options.colorsByPlanId ?? Object.fromEntries(plan.items.map((item) => [item.id, "cream"]));
  const itemMetadataByPlanId = Object.fromEntries(plan.items.map((item) => [item.id, {
    ...(options.includeCatalog === false ? {} : { catalog: catalog(colors[item.id] ?? null) }),
    ...(options.designObjectByPlanId?.[item.id] ? { designObject: options.designObjectByPlanId[item.id] } : {}),
  }]));
  return createAestheticDesignContext({
    designId: "color-eval-design", project, preferences: options.preference ?? null, plan, geometry,
    openings: [], zones: composition.zones,
    groups: options.includeGroup === false ? [] : [composition.group],
    spatialReport,
    itemMetadataByPlanId,
  });
}

test("primary palette exact match emits a positive IDENTICAL finding without sameness scoring", () => {
  const context = makeContext({ preference: preferences({ primary_color: "cream" }) });
  const sofaId = composition.plan.items.find((item) => item.semanticPlacement.role === "PRIMARY_SEATING")?.id;
  assert.ok(sofaId);
  const report = evaluateColorHarmony(context);
  const finding = report.findings.find((entry) => entry.findingId === `color.palette:${sofaId}`);
  assert.ok(finding);
  assert.equal(finding.compatibility, "compatible");
  assert.equal(finding.impact, "POSITIVE");
  assert.ok(report.strengths.includes(finding.findingId));
  assert.equal(report.issues.length, 0);
  assert.equal(finding.supportingEvidence[0].observation.kind, "item_color_harmony");
  if (finding.supportingEvidence[0].observation.kind === "item_color_harmony") {
    assert.equal(finding.supportingEvidence[0].observation.relationship, "IDENTICAL");
    assert.equal(finding.supportingEvidence[0].observation.matchedPaletteRole, "primary");
    assert.equal(finding.supportingEvidence[0].observation.paletteColors.length, 1);
  }
  assert.equal(aestheticEvaluationReportSchema.safeParse(report).success, true);
});

test("same-family palette color is SIMILAR and harmonized palette color is COORDINATED", () => {
  const sameFamily = evaluateColorHarmony(makeContext({
    preference: preferences({ primary_color: "warm_taupe" }),
    colorsByPlanId: Object.fromEntries(composition.plan.items.map((item) => [item.id, "beige"])),
    includeGroup: false,
  }));
  assert.equal(sameFamily.findings[0].supportingEvidence[0].observation.kind, "item_color_harmony");
  if (sameFamily.findings[0].supportingEvidence[0].observation.kind === "item_color_harmony") {
    assert.equal(sameFamily.findings[0].supportingEvidence[0].observation.relationship, "SIMILAR");
  }
  const coordinated = evaluateColorHarmony(makeContext({
    preference: preferences({ primary_color: "cream" }),
    colorsByPlanId: Object.fromEntries(composition.plan.items.map((item) => [item.id, "tan"])),
    includeGroup: false,
  }));
  if (coordinated.findings[0].supportingEvidence[0].observation.kind === "item_color_harmony") {
    assert.equal(coordinated.findings[0].supportingEvidence[0].observation.relationship, "COORDINATED");
  } else assert.fail("expected item palette observation");
});

test("valid but unaligned customer-palette color is neutral, not an intrinsic conflict", () => {
  const report = evaluateColorHarmony(makeContext({
    preference: preferences({ primary_color: "cream" }),
    colorsByPlanId: Object.fromEntries(composition.plan.items.map((item) => [item.id, "purple"])),
    includeGroup: false,
  }));
  const finding = report.findings[0];
  assert.equal(finding.compatibility, "mixed");
  assert.equal(finding.impact, "NEUTRAL");
  assert.equal(finding.code, "color.palette.valid_but_not_aligned");
  assert.deepEqual(report.issues, []);
  if (finding.supportingEvidence[0].observation.kind === "item_color_harmony") {
    assert.equal(finding.supportingEvidence[0].observation.relationship, "UNKNOWN");
  }
});

test("explicit E.10-A group sofa/rug same-color pair emits one positive IDENTICAL relation", () => {
  const context = makeContext();
  const report = evaluateColorHarmony(context);
  const pairFindings = report.findings.filter((finding) => finding.target.kind === "relationship");
  const sofaId = composition.plan.items.find((item) => item.semanticPlacement.role === "PRIMARY_SEATING")?.id;
  const rugId = composition.plan.items.find((item) => item.semanticPlacement.role === "AREA_RUG")?.id;
  assert.ok(sofaId && rugId);
  assert.equal(pairFindings.length, 4);
  const sofaRug = pairFindings.find((finding) => finding.itemIds.includes(sofaId) && finding.itemIds.includes(rugId));
  assert.ok(sofaRug);
  assert.equal(sofaRug.code, "color.pair.coordinated");
  assert.equal(sofaRug.impact, "POSITIVE");
  assert.ok(report.strengths.includes(sofaRug.findingId));
  assert.equal(sofaRug.target.kind, "relationship");
  if (sofaRug.supportingEvidence[0].observation.kind === "pair_color_harmony") {
    assert.equal(sofaRug.supportingEvidence[0].observation.relationship, "IDENTICAL");
    assert.deepEqual(sofaRug.supportingEvidence[0].observation.relationshipSources, [{ kind: "E10A_GROUP", groupId: "primary-seating-group" }]);
  } else assert.fail("expected pair color observation");
  assert.equal(aestheticEvaluationReportSchema.safeParse(report).success, true);
});

test("explicit GROUPED_WITH semantic relationship is sufficient pair evidence without an E.10-A group", () => {
  const base = makeContext({ includeGroup: false, preference: null });
  const sofaId = composition.plan.items.find((item) => item.semanticPlacement.role === "PRIMARY_SEATING")?.id;
  const rugId = composition.plan.items.find((item) => item.semanticPlacement.role === "AREA_RUG")?.id;
  assert.ok(sofaId && rugId);
  const context = aestheticDesignContextSchema.parse({
    ...base,
    items: base.items.map((item) => item.itemId === sofaId
      ? { ...item, placement: { ...item.placement, relationships: [...item.placement.relationships, { type: "GROUPED_WITH", targetItemId: rugId }] } }
      : item),
  });
  const report = evaluateColorHarmony(context);
  const pair = report.findings.find((finding) => finding.target.kind === "relationship" && finding.itemIds.includes(sofaId) && finding.itemIds.includes(rugId));
  assert.ok(pair);
  assert.equal(pair.impact, "POSITIVE");
  if (pair.supportingEvidence[0].observation.kind === "pair_color_harmony") {
    assert.deepEqual(pair.supportingEvidence[0].observation.relationshipSources, [{ kind: "SEMANTIC_RELATIONSHIP", relationshipType: "GROUPED_WITH" }]);
  } else assert.fail("expected pair color observation");
});

test("explicitly related E10 elements with different but harmonious colors remain coordinated", () => {
  const colors = Object.fromEntries(composition.plan.items.map((item) => [item.id, item.semanticPlacement.role === "AREA_RUG" ? "brown" : "cream"]));
  const context = makeContext({ colorsByPlanId: colors });
  const report = evaluateColorHarmony(context);
  const sofaId = composition.plan.items.find((item) => item.semanticPlacement.role === "PRIMARY_SEATING")?.id;
  const rugId = composition.plan.items.find((item) => item.semanticPlacement.role === "AREA_RUG")?.id;
  assert.ok(sofaId && rugId);
  const pair = report.findings.find((finding) => finding.target.kind === "relationship" && finding.itemIds.includes(sofaId) && finding.itemIds.includes(rugId));
  assert.ok(pair);
  assert.equal(pair.compatibility, "compatible");
  assert.equal(pair.impact, "POSITIVE");
  if (pair.supportingEvidence[0].observation.kind === "pair_color_harmony") assert.equal(pair.supportingEvidence[0].observation.relationship, "COORDINATED");
});

test("explicitly related valid but unaligned pair colors are not marked CONFLICTING or added to issues", () => {
  const colors = Object.fromEntries(composition.plan.items.map((item) => [item.id, item.semanticPlacement.role === "AREA_RUG" ? "orange" : "blue"]));
  const report = evaluateColorHarmony(makeContext({ colorsByPlanId: colors, preference: preferences({ primary_color: "cream" }) }));
  const sofaId = composition.plan.items.find((item) => item.semanticPlacement.role === "PRIMARY_SEATING")?.id;
  const rugId = composition.plan.items.find((item) => item.semanticPlacement.role === "AREA_RUG")?.id;
  assert.ok(sofaId && rugId);
  const pair = report.findings.find((finding) => finding.target.kind === "relationship" && finding.itemIds.includes(sofaId) && finding.itemIds.includes(rugId));
  assert.ok(pair);
  assert.equal(pair.compatibility, "mixed");
  assert.equal(pair.impact, "NEUTRAL");
  assert.equal(pair.code, "color.pair.valid_but_not_aligned");
  assert.equal(report.issues.includes(pair.findingId), false);
  if (pair.supportingEvidence[0].observation.kind === "pair_color_harmony") assert.equal(pair.supportingEvidence[0].observation.relationship, "UNKNOWN");
});

test("missing item and pair colors produce insufficient evidence, never negative findings", () => {
  const colors = Object.fromEntries(composition.plan.items.map((item) => [item.id, item.semanticPlacement.role === "AREA_RUG" ? null : "cream"]));
  const report = evaluateColorHarmony(makeContext({ colorsByPlanId: colors, preference: preferences({ primary_color: "cream" }) }));
  const rugId = composition.plan.items.find((item) => item.semanticPlacement.role === "AREA_RUG")?.id;
  assert.ok(rugId);
  const rugPaletteFinding = report.findings.find((finding) => finding.findingId === `color.palette:${rugId}`);
  const pairFinding = report.findings.find((finding) => finding.target.kind === "relationship" && finding.itemIds.includes(rugId));
  assert.ok(rugPaletteFinding && pairFinding);
  assert.equal(rugPaletteFinding.coverage.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(pairFinding.coverage.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(rugPaletteFinding.impact, "NEUTRAL");
  assert.equal(pairFinding.impact, "NEUTRAL");
  assert.equal(report.coverage.find((entry) => entry.dimension === "color_harmony")?.status, "INSUFFICIENT_EVIDENCE");
  assert.deepEqual(report.issues, []);
});

test("unassociated items are not paired and no-palette/no-pair contexts are not applicable", () => {
  const context = makeContext({ includeGroup: false, preference: null });
  const report = evaluateColorHarmony(context);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.relationships, []);
  assert.equal(report.coverage.find((entry) => entry.dimension === "color_harmony")?.status, "NOT_APPLICABLE");
});

test("metal palette alone is not treated as a furniture color target", () => {
  const report = evaluateColorHarmony(makeContext({ preference: preferences({ primary_color: null, metal_color: "black" }), includeGroup: false }));
  assert.deepEqual(report.findings, []);
  assert.equal(report.coverage.find((entry) => entry.dimension === "color_harmony")?.status, "NOT_APPLICABLE");
});

test("unrecognized palette text yields insufficient evidence without new normalization", () => {
  const report = evaluateColorHarmony(makeContext({ preference: preferences({ primary_color: "midnight blue" }), includeGroup: false }));
  assert.ok(report.findings.length > 0);
  assert.ok(report.findings.every((finding) => finding.coverage.status === "INSUFFICIENT_EVIDENCE"));
  const observation = report.findings[0].supportingEvidence[0].observation;
  assert.equal(observation.kind, "item_color_harmony");
  if (observation.kind === "item_color_harmony") {
    assert.deepEqual(observation.paletteColors, []);
    assert.equal(observation.compatibility, "unknown");
  }
});

test("catalog normalized color takes precedence over design-object color; design object is fallback only", () => {
  const sofaId = composition.plan.items.find((item) => item.semanticPlacement.role === "PRIMARY_SEATING")?.id;
  assert.ok(sofaId);
  const designObject: DesignObjectAestheticMetadata = {
    id: "design-object-sofa", catalog_product_id: "catalog-product", catalog_product_variant_id: "catalog-variant",
    material: "linen", primary_color: "red", width_cm: 220, depth_cm: 90, height_cm: 80,
  };
  const catalogWins = makeContext({
    includeGroup: false, preference: null,
    colorsByPlanId: Object.fromEntries(composition.plan.items.map((item) => [item.id, item.id === sofaId ? "cream" : null])),
    designObjectByPlanId: { [sofaId]: designObject },
  });
  const catalogSofa = catalogWins.items.find((item) => item.itemId === sofaId);
  assert.ok(catalogSofa);
  assert.deepEqual(catalogSofa.metadata.color, { status: "KNOWN", value: { value: "cream", family: "cream" }, source: "catalog" });

  const designObjectFallback = makeContext({
    includeGroup: false, preference: null,
    colorsByPlanId: Object.fromEntries(composition.plan.items.map((item) => [item.id, item.id === sofaId ? null : null])),
    designObjectByPlanId: { [sofaId]: designObject },
  });
  const fallbackSofa = designObjectFallback.items.find((item) => item.itemId === sofaId);
  assert.ok(fallbackSofa);
  assert.deepEqual(fallbackSofa.metadata.color, { status: "KNOWN", value: { value: "red", family: "red" }, source: "design_object" });
});

test("unrelated spatial failures do not suppress color, while a bad color pair does not change spatial status", () => {
  const baseline = makeContext();
  const coffee = baseline.items.find((item) => item.semanticRole === "COFFEE_TABLE");
  assert.ok(coffee);
  const plan = { ...composition.plan, items: composition.plan.items.map((item) => item.id === coffee.itemId
    ? { ...item, placement: { ...item.placement, approximatePosition: { xCm: 9000, yCm: 9000 } } } : item) };
  const spatialReport = validateSpatialPlan(plan, geometry, [], composition.zones);
  const context = createAestheticDesignContext({
    designId: "color-spatial-isolation", project, preferences: null, plan, geometry, openings: [], zones: composition.zones,
    groups: [composition.group], spatialReport,
    itemMetadataByPlanId: Object.fromEntries(plan.items.map((item) => [item.id, { catalog: catalog(item.semanticPlacement.role === "AREA_RUG" ? "orange" : "blue") }])),
  });
  const report = evaluateColorHarmony(context);
  assert.equal(report.spatialStatus.status, "INVALID");
  assert.equal(report.spatialStatus.valid, spatialReport.valid);
  assert.ok(report.findings.some((finding) => finding.impact === "NEUTRAL"));
});

test("input permutation, repeated evaluation, immutability, JSON roundtrip and B.1 report validation", () => {
  const base = makeContext({ colorsByPlanId: Object.fromEntries(composition.plan.items.map((item) => [item.id, item.semanticPlacement.role === "AREA_RUG" ? "brown" : "cream"])) });
  const context = aestheticDesignContextSchema.parse({
    ...base,
    items: [...base.items].reverse().map((item) => ({ ...item, placement: { ...item.placement, relationships: [...item.placement.relationships].reverse() } })),
    groups: [...base.groups].reverse().map((group) => ({ ...group, itemIds: [...group.itemIds].reverse() })),
  });
  const snapshot = structuredClone(context);
  const first = evaluateColorHarmony(context);
  assert.deepEqual(evaluateColorHarmony(context), first);
  assert.deepEqual(evaluateColorHarmony(aestheticDesignContextSchema.parse({ ...context, items: [...context.items].reverse() })), first);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.deepEqual(context, snapshot);
  assert.equal(aestheticEvaluationReportSchema.safeParse(first).success, true);
  assert.deepEqual(first.spatialStatus, {
    status: context.spatialValidation.status, valid: context.spatialValidation.valid,
    physicallyValid: context.spatialValidation.physicallyValid, functionallyValid: context.spatialValidation.functionallyValid,
    circulationStatus: context.spatialValidation.circulationStatus,
  });
});