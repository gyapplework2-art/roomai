import assert from "node:assert/strict";
import test from "node:test";

import { createRectangleGeometry } from "@/lib/geometry/templates";
import { normalizeFurnitureAttributes } from "./furniture-attributes";
import { aestheticDesignContextSchema, createAestheticDesignContext, type CatalogAestheticMetadata } from "./aesthetic-context";
import { aestheticEvaluationReportSchema, aestheticFindingSchema } from "./aesthetic-contracts";
import { resolveLivingRoomComposition } from "@/lib/furniture-planning/role-plan";
import type { FurniturePlanItemV11 } from "@/lib/furniture-planning/types";
import { validateSpatialPlan } from "@/lib/furniture-planning/spatial-validator";
import { evaluateLightingIntelligence } from "./lighting-intelligence";

const geometry = createRectangleGeometry(800, 500, 250);

function catalog(itemId: string, dimensions: { widthCm: number | null; depthCm: number | null; heightCm: number | null } | null = null): CatalogAestheticMetadata {
  return {
    productId: `product-${itemId}`, variantId: `variant-${itemId}`, normalizedStyle: "modern",
    normalizedColor: "cream", normalizedMaterial: "metal", seatingCapacity: null,
    widthCm: dimensions?.widthCm ?? null, depthCm: dimensions?.depthCm ?? null, heightCm: dimensions?.heightCm ?? null,
  };
}

function lightingItem(options: {
  itemId: string;
  semanticRole?: FurniturePlanItemV11["semanticPlacement"]["role"];
  category?: string;
  subtype?: string | null;
  zoneId?: string | null;
  mode?: FurniturePlanItemV11["semanticPlacement"]["mode"];
  position?: { xCm: number; yCm: number } | null;
  orientation?: number | null;
  relationships?: FurniturePlanItemV11["semanticPlacement"]["relationships"];
}): FurniturePlanItemV11 {
  return {
    id: options.itemId,
    category: options.category ?? "floor_lamp",
    subtype: options.subtype ?? null,
    priority: "required",
    placement: {
      preferredZone: options.zoneId === undefined ? "primary-seating" : options.zoneId,
      anchorWallId: null,
      approximatePosition: options.position === undefined ? { xCm: 420, yCm: 260 } : options.position,
      preferredOrientationDegrees: options.orientation === undefined ? 45 : options.orientation,
    },
    semanticPlacement: {
      role: options.semanticRole ?? "TASK_LIGHTING",
      mode: options.mode ?? "FLOATING",
      alignment: null,
      zoneId: options.zoneId === undefined ? "primary-seating" : options.zoneId,
      targetWallId: null,
      relationships: options.relationships ?? [],
      fallbackModes: [],
    },
    sizeRange: { widthMinCm: 20, widthMaxCm: 60, depthMinCm: 20, depthMaxCm: 60, heightMinCm: 120, heightMaxCm: 190 },
    styleHints: [], materialHints: [], colorHints: [], functionalRequirements: [], reasoning: "Lighting test fixture.",
  };
}

