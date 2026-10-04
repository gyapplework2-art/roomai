import assert from "node:assert/strict";
import test from "node:test";

import { DESIGN_STYLE_CODES, normalizeDesignStyle } from "./style-harmony";
import { DESIGN_COLOR_FAMILIES, familiesHarmonize } from "./color-harmony";
import { DESIGN_MATERIAL_FAMILIES } from "./material-harmony";
import { normalizeFurnitureAttributes } from "./furniture-attributes";
import { designRoleSchema } from "./schema";
import {
  aestheticStyleCodeSchema, aestheticColorFamilySchema, aestheticMaterialFamilySchema,
  aestheticFurnitureAttributesSchema, aestheticIntentSchema, aestheticItemSchema, aestheticFindingSchema, aestheticHarmonyRelationshipSchema,
  aestheticRelationshipSchema, aestheticEvaluationReportSchema,
} from "./aesthetic-contracts";
import { aestheticDimensions } from "./aesthetic-contracts";

const support = {
  evidenceId: "normalized-style", source: "normalized_attributes", dimension: "style_harmony",
  itemIds: ["sofa", "rug"], description: "The explicit styles belong to coordinated adjacent families.",
  observation: { kind: "attribute_comparison", attribute: "STYLE", subjectIds: ["sofa", "rug"], values: ["modern", "warm_modern"], relationship: "COORDINATED" },
};
const missing = { code: "texture_evidence_missing", dimension: "texture_harmony", itemIds: ["sofa"], description: "Texture evidence is unavailable." };
function finding() {
  return {
    findingId: "sofa-rug-style", code: "sofa_rug.style_harmony", target: { kind: "relationship", relationshipId: "seating-rug", relationshipType: "sofa_rug", dimension: "style_harmony" },
    subjects: [{ kind: "ITEM", id: "sofa" }, { kind: "ITEM", id: "rug" }], itemIds: ["sofa", "rug"], compatibility: "compatible", priority: "P2", impact: "POSITIVE", explanation: "Visual harmony does not require identical styles or colors.",
    evaluator: { evaluatorId: "existing-style-harmony", ruleId: "style-adjacency", version: "1.0" },
    coverage: { status: "EVALUATED" }, evidenceCompleteness: "complete", supportingEvidence: [support], missingInformation: [], recommendationCategory: null,
  };
}
function report(overrides: Record<string, unknown> = {}) {
  const reportOverrides = Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "evaluatedCoverage"));
  const items = (overrides.items as Array<{ itemId: string }> | undefined) ?? [{ itemId: "sofa", styleCode: "modern" }, { itemId: "rug", styleCode: "warm_modern" }];
  const relationships = (overrides.relationships as Array<{ relationshipId: string; type: string; itemIds: string[] }> | undefined)
    ?? [{ relationshipId: "seating-rug", type: "sofa_rug", itemIds: ["sofa", "rug"] }];
  const findings = (overrides.findings as Array<ReturnType<typeof finding>> | undefined) ?? [finding()];
  const evaluatedCoverage = (overrides.evaluatedCoverage as Array<{ dimension: string; itemIds: string[] }> | undefined)
    ?? [{ dimension: "style_harmony", itemIds: ["sofa", "rug"] }];
  const coverage = aestheticDimensions.map((dimension) => {
    const evaluated = evaluatedCoverage.find((entry) => entry.dimension === dimension);
    return evaluated ? { dimension, status: "EVALUATED", itemIds: evaluated.itemIds, reason: null }
      : { dimension, status: "NOT_EVALUATED", itemIds: [], reason: "The evaluator is not implemented." };
  });
  const evaluatedItemIds = [...new Set(coverage.filter((entry) => entry.status === "EVALUATED").flatMap((entry) => entry.itemIds))].sort();
  return { contractVersion: "1.0", intent: null,
    spatialStatus: { status: "VALID", valid: true, physicallyValid: true, functionallyValid: true, circulationStatus: "PASS" },
    items, relationships, coverage, evaluatedItemIds, findings,
    status: evaluatedCoverage.length ? "PARTIALLY_EVALUATED" : "NOT_EVALUATED",
    diagnostics: [], strengths: findings.filter((entry) => entry.impact === "POSITIVE").map((entry) => entry.findingId).sort(),
    issues: findings.filter((entry) => ["MINOR_ISSUE", "MODERATE_ISSUE", "MAJOR_ISSUE"].includes(entry.impact)).map((entry) => entry.findingId).sort(),
    ...reportOverrides,
  };
}

