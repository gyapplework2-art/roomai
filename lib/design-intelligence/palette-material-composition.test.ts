import assert from "node:assert/strict";
import test from "node:test";

import { createRectangleGeometry } from "@/lib/geometry/templates";
import { resolveLivingRoomComposition } from "@/lib/furniture-planning/role-plan";
import { validateSpatialPlan } from "@/lib/furniture-planning/spatial-validator";
import type { Tables } from "@/types/database.types";
import { normalizeFurnitureAttributes } from "./furniture-attributes";
import { aestheticDesignContextSchema, createAestheticDesignContext, type CatalogAestheticMetadata } from "./aesthetic-context";
import { aestheticEvaluationReportSchema } from "./aesthetic-contracts";
import { evaluateColorHarmony } from "./color-harmony-evaluation";
import { evaluateMaterialTextureHarmony } from "./material-texture-harmony-evaluation";
import { evaluatePaletteMaterialComposition } from "./palette-material-composition";

const geometry = createRectangleGeometry(800, 500, 250);
const composition = resolveLivingRoomComposition({ geometry, mustHaveItems: ["sofa", "chair", "chair"], roomFunctions: [] });
const project = { id: "palette-material-project", room_type: "living_room" as const };
type Preferences = Pick<Tables<"room_preferences">,
  "primary_style" | "secondary_style" | "color_mood" | "primary_color" | "secondary_color" | "accent_color" | "metal_color"
  | "preferred_materials" | "avoid_materials" | "room_functions" | "must_have_items" | "nice_to_have_items"
  | "household_size" | "special_requirements" | "additional_notes" | "priority">;

function preferences(options: { primaryColor?: string | null; preferred?: string[]; avoided?: string[] }): Preferences {
  return {
    primary_style: null, secondary_style: null, color_mood: null,
    primary_color: options.primaryColor ?? null, secondary_color: null, accent_color: null, metal_color: null,
    preferred_materials: options.preferred ?? [], avoid_materials: options.avoided ?? [],
    room_functions: [], must_have_items: [], nice_to_have_items: [], household_size: null,
    special_requirements: [], additional_notes: null, priority: null,
  };
}

function furnitureAttributes(options: { upholstery?: string; texture?: string } = {}) {
  return normalizeFurnitureAttributes({ seatingCapacity: null }, {
    normalizedAttributes: {
      ...(options.upholstery !== undefined ? { upholstery: options.upholstery } : {}),
      ...(options.texture !== undefined ? { "fabric texture": options.texture } : {}),
    },
  });
}

function catalog(color: string | null, material: string | null, itemId: string): CatalogAestheticMetadata {
  return {
    productId: `catalog-${itemId}`, variantId: `variant-${itemId}`, normalizedStyle: null,
    normalizedColor: color, normalizedMaterial: material, seatingCapacity: null,
    widthCm: 220, depthCm: 90, heightCm: 80,
  };
}

function makeContext(options: {
  colors?: Readonly<Record<string, string | null>>;
  materials?: Readonly<Record<string, string | null>>;
  attributes?: Readonly<Record<string, ReturnType<typeof furnitureAttributes>>>;
  preference?: Preferences | null;
  includeGroup?: boolean;
  reverse?: boolean;
  includeUntrustedCatalogFields?: boolean;
} = {}) {
  const plan = options.reverse ? { ...composition.plan, items: [...composition.plan.items].reverse() } : composition.plan;
  const spatialReport = validateSpatialPlan(plan, geometry, [], composition.zones);
  const items = Object.fromEntries(plan.items.map((item) => [item.id, {
    catalog: options.includeUntrustedCatalogFields
      ? {
        ...catalog(options.colors?.[item.id] ?? null, options.materials?.[item.id] ?? null, item.id),
        productTitle: "Leather Sofa",
        roomaiDescription: "A velvet sofa with oak construction.",
        vendorName: "Example Vendor",
        roomaiSellingPrice: 99999,
        productUrl: "https://example.invalid/product",
        estimatedDeliveryDaysMin: 90,
      }
      : catalog(options.colors?.[item.id] ?? null, options.materials?.[item.id] ?? null, item.id),
    ...(options.attributes?.[item.id] ? { furnitureAttributes: options.attributes[item.id] } : {}),
  }]));
  return createAestheticDesignContext({
    designId: "composition-design", project, preferences: options.preference ?? null,
    plan, geometry, openings: [], zones: composition.zones,
    groups: options.includeGroup === false ? [] : [composition.group], spatialReport,
    itemMetadataByPlanId: items,
  });
}

