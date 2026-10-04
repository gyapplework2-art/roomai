import assert from "node:assert/strict";
import test from "node:test";

import { createRectangleGeometry } from "@/lib/geometry/templates";
import { resolveLivingRoomComposition } from "@/lib/furniture-planning/role-plan";
import { validateSpatialPlan } from "@/lib/furniture-planning/spatial-validator";
import type { Tables } from "@/types/database.types";
import { normalizeFurnitureAttributes } from "./furniture-attributes";
import { aestheticDesignContextSchema, createAestheticDesignContext, type CatalogAestheticMetadata, type DesignObjectAestheticMetadata } from "./aesthetic-context";
import { aestheticEvaluationReportSchema } from "./aesthetic-contracts";
import { evaluateMaterialTextureHarmony } from "./material-texture-harmony-evaluation";

const geometry = createRectangleGeometry(800, 500, 250);
const composition = resolveLivingRoomComposition({ geometry, mustHaveItems: ["sofa", "chair", "chair"], roomFunctions: [] });
const project = { id: "material-texture-project", room_type: "living_room" as const };
type Preferences = Pick<Tables<"room_preferences">,
  "primary_style" | "secondary_style" | "color_mood" | "primary_color" | "secondary_color" | "accent_color" | "metal_color"
  | "preferred_materials" | "avoid_materials" | "room_functions" | "must_have_items" | "nice_to_have_items"
  | "household_size" | "special_requirements" | "additional_notes" | "priority">;

function preferences(materials: { preferred_materials?: string[]; avoid_materials?: string[] }): Preferences {
  return {
    primary_style: null, secondary_style: null, color_mood: null, primary_color: null, secondary_color: null, accent_color: null, metal_color: null,
    preferred_materials: materials.preferred_materials ?? [], avoid_materials: materials.avoid_materials ?? [],
    room_functions: [], must_have_items: [], nice_to_have_items: [], household_size: null,
    special_requirements: [], additional_notes: null, priority: null,
  };
}

function catalog(normalizedMaterial: string | null, overrides: Partial<CatalogAestheticMetadata> = {}): CatalogAestheticMetadata {
  return {
    productId: "material-catalog-product", variantId: "material-catalog-variant", normalizedStyle: null, normalizedColor: null,
    normalizedMaterial, seatingCapacity: null, widthCm: 220, depthCm: 90, heightCm: 80,
    ...overrides,
  };
}

function attributes(values: { upholstery?: string; texture?: string; exposedWood?: boolean; exposedMetal?: boolean } = {}) {
  return normalizeFurnitureAttributes({ seatingCapacity: null }, {
    normalizedAttributes: {
      ...(values.upholstery !== undefined ? { upholstery: values.upholstery } : {}),
      ...(values.texture !== undefined ? { "fabric texture": values.texture } : {}),
      ...(values.exposedWood !== undefined ? { "exposed wood": values.exposedWood } : {}),
      ...(values.exposedMetal !== undefined ? { "exposed metal": values.exposedMetal } : {}),
    },
  });
}

function makeContext(options: {
  materialsByPlanId?: Readonly<Record<string, string | null>>;
  preference?: Preferences | null;
  includeGroup?: boolean;
  includeCatalog?: boolean;
  designObjectByPlanId?: Readonly<Record<string, DesignObjectAestheticMetadata>>;
  attributesByPlanId?: Readonly<Record<string, ReturnType<typeof attributes>>>;
  reverseItems?: boolean;
} = {}) {
  const plan = options.reverseItems ? { ...composition.plan, items: [...composition.plan.items].reverse() } : composition.plan;
  const spatialReport = validateSpatialPlan(plan, geometry, [], composition.zones);
  const materialValues = options.materialsByPlanId ?? {};
  const itemMetadataByPlanId = Object.fromEntries(plan.items.map((item) => {
    const metadata = {
      ...(options.includeCatalog === false ? {} : { catalog: catalog(materialValues[item.id] ?? null, { productId: `catalog-${item.id}`, variantId: `variant-${item.id}` }) }),
      ...(options.designObjectByPlanId?.[item.id] ? { designObject: options.designObjectByPlanId[item.id] } : {}),
      ...(options.attributesByPlanId?.[item.id] ? { furnitureAttributes: options.attributesByPlanId[item.id] } : {}),
    };
    return [item.id, metadata];
  }));
  return createAestheticDesignContext({
    designId: "material-texture-design", project, preferences: options.preference ?? null, plan, geometry,
    openings: [], zones: composition.zones, groups: options.includeGroup === false ? [] : [composition.group], spatialReport,
    itemMetadataByPlanId,
  });
}