function makeContext(options: {
  role?: FurniturePlanItemV11["semanticPlacement"]["role"];
  category?: string;
  subtype?: string | null;
  roomType?: "living_room" | "family_room" | "dining_room" | "bedroom" | "home_office";
  includeLight?: boolean;
  withGroup?: boolean;
  addToGroup?: boolean;
  groupZoneId?: string;
  lightZoneId?: string | null;
  mode?: FurniturePlanItemV11["semanticPlacement"]["mode"];
  position?: { xCm: number; yCm: number } | null;
  orientation?: number | null;
  relationships?: FurniturePlanItemV11["semanticPlacement"]["relationships"];
  extraLights?: number;
  dimensions?: { widthCm: number | null; depthCm: number | null; heightCm: number | null } | null;
  marketingFields?: boolean;
  lightingColor?: string | null;
  lightingMaterial?: string | null;
  lightingStyle?: string | null;
  lightingTexture?: string;
} = {}) {
  const roomType = options.roomType ?? "living_room";
  const composition = resolveLivingRoomComposition({ geometry, mustHaveItems: ["sofa"], roomFunctions: [] });
  const sofa = composition.plan.items.find((item) => item.semanticPlacement.role === "PRIMARY_SEATING");
  assert.ok(sofa);
  const light = lightingItem({
    itemId: "lighting-item-1",
    semanticRole: options.role,
    category: options.category,
    subtype: options.subtype,
    zoneId: options.lightZoneId,
    mode: options.mode,
    position: options.position,
    orientation: options.orientation,
    relationships: options.relationships,
  });
  const lights = [light];
  for (let index = 0; index < (options.extraLights ?? 0); index += 1) {
    lights.push(lightingItem({ itemId: `lighting-item-${index + 2}`, semanticRole: index % 2 ? "AMBIENT_LIGHTING" : "TASK_LIGHTING" }));
  }
  const plan = { ...composition.plan, items: options.includeLight === false ? [...composition.plan.items] : [...composition.plan.items, ...lights] };
  const group = {
    ...composition.group,
    zoneId: options.groupZoneId === undefined ? composition.group.zoneId : options.groupZoneId,
    dependentItemIds: options.addToGroup && options.includeLight !== false
      ? [...composition.group.dependentItemIds, ...lights.map((item) => item.id)]
      : [...composition.group.dependentItemIds],
  };
  const itemMetadataByPlanId = Object.fromEntries(plan.items.map((item) => {
    const isLighting = item.id.startsWith("lighting-item");
    const baseCatalog = catalog(item.id, isLighting ? options.dimensions ?? null : null);
    const itemCatalog = isLighting ? {
      ...baseCatalog,
      normalizedColor: options.lightingColor === undefined ? baseCatalog.normalizedColor : options.lightingColor,
      normalizedMaterial: options.lightingMaterial === undefined ? baseCatalog.normalizedMaterial : options.lightingMaterial,
      normalizedStyle: options.lightingStyle === undefined ? baseCatalog.normalizedStyle : options.lightingStyle,
    } : baseCatalog;
    const catalogMetadata = options.marketingFields && item.id.startsWith("lighting-item")
      ? Object.assign(itemCatalog, {
        productTitle: "Perfect 3000K Reading Lamp",
        roomaiDescription: "Bright whole-room ambient chandelier with professional task illumination.",
        vendorName: "Marketing Vendor",
        productUrl: "https://example.invalid/lamp",
        roomaiSellingPrice: 99999,
      })
      : itemCatalog;
    const furnitureAttributes = isLighting && options.lightingTexture
      ? normalizeFurnitureAttributes({ seatingCapacity: null }, { normalizedAttributes: { "fabric texture": options.lightingTexture } })
      : undefined;
    return [item.id, { catalog: catalogMetadata, ...(furnitureAttributes ? { furnitureAttributes } : {}) }];
  }));
  const zones = [...composition.zones];
  const spatialReport = validateSpatialPlan(plan, geometry, [], zones);
  const context = createAestheticDesignContext({
    designId: "lighting-design",
    project: { id: "lighting-project", room_type: roomType },
    preferences: null,
    plan,
    geometry,
    openings: [],
    zones,
    groups: options.withGroup === false ? [] : [group],
    spatialReport,
    itemMetadataByPlanId,
  });
  return { context, lightingIds: lights.map((item) => item.id), group, sofaId: sofa.id };
}

function lightingFindings(report: ReturnType<typeof evaluateLightingIntelligence>) {
  return report.findings.filter((finding) => finding.target.dimension === "lighting_composition");
}

function observationOf(finding: ReturnType<typeof evaluateLightingIntelligence>["findings"][number]) {
  const observation = finding.supportingEvidence[0]?.observation;
  assert.ok(observation);
  assert.equal(observation.kind, "lighting_composition_structure");
  if (observation.kind !== "lighting_composition_structure") assert.fail("expected lighting structure evidence");
  return observation;
}