test("existing style, color-family, material-family and normalized attributes are reused", () => {
  assert.deepEqual(aestheticStyleCodeSchema.options, [...DESIGN_STYLE_CODES]);
  assert.deepEqual(aestheticColorFamilySchema.options, [...DESIGN_COLOR_FAMILIES]);
  assert.deepEqual(aestheticMaterialFamilySchema.options, [...DESIGN_MATERIAL_FAMILIES]);
  const attributes = normalizeFurnitureAttributes({ seatingCapacity: 3 }, { normalizedAttributes: { silhouette: "curved", "fabric texture": "velvet", "height profile": "low profile" } });
  assert.deepEqual(aestheticFurnitureAttributesSchema.parse(attributes), attributes);
  assert.deepEqual(aestheticFurnitureAttributesSchema.parse({}), normalizeFurnitureAttributes({ seatingCapacity: null }));
});

test("style/palette and intentional variation declare intent without enforcing matching", () => {
  const intent = aestheticIntentSchema.parse({ roomType: "living_room", primaryStyle: "modern", secondaryStyle: "warm_modern", colorMood: "coordinated variation",
    colors: { primary: "cream", secondary: "sage", accent: "blue", metal: null }, preferredMaterials: ["linen", "wood"], avoidMaterials: [],
    colorTemperature: "warm", heightVariation: "intentional_variation", formVariation: "intentional_variation" });
  assert.equal(intent.heightVariation, "intentional_variation");
  assert.equal(intent.formVariation, "intentional_variation");
  assert.equal(normalizeDesignStyle("Warm Modern"), intent.secondaryStyle);
  assert.ok(familiesHarmonize("green", "blue"));
  assert.equal(aestheticEvaluationReportSchema.safeParse(report()).success, true);
});

test("harmony labels represent coordination choices without a sameness ranking", () => {
  for (const relationship of ["IDENTICAL", "COORDINATED", "COMPLEMENTARY", "INTENTIONAL_CONTRAST", "CONFLICTING"] as const) {
    assert.equal(aestheticHarmonyRelationshipSchema.parse(relationship), relationship);
  }
  assert.equal("score" in finding(), false);
});

test("design and room findings can be represented without inventing item participants", () => {
  const base = finding();
  const subjects = [
    { kind: "DESIGN", id: "design-1" }, { kind: "ROOM", id: "living-room" },
    { kind: "GROUP", id: "seating-group" }, { kind: "ZONE", id: "primary-seating" },
    { kind: "WALL", id: "wall-1" }, { kind: "OPENING", id: "entry" },
  ] as const;
  for (const subject of subjects) {
    assert.equal(aestheticFindingSchema.safeParse({
      ...base, target: { kind: "dimension", dimension: "room_specific_coherence" },
      subjects: [subject], itemIds: [], compatibility: "unknown", priority: "P3", impact: "NEUTRAL",
      coverage: { status: "NOT_EVALUATED", reason: "No evaluator is implemented for this subject." },
      evidenceCompleteness: "missing", supportingEvidence: [],
      missingInformation: [{ code: "subject_evidence_unavailable", dimension: "room_specific_coherence", itemIds: [], description: "Relevant evidence is unavailable." }],
    }).success, true, `${subject.kind} subject`);
  }
  const roomIntent = aestheticFindingSchema.safeParse({
    ...finding(), target: { kind: "dimension", dimension: "room_specific_coherence" },
    subjects: [{ kind: "ROOM", id: "living-room" }], itemIds: [], compatibility: "compatible", impact: "POSITIVE",
    coverage: { status: "EVALUATED" }, evidenceCompleteness: "complete",
    supportingEvidence: [{ ...support, source: "design_intent", dimension: "room_specific_coherence", itemIds: [],
      observation: { kind: "design_intent", preference: "STYLE", values: ["modern"] } }],
    missingInformation: [],
  });
  assert.equal(roomIntent.success, true);
});