function roleItemId(role: string): string {
  const id = composition.plan.items.find((item) => item.semanticPlacement.role === role)?.id;
  assert.ok(id, `expected role ${role}`);
  return id;
}

function itemFinding(report: ReturnType<typeof evaluateMaterialTextureHarmony>, itemId: string) {
  return report.findings.find((finding) => finding.findingId === `material.preference:${itemId}`);
}

function pairFinding(report: ReturnType<typeof evaluateMaterialTextureHarmony>, dimension: "material_harmony" | "texture_harmony", firstId: string, secondId: string) {
  return report.findings.find((finding) => finding.target.kind === "relationship" && finding.target.dimension === dimension
    && finding.itemIds.includes(firstId) && finding.itemIds.includes(secondId));
}

test("explicit preferred material exact match yields a positive IDENTICAL finding", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const report = evaluateMaterialTextureHarmony(makeContext({
    includeGroup: false, preference: preferences({ preferred_materials: ["oak"] }),
    materialsByPlanId: { [sofaId]: "solid oak" },
  }));
  const finding = itemFinding(report, sofaId);
  assert.ok(finding);
  assert.equal(finding.compatibility, "compatible");
  assert.equal(finding.impact, "POSITIVE");
  assert.ok(report.strengths.includes(finding.findingId));
  assert.deepEqual(report.issues, []);
  const observation = finding.supportingEvidence[0].observation;
  assert.equal(observation.kind, "item_material_harmony");
  if (observation.kind === "item_material_harmony") {
    assert.deepEqual(observation.material, { value: "oak", family: "wood" });
    assert.equal(observation.materialSource, "catalog");
    assert.equal(observation.preferenceRole, "PREFERRED");
    assert.equal(observation.relationship, "IDENTICAL");
  }
  assert.equal(aestheticEvaluationReportSchema.safeParse(report).success, true);
});

test("same-family preferred material is SIMILAR with the same impact as an exact match", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const report = evaluateMaterialTextureHarmony(makeContext({
    includeGroup: false, preference: preferences({ preferred_materials: ["wood"] }),
    materialsByPlanId: { [sofaId]: "walnut" },
  }));
  const finding = itemFinding(report, sofaId);
  assert.ok(finding);
  assert.equal(finding.compatibility, "compatible");
  assert.equal(finding.impact, "POSITIVE");
  if (finding.supportingEvidence[0].observation.kind === "item_material_harmony") {
    assert.equal(finding.supportingEvidence[0].observation.relationship, "SIMILAR");
  } else assert.fail("expected item material observation");
});

test("only an explicit avoided-material preference produces an issue", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const report = evaluateMaterialTextureHarmony(makeContext({
    includeGroup: false, preference: preferences({ avoid_materials: ["leather"] }),
    materialsByPlanId: { [sofaId]: "leather" },
  }));
  const finding = itemFinding(report, sofaId);
  assert.ok(finding);
  assert.equal(finding.compatibility, "incompatible");
  assert.equal(finding.priority, "P3");
  assert.equal(finding.impact, "MINOR_ISSUE");
  assert.deepEqual(report.issues, [finding.findingId]);
  if (finding.supportingEvidence[0].observation.kind === "item_material_harmony") {
    assert.equal(finding.supportingEvidence[0].observation.relationship, "CONFLICTING");
    assert.equal(finding.supportingEvidence[0].observation.preferenceRole, "AVOIDED");
  }
});