test("no lighting roles yields no findings and NOT_APPLICABLE coverage", () => {
  const report = evaluateLightingIntelligence(makeContext({ includeLight: false }).context);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.relationships, []);
  assert.equal(report.coverage.find((entry) => entry.dimension === "lighting_composition")?.status, "NOT_APPLICABLE");
});

test("TASK_LIGHTING records intended role without claiming task performance", () => {
  const report = evaluateLightingIntelligence(makeContext({ role: "TASK_LIGHTING" }).context);
  const finding = lightingFindings(report)[0];
  const observation = observationOf(finding);
  assert.equal(observation.semanticRole, "TASK_LIGHTING");
  assert.equal(observation.assessmentStatus, "EVIDENCE_RECORDED");
  assert.ok(observation.unavailableAssessments.includes("TASK_PERFORMANCE"));
  assert.ok(observation.unavailableAssessments.includes("PHOTOMETRIC_ADEQUACY"));
  assert.equal(finding.coverage.status, "NOT_EVALUATED");
  assert.equal(finding.compatibility, "unknown");
  assert.equal(finding.impact, "NEUTRAL");
  assert.deepEqual(report.issues, []);
});

test("AMBIENT_LIGHTING does not imply sufficient whole-room illumination", () => {
  const report = evaluateLightingIntelligence(makeContext({ role: "AMBIENT_LIGHTING" }).context);
  const observation = observationOf(lightingFindings(report)[0]);
  assert.equal(observation.semanticRole, "AMBIENT_LIGHTING");
  assert.ok(observation.unavailableAssessments.includes("AMBIENT_COVERAGE"));
  assert.ok(observation.unavailableAssessments.includes("BRIGHTNESS_LEVEL"));
  assert.equal(lightingFindings(report)[0].impact, "NEUTRAL");
  assert.equal(report.strengths.length, 0);
});

test("unsupported role is not upgraded from category or subtype text", () => {
  const context = makeContext({ role: "STORAGE", category: "floor_lamp", subtype: "desk lamp" }).context;
  const report = evaluateLightingIntelligence(context);
  assert.deepEqual(lightingFindings(report), []);
  assert.equal(report.coverage.find((entry) => entry.dimension === "lighting_composition")?.status, "NOT_APPLICABLE");
});

test("explicit group membership and zone association are recorded without quality judgment", () => {
  const { context, group, lightingIds } = makeContext({ addToGroup: true });
  const report = evaluateLightingIntelligence(context);
  const observation = observationOf(lightingFindings(report)[0]);
  assert.equal(observation.lightingItemId, lightingIds[0]);
  assert.deepEqual(observation.groupMemberships, [{
    groupId: group.id, groupType: group.type, groupZoneId: group.zoneId, hierarchyRoles: ["DEPENDENT"],
  }]);
  assert.equal(observation.zoneId, "primary-seating");
  assert.equal(observation.zoneResolutionStatus, "RESOLVED");
  assert.equal(observation.zone?.type, "PRIMARY_SEATING");
  assert.equal(observation.assessmentStatus, "EVIDENCE_RECORDED");
});

test("missing group and zone preserve explicit role evidence without inferring associations", () => {
  const { context } = makeContext({ withGroup: false, lightZoneId: null });
  const report = evaluateLightingIntelligence(context);
  const observation = observationOf(lightingFindings(report)[0]);
  assert.deepEqual(observation.groupMemberships, []);
  assert.equal(observation.zoneResolutionStatus, "NO_ZONE_REFERENCE");
  assert.deepEqual(observation.explicitRelationships, []);
  assert.ok(report.diagnostics.some((diagnostic) => diagnostic.code === "lighting.explicit_association_unavailable"));
});