function roleItemId(role: string): string {
  const itemId = composition.plan.items.find((item) => item.semanticPlacement.role === role)?.id;
  assert.ok(itemId, `missing fixture role ${role}`);
  return itemId;
}

function pairFinding(report: ReturnType<typeof evaluatePaletteMaterialComposition>, dimension: "color_harmony" | "material_harmony" | "texture_harmony", firstId: string, secondId: string) {
  return report.findings.find((finding) => finding.target.kind === "relationship" && finding.target.dimension === dimension
    && finding.itemIds.includes(firstId) && finding.itemIds.includes(secondId));
}

function emptyContext() {
  const context = makeContext({ includeGroup: false });
  return aestheticDesignContextSchema.parse({
    ...context,
    items: [],
    groups: [],
    planReference: { ...context.planReference, itemIds: [] },
    metadataCoverage: context.metadataCoverage.map((entry) => ({
      dimension: entry.dimension, status: "NOT_APPLICABLE", applicableItemIds: [], knownItemIds: [], unavailableItemIds: [],
    })),
  });
}

test("no applicable context yields no findings or relationships and preserves N/A coverage", () => {
  const report = evaluatePaletteMaterialComposition(emptyContext());
  assert.deepEqual(report.items, []);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.relationships, []);
  for (const dimension of ["color_harmony", "material_harmony", "texture_harmony"] as const) {
    assert.equal(report.coverage.find((entry) => entry.dimension === dimension)?.status, "NOT_APPLICABLE");
  }
  assert.equal(report.status, "NOT_EVALUATED");
  assert.equal("score" in report, false);
  assert.equal(aestheticEvaluationReportSchema.safeParse(report).success, true);
});

test("color-only applicable evidence is retained without implying material or texture evaluation", () => {
  const context = makeContext({ preference: preferences({ primaryColor: "cream" }), includeGroup: false,
    colors: Object.fromEntries(composition.plan.items.map((item) => [item.id, "cream"])) });
  const report = evaluatePaletteMaterialComposition(context);
  assert.ok(report.findings.some((finding) => finding.target.dimension === "color_harmony"));
  assert.equal(report.coverage.find((entry) => entry.dimension === "color_harmony")?.status, "EVALUATED");
  assert.equal(report.coverage.find((entry) => entry.dimension === "material_harmony")?.status, "NOT_APPLICABLE");
  assert.equal(report.coverage.find((entry) => entry.dimension === "texture_harmony")?.status, "NOT_APPLICABLE");
  assert.equal(report.coverage.find((entry) => entry.dimension === "composition")?.status, "NOT_EVALUATED");
});

test("material-only preference evidence is retained without creating palette or texture claims", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const context = makeContext({ preference: preferences({ preferred: ["oak"] }), includeGroup: false,
    materials: Object.fromEntries(composition.plan.items.map((item) => [item.id, "oak"])) });
  const report = evaluatePaletteMaterialComposition(context);
  assert.ok(report.findings.some((finding) => finding.findingId === `material.preference:${sofaId}`));
  assert.equal(report.coverage.find((entry) => entry.dimension === "material_harmony")?.status, "EVALUATED");
  assert.equal(report.coverage.find((entry) => entry.dimension === "color_harmony")?.status, "NOT_APPLICABLE");
  assert.equal(report.coverage.find((entry) => entry.dimension === "texture_harmony")?.status, "NOT_APPLICABLE");
});

test("known standalone texture with no applicable relationship stays NOT_EVALUATED", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const context = makeContext({ includeGroup: false, attributes: { [sofaId]: furnitureAttributes({ texture: "boucle" }) } });
  const report = evaluatePaletteMaterialComposition(context);
  assert.deepEqual(report.findings, []);
  assert.equal(report.coverage.find((entry) => entry.dimension === "texture_harmony")?.status, "NOT_EVALUATED");
  assert.ok(report.diagnostics.some((diagnostic) => diagnostic.code === "texture.preference_rule_unavailable"));
});