test("valid but unpreferred material stays mixed and neutral, not an intrinsic conflict", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const report = evaluateMaterialTextureHarmony(makeContext({
    includeGroup: false, preference: preferences({ preferred_materials: ["linen"] }),
    materialsByPlanId: { [sofaId]: "leather" },
  }));
  const finding = itemFinding(report, sofaId);
  assert.ok(finding);
  assert.equal(finding.compatibility, "mixed");
  assert.equal(finding.impact, "NEUTRAL");
  assert.deepEqual(report.issues, []);
  assert.equal(report.strengths.includes(finding.findingId), false);
  if (finding.supportingEvidence[0].observation.kind === "item_material_harmony") {
    assert.equal(finding.supportingEvidence[0].observation.relationship, "UNKNOWN");
  }
});

test("missing and unsupported item materials remain unknown with insufficient evidence", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  for (const [value, reason] of [[null, "candidate_material_missing"], ["mystery composite", "candidate_material_unknown"]] as const) {
    const report = evaluateMaterialTextureHarmony(makeContext({
      includeGroup: false, preference: preferences({ preferred_materials: ["linen"] }),
      materialsByPlanId: { [sofaId]: value },
    }));
    const finding = itemFinding(report, sofaId);
    assert.ok(finding);
    assert.equal(finding.compatibility, "unknown");
    assert.equal(finding.coverage.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(finding.impact, "NEUTRAL");
    assert.ok(report.findings.length > 0);
    if (finding.supportingEvidence[0].observation.kind === "item_material_harmony") {
      assert.ok(finding.supportingEvidence[0].observation.reasons.includes(reason));
      assert.equal(finding.supportingEvidence[0].observation.relationship, "UNKNOWN");
    }
    assert.deepEqual(report.strengths, []);
    assert.deepEqual(report.issues, []);
  }
});

test("title, description, category, color, and finish do not infer material", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const untrustedAttributes = normalizeFurnitureAttributes({ seatingCapacity: null }, {
    normalizedAttributes: { "product title": "Leather Sofa", color: "brown", finish: "brass", category: "sofa" },
    sourceAttributes: { description: "A leather sofa with an oak frame and velvet cushions." },
  });
  assert.equal(untrustedAttributes.upholsteryMaterial, null);
  assert.equal(untrustedAttributes.upholsteryType, null);
  assert.equal(untrustedAttributes.fabricTexture, null);
  const context = makeContext({
    includeGroup: false, preference: preferences({ preferred_materials: ["leather"] }),
    materialsByPlanId: { [sofaId]: null },
    attributesByPlanId: { [sofaId]: untrustedAttributes },
  });
  const item = context.items.find((entry) => entry.itemId === sofaId);
  assert.ok(item);
  assert.equal(item.category, "sofa");
  assert.equal(item.metadata.materials.status, "UNKNOWN");
  assert.equal(item.metadata.finish.status, "UNKNOWN");
  const finding = itemFinding(evaluateMaterialTextureHarmony(context), sofaId);
  assert.ok(finding);
  assert.equal(finding.compatibility, "unknown");
  assert.equal(finding.impact, "NEUTRAL");
});

test("catalog, design-object, and normalized-attribute material precedence is preserved", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const designObject: DesignObjectAestheticMetadata = {
    id: "design-object-sofa", catalog_product_id: "catalog-product", catalog_product_variant_id: "catalog-variant",
    material: "leather", primary_color: null, width_cm: 220, depth_cm: 90, height_cm: 80,
  };
  const catalogWins = makeContext({
    includeGroup: false, preference: preferences({ preferred_materials: ["oak"] }),
    materialsByPlanId: { [sofaId]: "oak" }, designObjectByPlanId: { [sofaId]: designObject },
    attributesByPlanId: { [sofaId]: attributes({ upholstery: "velvet" }) },
  }).items.find((item) => item.itemId === sofaId);
  assert.ok(catalogWins);
  assert.deepEqual(catalogWins.metadata.materials, { status: "KNOWN", values: [{ value: "oak", family: "wood" }], source: "catalog" });

  const designObjectFallback = makeContext({
    includeCatalog: false, includeGroup: false, preference: preferences({ preferred_materials: ["leather"] }),
    designObjectByPlanId: { [sofaId]: designObject }, attributesByPlanId: { [sofaId]: attributes({ upholstery: "velvet" }) },
  }).items.find((item) => item.itemId === sofaId);
  assert.ok(designObjectFallback);
  assert.deepEqual(designObjectFallback.metadata.materials, { status: "KNOWN", values: [{ value: "leather", family: "leather" }], source: "design_object" });

  const attributesFallback = makeContext({
    includeCatalog: false, includeGroup: false, preference: preferences({ preferred_materials: ["velvet"] }),
    attributesByPlanId: { [sofaId]: attributes({ upholstery: "Performance Velvet" }) },
  }).items.find((item) => item.itemId === sofaId);
  assert.ok(attributesFallback);
  assert.deepEqual(attributesFallback.metadata.materials, { status: "KNOWN", values: [{ value: "velvet", family: "textile" }], source: "normalized_attributes" });
});