test("unresolved and ambiguous zone references are represented distinctly", () => {
  const unresolvedBase = makeContext();
  const unresolved = aestheticDesignContextSchema.parse({
    ...unresolvedBase.context,
    items: unresolvedBase.context.items.map((item) => item.itemId === unresolvedBase.lightingIds[0]
      ? { ...item, placement: { ...item.placement, zoneId: "missing-zone" } } : item),
  });
  assert.equal(observationOf(lightingFindings(evaluateLightingIntelligence(unresolved))[0]).zoneResolutionStatus, "UNRESOLVED");

  const ambiguous = aestheticDesignContextSchema.parse({
    ...unresolvedBase.context,
    zones: [...unresolvedBase.context.zones, { ...unresolvedBase.context.zones[0], type: "READING" }],
  });
  assert.equal(observationOf(lightingFindings(evaluateLightingIntelligence(ambiguous))[0]).zoneResolutionStatus, "AMBIGUOUS");
});

test("placement mode, position, orientation, and plan subtype are preserved exactly", () => {
  const { context } = makeContext({ role: "TASK_LIGHTING", category: "desk_lamp", subtype: "adjustable task lamp", mode: "NEAR_WALL", position: { xCm: 45, yCm: 80 }, orientation: 237 });
  const observation = observationOf(lightingFindings(evaluateLightingIntelligence(context))[0]);
  assert.equal(observation.planCategory, "desk_lamp");
  assert.equal(observation.planSubtype, "adjustable task lamp");
  assert.deepEqual(observation.placement, { mode: "NEAR_WALL", approximatePosition: { xCm: 45, yCm: 80 }, preferredOrientationDegrees: 237 });
  assert.equal(observation.unavailableAssessments.includes("VERTICAL_RELATIONSHIP"), true);
});

test("explicit incoming and outgoing semantic links are recorded, not interpreted as adequate lighting", () => {
  const base = makeContext({ withGroup: false });
  const context = aestheticDesignContextSchema.parse({
    ...base.context,
    items: base.context.items.map((item) => {
      if (item.itemId === base.lightingIds[0]) return { ...item, placement: { ...item.placement, relationships: [{ type: "FACES", targetItemId: base.sofaId }] } };
      if (item.itemId === base.sofaId) return { ...item, placement: { ...item.placement, relationships: [{ type: "GROUPED_WITH", targetItemId: base.lightingIds[0] }] } };
      return item;
    }),
  });
  const observation = observationOf(lightingFindings(evaluateLightingIntelligence(context))[0]);
  assert.deepEqual(observation.explicitRelationships, [
    { direction: "INCOMING", sourceItemId: base.sofaId, relationshipType: "GROUPED_WITH", targetItemId: base.lightingIds[0] },
    { direction: "OUTGOING", sourceItemId: base.lightingIds[0], relationshipType: "FACES", targetItemId: base.sofaId },
  ]);
  assert.deepEqual(evaluateLightingIntelligence(context).relationships, []);
});

test("nearby ungrouped light is not automatically related to sofa coordinates", () => {
  const base = makeContext({ withGroup: false });
  const sofa = base.context.items.find((item) => item.itemId === base.sofaId);
  assert.ok(sofa?.placement.approximatePosition);
  const context = aestheticDesignContextSchema.parse({
    ...base.context,
    items: base.context.items.map((item) => item.itemId === base.lightingIds[0]
      ? { ...item, placement: { ...item.placement, zoneId: null, approximatePosition: { ...sofa.placement.approximatePosition } } }
      : item),
  });
  const observation = observationOf(lightingFindings(evaluateLightingIntelligence(context))[0]);
  assert.deepEqual(observation.groupMemberships, []);
  assert.deepEqual(observation.explicitRelationships, []);
  assert.deepEqual(observation.placement.approximatePosition, sofa.placement.approximatePosition);
});

test("multiple lights are independently inventoried in canonical item-ID order", () => {
  const { context, lightingIds } = makeContext({ extraLights: 2, addToGroup: true });
  const report = evaluateLightingIntelligence(context);
  assert.deepEqual(lightingFindings(report).map((finding) => finding.itemIds[0]), [...lightingIds].sort());
  assert.equal(new Set(lightingFindings(report).map((finding) => finding.findingId)).size, lightingIds.length);
  assert.equal(report.relationships.length, 0);
});