test("coordinated color and compatible material preserve their separate source findings", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const rugId = roleItemId("AREA_RUG");
  const attributes = Object.fromEntries(composition.plan.items.map((item) => [item.id, furnitureAttributes({ upholstery: "linen", texture: "boucle" })]));
  const context = makeContext({ preference: preferences({ primaryColor: "cream", preferred: ["linen"] }),
    colors: { [sofaId]: "cream", [rugId]: "tan" }, materials: { [sofaId]: "linen", [rugId]: "linen" }, attributes });
  const colorSource = evaluateColorHarmony(context);
  const materialSource = evaluateMaterialTextureHarmony(context);
  const report = evaluatePaletteMaterialComposition(context);
  const colorPair = pairFinding(report, "color_harmony", sofaId, rugId);
  const materialPair = pairFinding(report, "material_harmony", sofaId, rugId);
  assert.ok(colorPair && materialPair);
  assert.equal(colorPair.compatibility, "compatible");
  assert.equal(colorPair.impact, "POSITIVE");
  assert.equal(materialPair.compatibility, "compatible");
  assert.equal(materialPair.impact, "NEUTRAL");
  assert.deepEqual(report.findings.map((finding) => finding.findingId).sort(),
    [...colorSource.findings, ...materialSource.findings].map((finding) => finding.findingId).sort());
});

test("coordinated color and mixed material remain separate; mixed material is not a conflict", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const rugId = roleItemId("AREA_RUG");
  const attributes = Object.fromEntries(composition.plan.items.map((item) => [item.id, furnitureAttributes({ upholstery: "linen" })]));
  attributes[sofaId] = furnitureAttributes({ upholstery: "linen" });
  attributes[rugId] = furnitureAttributes({ upholstery: "leather" });
  const context = makeContext({ preference: preferences({ primaryColor: "cream" }), colors: { [sofaId]: "cream", [rugId]: "tan" }, attributes });
  const report = evaluatePaletteMaterialComposition(context);
  const colorPair = pairFinding(report, "color_harmony", sofaId, rugId);
  const materialPair = pairFinding(report, "material_harmony", sofaId, rugId);
  assert.ok(colorPair && materialPair);
  assert.equal(colorPair.compatibility, "compatible");
  assert.equal(materialPair.compatibility, "mixed");
  assert.equal(materialPair.impact, "NEUTRAL");
  assert.equal(report.issues.includes(materialPair.findingId), false);
});

test("identical colors plus different textures preserve neutral mixed texture evidence", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const rugId = roleItemId("AREA_RUG");
  const attributes = Object.fromEntries(composition.plan.items.map((item) => [item.id, furnitureAttributes({ texture: "boucle" })]));
  attributes[sofaId] = furnitureAttributes({ texture: "boucle" });
  attributes[rugId] = furnitureAttributes({ texture: "chenille" });
  const context = makeContext({ colors: Object.fromEntries(composition.plan.items.map((item) => [item.id, "cream"])), attributes });
  const report = evaluatePaletteMaterialComposition(context);
  const colorPair = pairFinding(report, "color_harmony", sofaId, rugId);
  const texturePair = pairFinding(report, "texture_harmony", sofaId, rugId);
  assert.ok(colorPair && texturePair);
  assert.equal(colorPair.compatibility, "compatible");
  assert.equal(texturePair.compatibility, "mixed");
  assert.equal(texturePair.impact, "NEUTRAL");
  assert.deepEqual(report.issues, []);
});