test("exposed wood/metal flags do not invent structural material or finish", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const context = makeContext({
    includeGroup: false, preference: preferences({ preferred_materials: ["wood"] }),
    attributesByPlanId: { [sofaId]: attributes({ exposedWood: true, exposedMetal: false }) },
  });
  const item = context.items.find((entry) => entry.itemId === sofaId);
  assert.ok(item);
  assert.equal(item.metadata.materials.status, "UNKNOWN");
  assert.deepEqual(item.metadata.attributes.exposedWood, true);
  assert.deepEqual(item.metadata.attributes.exposedMetal, false);
  assert.equal(item.metadata.finish.status, "UNKNOWN");
  const finding = itemFinding(evaluateMaterialTextureHarmony(context), sofaId);
  assert.ok(finding);
  assert.equal(finding.compatibility, "unknown");
});

test("explicit E.10-A group supplies pair applicability, not harmony; family-compatible upholstery is neutral", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const rugId = roleItemId("AREA_RUG");
  const allAttributes = Object.fromEntries(composition.plan.items.map((item) => [item.id, attributes({ upholstery: "linen", texture: "boucle" })]));
  allAttributes[sofaId] = attributes({ upholstery: "linen", texture: "boucle" });
  allAttributes[rugId] = attributes({ upholstery: "velvet", texture: "chenille" });
  const report = evaluateMaterialTextureHarmony(makeContext({ attributesByPlanId: allAttributes }));
  const material = pairFinding(report, "material_harmony", sofaId, rugId);
  assert.ok(material);
  assert.equal(material.compatibility, "compatible");
  assert.equal(material.impact, "NEUTRAL");
  assert.equal(report.strengths.includes(material.findingId), false);
  if (material.supportingEvidence[0].observation.kind === "pair_material_harmony") {
    assert.equal(material.supportingEvidence[0].observation.relationship, "SIMILAR");
    assert.deepEqual(material.supportingEvidence[0].observation.relationshipSources, [{ kind: "E10A_GROUP", groupId: "primary-seating-group" }]);
  } else assert.fail("expected pair material observation");
  const texture = pairFinding(report, "texture_harmony", sofaId, rugId);
  assert.ok(texture);
  assert.equal(texture.compatibility, "mixed");
  assert.equal(texture.impact, "NEUTRAL");
  assert.deepEqual(report.issues, []);
});

test("same upholstery material is not ranked above a different-family material", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const rugId = roleItemId("AREA_RUG");
  const allAttributes = Object.fromEntries(composition.plan.items.map((item) => [item.id, attributes({ upholstery: "leather", texture: "velvet" })]));
  allAttributes[sofaId] = attributes({ upholstery: "leather", texture: "velvet" });
  allAttributes[rugId] = attributes({ upholstery: "linen", texture: "boucle" });
  const report = evaluateMaterialTextureHarmony(makeContext({ attributesByPlanId: allAttributes }));
  const pair = pairFinding(report, "material_harmony", sofaId, rugId);
  assert.ok(pair);
  assert.equal(pair.compatibility, "mixed");
  assert.equal(pair.impact, "NEUTRAL");
  assert.equal(report.issues.includes(pair.findingId), false);
  assert.equal(report.strengths.includes(pair.findingId), false);
  if (pair.supportingEvidence[0].observation.kind === "pair_material_harmony") {
    assert.equal(pair.supportingEvidence[0].observation.relationship, "UNKNOWN");
    assert.ok(pair.supportingEvidence[0].observation.reasons.includes("upholsteryMaterial_different"));
  }
});