test("different room types do not invent room-specific adequacy rules", () => {
  for (const roomType of ["living_room", "family_room", "dining_room", "bedroom", "home_office"] as const) {
    const report = evaluateLightingIntelligence(makeContext({ roomType, role: "TASK_LIGHTING" }).context);
    assert.equal(lightingFindings(report).length, 1);
    assert.equal(lightingFindings(report)[0].coverage.status, "NOT_EVALUATED");
    assert.equal(lightingFindings(report)[0].impact, "NEUTRAL");
  }
});

test("catalog dimensions are available only as B.2-owned metadata and are not scored by B.6", () => {
  const context = makeContext({ dimensions: { widthCm: 40, depthCm: 40, heightCm: 160 } }).context;
  const item = context.items.find((entry) => entry.semanticRole === "TASK_LIGHTING");
  assert.ok(item);
  assert.deepEqual(item.metadata.catalogMeasurements, { widthCm: 40, depthCm: 40, heightCm: 160 });
  const finding = lightingFindings(evaluateLightingIntelligence(context))[0];
  assert.equal(finding.target.dimension, "lighting_composition");
  assert.equal(finding.compatibility, "unknown");
  assert.equal(finding.impact, "NEUTRAL");
  assert.equal(finding.recommendationCategory, null);
  assert.ok(observationOf(finding).unavailableAssessments.includes("FIXTURE_SCALE_RELATIONSHIP"));
});

test("no photometric or mounting-performance fields are fabricated from plan or catalog data", () => {
  const report = evaluateLightingIntelligence(makeContext({ role: "TASK_LIGHTING", dimensions: { widthCm: 40, depthCm: 40, heightCm: 160 } }).context);
  const observation = observationOf(lightingFindings(report)[0]);
  assert.ok(observation.unavailableAssessments.includes("FIXTURE_MOUNTING_TYPE"));
  assert.ok(observation.unavailableAssessments.includes("FIXTURE_TYPE_CLASSIFICATION"));
  assert.ok(observation.unavailableAssessments.includes("LIGHT_DIRECTION"));
  assert.ok(observation.unavailableAssessments.includes("DIMMABILITY"));
  for (const unavailable of ["PHOTOMETRIC_ADEQUACY", "BRIGHTNESS_LEVEL", "COLOR_TEMPERATURE", "CRI_QUALITY", "BEAM_COVERAGE", "VERTICAL_RELATIONSHIP", "TASK_PERFORMANCE", "AMBIENT_COVERAGE"]) {
    assert.ok(observation.unavailableAssessments.includes(unavailable as typeof observation.unavailableAssessments[number]));
  }
  assert.equal("lumens" in observation, false);
  assert.equal("lux" in observation, false);
  assert.equal("kelvin" in observation, false);
  assert.equal("mountingHeightCm" in observation, false);
  assert.equal("brightnessAdequate" in observation, false);
});

test("marketing and commercial metadata cannot create lighting capability claims", () => {
  const baseline = evaluateLightingIntelligence(makeContext({}).context);
  const misleading = evaluateLightingIntelligence(makeContext({ includeLight: true, marketingFields: true }).context);
  assert.deepEqual(lightingFindings(misleading), lightingFindings(baseline));
});

test("B.3-owned fixture color, material, style, and texture do not change B.6 structure", () => {
  const baseline = evaluateLightingIntelligence(makeContext({ addToGroup: true, lightingColor: "cream", lightingMaterial: "metal", lightingStyle: "modern", lightingTexture: "velvet" }).context);
  const changed = evaluateLightingIntelligence(makeContext({ addToGroup: true, lightingColor: "blue", lightingMaterial: "oak", lightingStyle: "industrial", lightingTexture: "chenille" }).context);
  assert.deepEqual(lightingFindings(changed), lightingFindings(baseline));
});