test("explicit avoided-material conflict is preserved alongside positive color evidence", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const context = makeContext({ preference: preferences({ primaryColor: "cream", avoided: ["leather"] }),
    colors: Object.fromEntries(composition.plan.items.map((item) => [item.id, "cream"])),
    materials: Object.fromEntries(composition.plan.items.map((item) => [item.id, "leather"])), includeGroup: false });
  const colorSource = evaluateColorHarmony(context);
  const materialSource = evaluateMaterialTextureHarmony(context);
  const report = evaluatePaletteMaterialComposition(context);
  const materialConflict = report.findings.find((finding) => finding.findingId === `material.preference:${sofaId}`);
  const colorPositive = report.findings.find((finding) => finding.findingId === `color.palette:${sofaId}`);
  assert.ok(materialConflict && colorPositive);
  assert.equal(materialConflict.compatibility, "incompatible");
  assert.equal(materialConflict.impact, "MINOR_ISSUE");
  assert.equal(materialConflict.priority, "P3");
  assert.equal(colorPositive.impact, "POSITIVE");
  assert.ok(report.issues.includes(materialConflict.findingId));
  assert.ok(report.strengths.includes(colorPositive.findingId));
  assert.deepEqual(report.findings.map((finding) => finding.findingId).sort(),
    [...colorSource.findings, ...materialSource.findings].map((finding) => finding.findingId).sort());
});

test("positive source evidence plus insufficient evidence remains partial and explicit", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const colors = Object.fromEntries(composition.plan.items.map((item) => [item.id, item.id === sofaId ? "cream" : null]));
  const context = makeContext({ preference: preferences({ primaryColor: "cream", preferred: ["oak"] }), colors, materials: { [sofaId]: "oak" }, includeGroup: false });
  const report = evaluatePaletteMaterialComposition(context);
  assert.ok(report.strengths.length > 0);
  assert.ok(report.findings.some((finding) => finding.coverage.status === "INSUFFICIENT_EVIDENCE"));
  assert.equal(report.coverage.find((entry) => entry.dimension === "color_harmony")?.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(report.status, "PARTIALLY_EVALUATED");
});

test("positive material evidence remains while available texture without a rule stays NOT_EVALUATED", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const context = makeContext({ preference: preferences({ preferred: ["oak"] }),
    materials: Object.fromEntries(composition.plan.items.map((item) => [item.id, "oak"])),
    attributes: { [sofaId]: furnitureAttributes({ texture: "boucle" }) }, includeGroup: false });
  const report = evaluatePaletteMaterialComposition(context);
  assert.ok(report.strengths.includes(`material.preference:${sofaId}`));
  assert.equal(report.coverage.find((entry) => entry.dimension === "material_harmony")?.status, "EVALUATED");
  assert.equal(report.coverage.find((entry) => entry.dimension === "texture_harmony")?.status, "NOT_EVALUATED");
  assert.equal(report.status, "PARTIALLY_EVALUATED");
});

test("multiple positive and mixed source findings are preserved without voting or scoring", () => {
  const context = makeContext({ preference: preferences({ primaryColor: "cream", preferred: ["oak"] }),
    colors: Object.fromEntries(composition.plan.items.map((item) => [item.id, "purple"])),
    materials: Object.fromEntries(composition.plan.items.map((item) => [item.id, "leather"])), includeGroup: false });
  const positiveContext = makeContext({ preference: preferences({ primaryColor: "cream", preferred: ["oak"] }),
    colors: Object.fromEntries(composition.plan.items.map((item) => [item.id, "cream"])),
    materials: Object.fromEntries(composition.plan.items.map((item) => [item.id, "oak"])), includeGroup: false });
  const mixed = evaluatePaletteMaterialComposition(context);
  const positive = evaluatePaletteMaterialComposition(positiveContext);
  assert.ok(mixed.findings.filter((finding) => finding.compatibility === "mixed").length > 1);
  assert.deepEqual(mixed.issues, []);
  assert.ok(positive.strengths.length > 1);
  assert.equal("score" in mixed, false);
  assert.equal("score" in positive, false);
  assert.equal(mixed.findings.some((finding) => finding.evaluator.evaluatorId === "palette-material-composition"), false);
});

test("unrelated items create no relationships or pair findings", () => {
  const context = makeContext({ preference: preferences({ primaryColor: "cream", preferred: ["oak"] }), includeGroup: false,
    colors: Object.fromEntries(composition.plan.items.map((item) => [item.id, "cream"])),
    materials: Object.fromEntries(composition.plan.items.map((item) => [item.id, "oak"])) });
  const report = evaluatePaletteMaterialComposition(context);
  assert.deepEqual(report.relationships, []);
  assert.ok(report.findings.every((finding) => finding.target.kind === "dimension"));
});