test("missing appearance remains unknown and never comes from names or price", () => {
  const parsed = aestheticItemSchema.parse({ itemId: "unknown-piece" });
  assert.equal(parsed.styleCode, null);
  assert.equal(parsed.color, null);
  assert.equal(parsed.colorTemperature, "unknown");
  assert.equal(parsed.visualWeight, "UNKNOWN");
  assert.equal(parsed.materials, null);
  assert.equal(parsed.furnitureAttributes.silhouette, null);
  assert.equal(parsed.measurements.heightCm, null);
  for (const extra of [{ vendorName: "Luxury Modern" }, { productTitle: "Warm Velvet Sofa" }, { price: 2000 }]) {
    assert.equal(aestheticItemSchema.safeParse({ itemId: "unknown-piece", ...extra }).success, false);
  }
});

test("height/scale and furniture or decor roles reuse the existing DesignRole contract", () => {
  const role = designRoleSchema.parse({ roleId: "wall-art", furnitureTypeCode: "artwork", required: false, approximatePosition: null,
    sizeRange: { widthMinCm: 40, widthMaxCm: 80, depthMinCm: 1, depthMaxCm: 5, heightMinCm: 60, heightMaxCm: 120 } });
  const item = aestheticItemSchema.parse({ itemId: "art", role, measurements: { widthCm: 60, heightCm: 80 }, visualWeight: "LIGHT" });
  assert.deepEqual(item.role, role);
  assert.equal(item.measurements.depthCm, null);
  assert.equal(item.measurements.heightCm, 80);
});

for (const invalid of [
  { styleCode: "vendor_designer_style" }, { colorTemperature: "sunset" }, { visualWeight: "expensive" },
  { color: { value: "sage", family: "blue" } }, { materials: [{ value: "linen", family: "wood" }] },
  { furnitureAttributes: { silhouette: "prestigious" } }, { furnitureAttributes: { fabricTexture: "luxury" } },
  { furnitureAttributes: { heightProfile: "towering" } }, { measurements: { heightCm: 0 } }, { measurements: { widthCm: Infinity } },
]) {
  test(`invalid aesthetic vocabulary or evidence is rejected: ${JSON.stringify(invalid)}`, () => {
    assert.equal(aestheticItemSchema.safeParse({ itemId: "piece", ...invalid }).success, false);
  });
}

test("normalized color/material values agree with existing families", () => {
  const item = aestheticItemSchema.parse({ itemId: "piece", color: { value: "sage", family: "green" }, materials: [{ value: "linen", family: "textile" }, { value: "oak", family: "wood" }],
    furnitureAttributes: { silhouette: "curved", fabricTexture: "velvet", heightProfile: "low" }, colorTemperature: "unknown" });
  assert.equal(item.color?.family, "green");
  assert.equal(item.colorTemperature, "unknown");
});

for (const type of ["furniture_coordination", "rug_furniture_harmony", "rug_zoning", "curtain_furniture_coordination", "wall_art_composition", "dining_table_lighting_art_coordination", "bedroom_bedding_curtain_art_plant_coordination", "intentional_height_variation", "intentional_form_variation"]) {
  test(`future ${type} relationship can be declared without implemented evaluation`, () => {
    assert.equal(aestheticRelationshipSchema.safeParse({ relationshipId: `future-${type}`, type, itemIds: ["first", "second"] }).success, true);
    const data = finding();
    assert.equal(aestheticFindingSchema.safeParse({ ...data,
      target: { ...data.target, relationshipType: type }, compatibility: "unknown",
      coverage: { status: "NOT_EVALUATED", reason: "not_implemented" },
    }).success, true);
  });
}

test("existing relationship identifiers remain supported and spatial relationship types are not aesthetic types", () => {
  for (const type of ["sofa_rug", "dining_table_chair", "bed_nightstand", "desk_office_chair"]) {
    assert.equal(aestheticRelationshipSchema.safeParse({ relationshipId: type, type, itemIds: ["first", "second"] }).success, true);
  }
  assert.equal(aestheticRelationshipSchema.safeParse({ relationshipId: "placement", type: "ADJACENT_TO", itemIds: ["first", "second"] }).success, false);
});

test("priority, partial evidence, and compatibility are independent", () => {
  for (const priority of ["P2", "P3"]) {
    for (const compatibility of ["compatible", "mixed", "incompatible", "unknown"]) {
      assert.equal(aestheticFindingSchema.safeParse({ ...finding(), priority, compatibility, evidenceCompleteness: "partial", missingInformation: [missing] }).success, true);
    }
  }
});