test("known upholstery-type difference remains mixed even when detailed material is missing", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const rugId = roleItemId("AREA_RUG");
  const allAttributes = Object.fromEntries(composition.plan.items.map((item) => [item.id, attributes({ upholstery: "linen" })]));
  allAttributes[sofaId] = { ...attributes(), upholsteryType: "fabric", upholsteryMaterial: null };
  allAttributes[rugId] = { ...attributes(), upholsteryType: "leather", upholsteryMaterial: null };
  const report = evaluateMaterialTextureHarmony(makeContext({ attributesByPlanId: allAttributes }));
  const pair = pairFinding(report, "material_harmony", sofaId, rugId);
  assert.ok(pair);
  assert.equal(pair.compatibility, "mixed");
  assert.equal(pair.coverage.status, "EVALUATED");
  assert.equal(pair.impact, "NEUTRAL");
  if (pair.supportingEvidence[0].observation.kind === "pair_material_harmony") {
    assert.deepEqual(pair.supportingEvidence[0].observation.reasons, ["upholsteryType_different", "upholsteryMaterial_unknown"]);
  }
});

test("different general material families remain UNKNOWN where no pair rule exists", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const rugId = roleItemId("AREA_RUG");
  const report = evaluateMaterialTextureHarmony(makeContext({ materialsByPlanId: { [sofaId]: "oak", [rugId]: "brass" } }));
  const pair = pairFinding(report, "material_harmony", sofaId, rugId);
  assert.ok(pair);
  assert.equal(pair.compatibility, "unknown");
  assert.equal(pair.coverage.status, "NOT_EVALUATED");
  assert.equal(pair.impact, "NEUTRAL");
  assert.deepEqual(report.issues, []);
  if (pair.supportingEvidence[0].observation.kind === "pair_material_harmony") {
    assert.equal(pair.supportingEvidence[0].observation.relationship, "UNKNOWN");
    assert.deepEqual(pair.supportingEvidence[0].observation.reasons, ["material_pair_rule_unavailable"]);
  }
});

test("pair texture uses the existing controlled vocabulary and never treats difference as conflict", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const rugId = roleItemId("AREA_RUG");
  const allAttributes = Object.fromEntries(composition.plan.items.map((item) => [item.id, attributes({ texture: "Bouclé" })]));
  allAttributes[sofaId] = attributes({ texture: "Bouclé" });
  allAttributes[rugId] = attributes({ texture: "boucle" });
  const matched = evaluateMaterialTextureHarmony(makeContext({ attributesByPlanId: allAttributes }));
  const matchingPair = pairFinding(matched, "texture_harmony", sofaId, rugId);
  assert.ok(matchingPair);
  assert.equal(matchingPair.compatibility, "compatible");
  assert.equal(matchingPair.impact, "NEUTRAL");
  if (matchingPair.supportingEvidence[0].observation.kind === "pair_texture_harmony") {
    assert.equal(matchingPair.supportingEvidence[0].observation.relationship, "IDENTICAL");
    assert.equal(matchingPair.supportingEvidence[0].observation.pairItems[0].texture, "boucle");
    assert.equal(matchingPair.supportingEvidence[0].observation.pairItems[0].textureSource, "normalized_attributes");
  }

  allAttributes[rugId] = attributes({ texture: "chenille" });
  const different = evaluateMaterialTextureHarmony(makeContext({ attributesByPlanId: allAttributes }));
  const differentPair = pairFinding(different, "texture_harmony", sofaId, rugId);
  assert.ok(differentPair);
  assert.equal(differentPair.compatibility, "mixed");
  assert.equal(differentPair.impact, "NEUTRAL");
  assert.deepEqual(different.issues, []);
  if (differentPair.supportingEvidence[0].observation.kind === "pair_texture_harmony") {
    assert.equal(differentPair.supportingEvidence[0].observation.relationship, "UNKNOWN");
  }
});