test("B.2/B.3/B.4/B.5 domains remain untouched and no P0/P1 findings are emitted", () => {
  const report = evaluateLightingIntelligence(makeContext({ addToGroup: true, role: "AMBIENT_LIGHTING" }).context);
  assert.ok(lightingFindings(report).every((finding) => finding.target.dimension === "lighting_composition"));
  assert.ok(report.findings.every((finding) => finding.priority === "P3"));
  assert.ok(report.findings.every((finding) => finding.impact === "NEUTRAL"));
  for (const dimension of ["scale_proportion", "visual_weight", "color_harmony", "material_harmony", "texture_harmony", "composition", "rug_zone_coherence"] as const) {
    assert.equal(report.coverage.find((entry) => entry.dimension === dimension)?.status, "NOT_EVALUATED");
    assert.equal(report.findings.some((finding) => finding.target.dimension === dimension), false);
  }
  assert.deepEqual(report.strengths, []);
  assert.deepEqual(report.issues, []);
  assert.equal(report.findings.every((finding) => finding.recommendationCategory === null), true);
});

test("B.1 contract binds e10a_plan lighting evidence to item/group subjects and NOT_EVALUATED neutral finding", () => {
  const report = evaluateLightingIntelligence(makeContext({ addToGroup: true }).context);
  const finding = lightingFindings(report)[0];
  const evidence = finding.supportingEvidence[0];
  assert.equal(evidence.source, "e10a_plan");
  assert.equal(aestheticFindingSchema.safeParse({ ...finding, supportingEvidence: [{ ...evidence, source: "normalized_attributes" }] }).success, false);
  assert.equal(aestheticFindingSchema.safeParse({ ...finding, compatibility: "compatible", impact: "POSITIVE" }).success, false);
  assert.equal(aestheticFindingSchema.safeParse({ ...finding, coverage: { status: "EVALUATED" } }).success, false);
  assert.equal(aestheticFindingSchema.safeParse({ ...finding, subjects: [{ kind: "ITEM", id: finding.itemIds[0] }] }).success, false);
  assert.equal(aestheticEvaluationReportSchema.safeParse(report).success, true);
});

test("duplicate group IDs are rejected instead of silently changing lighting membership", () => {
  const base = makeContext({ addToGroup: true });
  const context = aestheticDesignContextSchema.parse({
    ...base.context,
    groups: [base.context.groups[0], { ...base.context.groups[0], dependentItemIds: [] }],
  });
  assert.throws(() => evaluateLightingIntelligence(context), /LIGHTING_DUPLICATE_GROUP_ID/);
});

test("valid invalid and not-fully-evaluated spatial status remain E.10-A authoritative", () => {
  const base = makeContext({ addToGroup: true }).context;
  for (const status of ["VALID", "INVALID", "NOT_FULLY_EVALUATED"] as const) {
    const context = aestheticDesignContextSchema.parse({
      ...base,
      spatialValidation: { ...base.spatialValidation, status, valid: status === "INVALID" ? false : base.spatialValidation.valid },
    });
    const report = evaluateLightingIntelligence(context);
    assert.equal(report.spatialStatus.status, status);
    assert.equal(report.issues.length, 0);
  }
});

test("lighting finding identity, ordering, repeated evaluation, input immutability, and JSON roundtrip", () => {
  const base = makeContext({ extraLights: 1, addToGroup: true }).context;
  const permuted = aestheticDesignContextSchema.parse({
    ...base,
    items: [...base.items].reverse().map((item) => ({ ...item, placement: { ...item.placement, relationships: [...item.placement.relationships].reverse() } })),
    groups: [...base.groups].reverse(),
  });
  const snapshot = structuredClone(permuted);
  const report = evaluateLightingIntelligence(permuted);
  assert.deepEqual(evaluateLightingIntelligence(permuted), report);
  assert.deepEqual(evaluateLightingIntelligence(base), report);
  assert.deepEqual(permuted, snapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  assert.deepEqual(lightingFindings(report).map((finding) => finding.findingId), [...lightingFindings(report).map((finding) => finding.findingId)].sort());
});