test("merged findings, relationships, diagnostics, and IDs are deterministic and deduplicated", () => {
  const context = makeContext({ preference: preferences({ primaryColor: "midnight blue", preferred: ["oak"] }),
    colors: Object.fromEntries(composition.plan.items.map((item) => [item.id, null])),
    materials: Object.fromEntries(composition.plan.items.map((item) => [item.id, "oak"])) });
  const report = evaluatePaletteMaterialComposition(context);
  assert.equal(new Set(report.findings.map((finding) => finding.findingId)).size, report.findings.length);
  assert.equal(new Set(report.relationships.map((relationship) => relationship.relationshipId)).size, report.relationships.length);
  assert.equal(new Set(report.diagnostics.map((diagnostic) => JSON.stringify(diagnostic))).size, report.diagnostics.length);
  const relationshipIds = report.relationships.map((relationship) => relationship.relationshipId);
  assert.equal(new Set(relationshipIds).size, relationshipIds.length);
  assert.deepEqual(evaluatePaletteMaterialComposition(context), report);
});

test("source finding IDs, evidence, and relationship IDs remain exact and traceable", () => {
  const context = makeContext({ preference: preferences({ primaryColor: "cream", preferred: ["oak"] }),
    colors: Object.fromEntries(composition.plan.items.map((item) => [item.id, "cream"])),
    materials: Object.fromEntries(composition.plan.items.map((item) => [item.id, "oak"])) });
  const colorSource = evaluateColorHarmony(context);
  const materialSource = evaluateMaterialTextureHarmony(context);
  const report = evaluatePaletteMaterialComposition(context);
  const sourceFindingIds = [...colorSource.findings, ...materialSource.findings].map((finding) => finding.findingId).sort();
  assert.deepEqual(report.findings.map((finding) => finding.findingId).sort(), sourceFindingIds);
  const sourceRelationshipIds = [...colorSource.relationships, ...materialSource.relationships].map((relationship) => relationship.relationshipId).sort();
  assert.deepEqual(report.relationships.map((relationship) => relationship.relationshipId).sort(), sourceRelationshipIds);
  assert.deepEqual(report.strengths, [...colorSource.strengths, ...materialSource.strengths].sort());
  assert.deepEqual(report.issues, [...colorSource.issues, ...materialSource.issues].sort());
  for (const finding of report.findings) {
    assert.ok([...colorSource.findings, ...materialSource.findings].some((source) => source.findingId === finding.findingId && JSON.stringify(source) === JSON.stringify(finding)));
  }
});

test("source coverage ownership is preserved; no B.2 or B.4 evaluation is added", () => {
  const context = makeContext({ preference: preferences({ primaryColor: "cream", preferred: ["oak"] }),
    colors: Object.fromEntries(composition.plan.items.map((item) => [item.id, "cream"])),
    materials: Object.fromEntries(composition.plan.items.map((item) => [item.id, "oak"])) });
  const colorSource = evaluateColorHarmony(context);
  const materialSource = evaluateMaterialTextureHarmony(context);
  const report = evaluatePaletteMaterialComposition(context);
  assert.deepEqual(report.coverage.find((entry) => entry.dimension === "color_harmony"), colorSource.coverage.find((entry) => entry.dimension === "color_harmony"));
  assert.deepEqual(report.coverage.find((entry) => entry.dimension === "material_harmony"), materialSource.coverage.find((entry) => entry.dimension === "material_harmony"));
  assert.deepEqual(report.coverage.find((entry) => entry.dimension === "texture_harmony"), materialSource.coverage.find((entry) => entry.dimension === "texture_harmony"));
  for (const dimension of ["scale_proportion", "visual_weight", "composition", "visual_balance", "rug_zone_coherence", "lighting_composition"] as const) {
    assert.equal(report.coverage.find((entry) => entry.dimension === dimension)?.status, "NOT_EVALUATED");
  }
  assert.ok(report.findings.every((finding) => !["scale_proportion", "visual_weight", "composition", "rug_zone_coherence", "lighting_composition"].includes(finding.target.dimension)));
});