test("missing upholstery and texture remain insufficient evidence, not issues", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const rugId = roleItemId("AREA_RUG");
  const report = evaluateMaterialTextureHarmony(makeContext());
  const material = pairFinding(report, "material_harmony", sofaId, rugId);
  const texture = pairFinding(report, "texture_harmony", sofaId, rugId);
  assert.ok(material && texture);
  assert.equal(material.compatibility, "unknown");
  assert.equal(material.coverage.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(texture.compatibility, "unknown");
  assert.equal(texture.coverage.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(material.impact, "NEUTRAL");
  assert.equal(texture.impact, "NEUTRAL");
  assert.deepEqual(report.issues, []);
  assert.equal(report.coverage.find((entry) => entry.dimension === "material_harmony")?.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(report.coverage.find((entry) => entry.dimension === "texture_harmony")?.status, "INSUFFICIENT_EVIDENCE");
});

test("explicit GROUPED_WITH establishes pair scope without an E.10-A group", () => {
  const base = makeContext({ includeGroup: false });
  const sofaId = roleItemId("PRIMARY_SEATING");
  const rugId = roleItemId("AREA_RUG");
  const context = aestheticDesignContextSchema.parse({
    ...base,
    items: base.items.map((item) => item.itemId === sofaId
      ? { ...item, placement: { ...item.placement, relationships: [...item.placement.relationships, { type: "GROUPED_WITH", targetItemId: rugId }] } }
      : item),
  });
  const report = evaluateMaterialTextureHarmony(context);
  const pair = pairFinding(report, "material_harmony", sofaId, rugId);
  assert.ok(pair);
  if (pair.supportingEvidence[0].observation.kind === "pair_material_harmony") {
    assert.deepEqual(pair.supportingEvidence[0].observation.relationshipSources, [{ kind: "SEMANTIC_RELATIONSHIP", relationshipType: "GROUPED_WITH" }]);
  }
});

test("unassociated items are not paired and texture preference evaluation remains deferred", () => {
  const sofaId = roleItemId("PRIMARY_SEATING");
  const context = makeContext({ includeGroup: false, attributesByPlanId: { [sofaId]: attributes({ texture: "boucle" }) } });
  const report = evaluateMaterialTextureHarmony(context);
  assert.deepEqual(report.relationships, []);
  assert.deepEqual(report.findings, []);
  assert.equal(report.coverage.find((entry) => entry.dimension === "material_harmony")?.status, "NOT_APPLICABLE");
  assert.equal(report.coverage.find((entry) => entry.dimension === "texture_harmony")?.status, "NOT_EVALUATED");
  assert.equal(report.diagnostics.some((diagnostic) => diagnostic.code === "texture.preference_rule_unavailable"), true);
});

test("pair permutation, repeated evaluation, JSON roundtrip, schema validation and immutability", () => {
  const allAttributes = Object.fromEntries(composition.plan.items.map((item) => [item.id, attributes({ upholstery: "linen", texture: "boucle" })]));
  const base = makeContext({ attributesByPlanId: allAttributes });
  const context = aestheticDesignContextSchema.parse({
    ...base,
    items: [...base.items].reverse(),
    groups: [...base.groups].reverse().map((group) => ({ ...group, itemIds: [...group.itemIds].reverse() })),
  });
  const snapshot = structuredClone(context);
  const first = evaluateMaterialTextureHarmony(context);
  assert.deepEqual(evaluateMaterialTextureHarmony(context), first);
  assert.deepEqual(evaluateMaterialTextureHarmony(aestheticDesignContextSchema.parse({ ...context, items: [...context.items].reverse() })), first);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.deepEqual(context, snapshot);
  assert.equal(aestheticEvaluationReportSchema.safeParse(first).success, true);
  assert.deepEqual(first.spatialStatus, {
    status: context.spatialValidation.status, valid: context.spatialValidation.valid,
    physicallyValid: context.spatialValidation.physicallyValid, functionallyValid: context.spatialValidation.functionallyValid,
    circulationStatus: context.spatialValidation.circulationStatus,
  });
});