test("missing evidence and unevaluated coverage remain explicitly unknown", () => {
  const data = { ...finding(), compatibility: "unknown", coverage: { status: "INSUFFICIENT_EVIDENCE", reason: "Visual observations are not supplied." },
    evidenceCompleteness: "missing", supportingEvidence: [], missingInformation: [missing] };
  assert.equal(aestheticFindingSchema.safeParse(data).success, true);
  assert.equal(aestheticEvaluationReportSchema.safeParse({ ...report(), findings: [data] }).success, true);
});

for (const patch of [
  { coverage: { status: "NOT_EVALUATED", reason: "This evaluator is not implemented." } },
  { compatibility: "mixed", evidenceCompleteness: "missing", supportingEvidence: [], missingInformation: [missing] },
  { supportingEvidence: [] }, { missingInformation: [missing] },
  { evidenceCompleteness: "partial", missingInformation: [] },
  { evidenceCompleteness: "partial", supportingEvidence: [], missingInformation: [missing] },
  { compatibility: "unknown", evidenceCompleteness: "missing", supportingEvidence: [], missingInformation: [] },
  { compatibility: "unknown", evidenceCompleteness: "missing", supportingEvidence: [support], missingInformation: [missing] },
]) {
  test(`contradictory finding state is rejected: ${JSON.stringify(patch)}`, () => {
    assert.equal(aestheticFindingSchema.safeParse({ ...finding(), ...patch }).success, false);
  });
}

test("relationship findings require distinct participants and matching declared references", () => {
  assert.equal(aestheticFindingSchema.safeParse({ ...finding(), itemIds: ["sofa"] }).success, false);
  assert.equal(aestheticFindingSchema.safeParse({ ...finding(), itemIds: ["sofa", "sofa"] }).success, false);
  assert.equal(aestheticRelationshipSchema.safeParse({ relationshipId: "self", type: "furniture_coordination", itemIds: ["sofa", "sofa"] }).success, false);
  const data = report();
  assert.equal(aestheticEvaluationReportSchema.safeParse({ ...data, relationships: [] }).success, false);
  assert.equal(aestheticEvaluationReportSchema.safeParse({ ...data, relationships: [{ ...data.relationships[0], type: "rug_zoning" }] }).success, false);
  assert.equal(aestheticEvaluationReportSchema.safeParse({ ...data, relationships: [{ ...data.relationships[0], itemIds: ["sofa", "missing"] }] }).success, false);
  assert.equal(aestheticEvaluationReportSchema.safeParse({ ...data, items: data.items.slice(0, 1) }).success, false);
});

test("identifiers, stable codes, explanations and closed finding dimensions are validated", () => {
  for (const patch of [{ findingId: " " }, { code: "random code!" }, { explanation: "" }, { priority: "P4" }, { compatibility: "perfect" }, { evaluator: { evaluatorId: "", ruleId: "rule", version: "1" } }, { target: { kind: "dimension", dimension: "price_score" } }]) {
    assert.equal(aestheticFindingSchema.safeParse({ ...finding(), ...patch }).success, false);
  }
});

test("vendor payloads, scoring, dangling evidence and duplicate report IDs are rejected", () => {
  const data = report();
  assert.equal(aestheticEvaluationReportSchema.safeParse({ ...data, score: 99 }).success, false);
  assert.equal(aestheticFindingSchema.safeParse({ ...finding(), vendorName: "internal" }).success, false);
  assert.equal(aestheticFindingSchema.safeParse({ ...finding(), supportingEvidence: [{ ...support, productUrl: "https://example.com" }] }).success, false);
  assert.equal(aestheticFindingSchema.safeParse({ ...finding(), supportingEvidence: [{ ...support, itemIds: ["not-affected"] }] }).success, false);
  assert.equal(aestheticFindingSchema.safeParse({ ...finding(), supportingEvidence: [support, support] }).success, false);
  assert.equal(aestheticEvaluationReportSchema.safeParse({ ...data, items: [data.items[0], data.items[0], data.items[1]] }).success, false);
  assert.equal(aestheticEvaluationReportSchema.safeParse({ ...data, findings: [data.findings[0], data.findings[0]] }).success, false);
  assert.equal(aestheticEvaluationReportSchema.safeParse({ ...data, relationships: [data.relationships[0], data.relationships[0]] }).success, false);
});