test("invalid or incomplete spatial status is preserved while supported source findings remain", () => {
  const base = makeContext({ preference: preferences({ primaryColor: "cream", preferred: ["oak"] }),
    colors: Object.fromEntries(composition.plan.items.map((item) => [item.id, "cream"])),
    materials: Object.fromEntries(composition.plan.items.map((item) => [item.id, "oak"])) });
  for (const status of ["INVALID", "NOT_FULLY_EVALUATED"] as const) {
    const context = aestheticDesignContextSchema.parse({
      ...base,
      spatialValidation: { ...base.spatialValidation, status, valid: status === "INVALID" ? false : base.spatialValidation.valid },
    });
    const report = evaluatePaletteMaterialComposition(context);
    assert.equal(report.spatialStatus.status, status);
    assert.ok(report.findings.length > 0);
  }
});

test("unrelated catalog identity changes do not affect composition output", () => {
  const base = makeContext({ preference: preferences({ primaryColor: "cream", preferred: ["oak"] }),
    colors: Object.fromEntries(composition.plan.items.map((item) => [item.id, "cream"])),
    materials: Object.fromEntries(composition.plan.items.map((item) => [item.id, "oak"])) });
  const changedReferences = aestheticDesignContextSchema.parse({
    ...base,
    items: base.items.map((item) => ({ ...item, catalogReference: { productId: `different-product-${item.itemId}`, variantId: `different-variant-${item.itemId}` }, designObjectReference: `different-object-${item.itemId}` })),
  });
  assert.deepEqual(evaluatePaletteMaterialComposition(changedReferences), evaluatePaletteMaterialComposition(base));
});

test("marketing, vendor, price, URL, and shipping fields do not affect composition", () => {
  const options = {
    preference: preferences({ primaryColor: "cream", preferred: ["oak"] }),
    colors: Object.fromEntries(composition.plan.items.map((item) => [item.id, "cream"])),
    materials: Object.fromEntries(composition.plan.items.map((item) => [item.id, "oak"])),
  };
  assert.deepEqual(
    evaluatePaletteMaterialComposition(makeContext({ ...options, includeUntrustedCatalogFields: true })),
    evaluatePaletteMaterialComposition(makeContext(options)),
  );
});

test("input permutation, repeated evaluation, immutability, and JSON roundtrip are preserved", () => {
  const attributes = Object.fromEntries(composition.plan.items.map((item) => [item.id, furnitureAttributes({ upholstery: "linen", texture: "boucle" })]));
  const base = makeContext({ preference: preferences({ primaryColor: "cream", preferred: ["linen"] }),
    colors: Object.fromEntries(composition.plan.items.map((item) => [item.id, "cream"])),
    materials: Object.fromEntries(composition.plan.items.map((item) => [item.id, "linen"])), attributes });
  const permuted = aestheticDesignContextSchema.parse({
    ...base,
    items: [...base.items].reverse().map((item) => ({ ...item, placement: { ...item.placement, relationships: [...item.placement.relationships].reverse() } })),
    groups: [...base.groups].reverse().map((group) => ({ ...group, itemIds: [...group.itemIds].reverse() })),
  });
  const contextSnapshot = structuredClone(permuted);
  const colorSource = evaluateColorHarmony(permuted);
  const materialSource = evaluateMaterialTextureHarmony(permuted);
  const colorSnapshot = structuredClone(colorSource);
  const materialSnapshot = structuredClone(materialSource);
  const report = evaluatePaletteMaterialComposition(permuted);
  assert.deepEqual(evaluatePaletteMaterialComposition(permuted), report);
  assert.deepEqual(evaluatePaletteMaterialComposition(base), report);
  assert.deepEqual(permuted, contextSnapshot);
  assert.deepEqual(colorSource, colorSnapshot);
  assert.deepEqual(materialSource, materialSnapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  assert.equal(aestheticEvaluationReportSchema.safeParse(report).success, true);
});