test("validated contracts are plain serializable data and leave caller input unchanged", () => {
  const data = report();
  const snapshot = structuredClone(data);
  const parsed = aestheticEvaluationReportSchema.parse(data);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), parsed);
  assert.deepEqual(data, snapshot);
  assert.equal(parsed.findings[0].compatibility, "compatible");
});

test("evaluated unknown can be inconclusive with complete evidence and never implies compatible", () => {
  const parsed = aestheticFindingSchema.parse({ ...finding(), compatibility: "unknown" });
  assert.equal(parsed.coverage.status, "EVALUATED");
  assert.equal(parsed.evidenceCompleteness, "complete");
  assert.equal(parsed.compatibility, "unknown");
});

test("not implemented may have complete evidence but insufficient evidence cannot be complete", () => {
  const data = { ...finding(), compatibility: "unknown", coverage: { status: "NOT_EVALUATED", reason: "This evaluator is not implemented." } };
  assert.equal(aestheticFindingSchema.safeParse(data).success, true);
  assert.equal(aestheticFindingSchema.safeParse({ ...data, coverage: { status: "INSUFFICIENT_EVIDENCE", reason: "Visual evidence is insufficient." } }).success, false);
});

test("measured/observed support needs item references while design-intent evidence may be global", () => {
  assert.equal(aestheticFindingSchema.safeParse({ ...finding(), supportingEvidence: [{ ...support, source: "measured_dimensions", itemIds: [] }] }).success, false);
  assert.equal(aestheticFindingSchema.safeParse({ ...finding(), supportingEvidence: [{ ...support, source: "design_intent", itemIds: [],
    observation: { kind: "design_intent", preference: "STYLE", values: ["modern"] } }] }).success, true);
});

test("future bedroom coordination can remain wholly unevaluated in a validated report", () => {
  const itemIds = ["bed", "bedding", "curtain", "art", "plant"];
  const relationshipType = "bedroom_bedding_curtain_art_plant_coordination";
  const data = report({ evaluatedCoverage: [], items: itemIds.map((itemId) => ({ itemId })),
    relationships: [{ relationshipId: "bedroom-composition", type: relationshipType, itemIds }],
    findings: [{ ...finding(), findingId: "bedroom-coverage", code: "bedroom.composition_not_evaluated",
      target: { kind: "relationship", relationshipId: "bedroom-composition", relationshipType, dimension: "composition" },
      subjects: itemIds.map((id) => ({ kind: "ITEM" as const, id })), itemIds, compatibility: "unknown", coverage: { status: "NOT_EVALUATED", reason: "This evaluator is not implemented." },
      evidenceCompleteness: "missing", supportingEvidence: [],
      missingInformation: [{ code: "composition_evidence_unavailable", dimension: "composition", itemIds, description: "Visual composition evidence and its evaluator are not available." }], recommendationCategory: null,
    }] });
  assert.equal(aestheticEvaluationReportSchema.safeParse(data).success, true);
  assert.equal(aestheticEvaluationReportSchema.safeParse({ ...data, findings: [{ ...data.findings[0], itemIds: ["bed", "bedding"] }] }).success, false);
});

test("dimension findings reuse existing scale vocabulary without requiring a relationship", () => {
  const data = { ...finding(), findingId: "sofa-scale", code: "sofa.scale_proportion", target: { kind: "dimension", dimension: "scale_proportion" },
    subjects: [{ kind: "ITEM" as const, id: "sofa" }],
    itemIds: ["sofa"], supportingEvidence: [{ ...support, dimension: "scale_proportion", itemIds: ["sofa"], source: "measured_dimensions",
      observation: { kind: "measurement", attribute: "SCALE", subjectId: "sofa", actualValue: 210, unit: "cm", expectedRange: { minimum: 180, maximum: 240 } } }],
  };
  assert.equal(aestheticEvaluationReportSchema.safeParse(report({ items: [{ itemId: "sofa" }], relationships: [], findings: [data], evaluatedCoverage: [{ dimension: "scale_proportion", itemIds: ["sofa"] }] })).success, true);
});