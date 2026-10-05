import assert from "node:assert/strict";
import test from "node:test";

import { createRectangleGeometry } from "@/lib/geometry/templates";
import { normalizeFurnitureAttributes } from "./furniture-attributes";
import { aestheticDesignContextSchema, createAestheticDesignContext, type CatalogAestheticMetadata } from "./aesthetic-context";
import { aestheticEvaluationReportSchema, aestheticFindingSchema } from "./aesthetic-contracts";
import { evaluateColorHarmony } from "./color-harmony-evaluation";
import { evaluateFurnitureProportions } from "./furniture-proportion";
import { evaluateMaterialTextureHarmony } from "./material-texture-harmony-evaluation";
import { livingRoomCompositions } from "@/lib/furniture-planning/compositions";
import { generateCompositionRolePlan } from "@/lib/furniture-planning/role-plan";
import { evaluateRugZoneIntelligence } from "./rug-zone-intelligence";
import { validateSpatialPlan } from "@/lib/furniture-planning/spatial-validator";
import type { FurniturePlanItemV11 } from "@/lib/furniture-planning/types";

const geometry = createRectangleGeometry(800, 500, 250);
const project = { id: "rug-zone-project", room_type: "living_room" as const };

function catalog(itemId: string, color: string | null = null, material: string | null = null, dimensions: { widthCm: number | null; depthCm: number | null } = { widthCm: 200, depthCm: 100 }): CatalogAestheticMetadata {
  return {
    productId: `product-${itemId}`, variantId: `variant-${itemId}`, normalizedStyle: null,
    normalizedColor: color, normalizedMaterial: material, seatingCapacity: null,
    widthCm: dimensions.widthCm, depthCm: dimensions.depthCm, heightCm: 80,
  };
}

function makeContext(options: {
  templateId?: string;
  roomType?: "living_room" | "family_room" | "bedroom";
  includeGroup?: boolean;
  rugZoneId?: string | null;
  groupZoneId?: string;
  rugMode?: string;
  rugPosition?: { xCm: number; yCm: number } | null;
  rugOrientation?: number | null;
  rugDimensions?: { widthCm: number | null; depthCm: number | null };
  rugColor?: string | null;
  rugMaterial?: string | null;
  sofaColor?: string | null;
  sofaMaterial?: string | null;
  rugTexture?: string;
  sofaTexture?: string;
  extraRugs?: number;
  attachExtraRugsToGroup?: boolean;
  includeCatalogMarketingFields?: boolean;
} = {}) {
  const template = livingRoomCompositions.find((entry) => entry.id === (options.templateId ?? "T2"));
  assert.ok(template);
  const generatedPlan = generateCompositionRolePlan(template, geometry);
  const planItems = [...generatedPlan.plan.items];
  const rug = planItems.find((item) => item.semanticPlacement.role === "AREA_RUG");
  const sofa = planItems.find((item) => item.semanticPlacement.role === "PRIMARY_SEATING");
  assert.ok(rug && sofa);
  const primaryZone = generatedPlan.zones.find((zone) => zone.id === "primary-seating");
  assert.ok(primaryZone);
  rug.semanticPlacement = {
    ...rug.semanticPlacement,
    mode: (options.rugMode ?? rug.semanticPlacement.mode) as FurniturePlanItemV11["semanticPlacement"]["mode"],
    zoneId: options.rugZoneId === undefined ? primaryZone.id : options.rugZoneId,
  };
  rug.placement = {
    ...rug.placement,
    approximatePosition: options.rugPosition === undefined ? { ...primaryZone.center } : options.rugPosition,
    preferredOrientationDegrees: options.rugOrientation === undefined ? primaryZone.orientationDegrees ?? 0 : options.rugOrientation,
  };
  const rugs = [rug];
  for (let index = 0; index < (options.extraRugs ?? 0); index += 1) {
    const extra = structuredClone(rug);
    extra.id = `extra-rug-${index + 1}`;
    extra.placement = { ...extra.placement, approximatePosition: { xCm: sofa.placement.approximatePosition?.xCm ?? 0, yCm: sofa.placement.approximatePosition?.yCm ?? 0 } };
    rugs.push(extra);
    planItems.push(extra);
  }
  const plan = { ...generatedPlan.plan, items: planItems };
  const primaryGroup = {
    ...generatedPlan.group,
    zoneId: options.groupZoneId === undefined ? generatedPlan.group.zoneId : options.groupZoneId,
    secondaryAnchorItemIds: options.attachExtraRugsToGroup
      ? [...generatedPlan.group.secondaryAnchorItemIds, ...rugs.slice(1).map((item) => item.id)]
      : [...generatedPlan.group.secondaryAnchorItemIds],
  };
  const spatialReport = validateSpatialPlan(plan, geometry, [], generatedPlan.zones);
  const itemMetadataByPlanId = Object.fromEntries(plan.items.map((item) => {
    const itemCatalog = item.id === rug.id
      ? catalog(item.id, options.rugColor ?? null, options.rugMaterial ?? null, options.rugDimensions ?? { widthCm: 180, depthCm: 240 })
      : item.id === sofa.id
        ? catalog(item.id, options.sofaColor ?? null, options.sofaMaterial ?? null, { widthCm: 240, depthCm: 100 })
        : catalog(item.id);
    const metadata = options.includeCatalogMarketingFields && item.id === rug.id
      ? { ...itemCatalog, productTitle: "Lightweight patterned wool rug", roomaiDescription: "A visually quiet rug", vendorName: "Test Vendor", roomaiSellingPrice: 99999, productUrl: "https://example.invalid/rug" }
      : itemCatalog;
    const texture = item.id === rug.id ? options.rugTexture : item.id === sofa.id ? options.sofaTexture : undefined;
    const furnitureAttributes = texture
      ? normalizeFurnitureAttributes({ seatingCapacity: null }, { normalizedAttributes: { "fabric texture": texture, upholstery: "linen" } })
      : undefined;
    return [item.id, { catalog: metadata, ...(furnitureAttributes ? { furnitureAttributes } : {}) }];
  }));
  const context = createAestheticDesignContext({
    designId: `rug-zone-${template.id}`, project: { ...project, room_type: options.roomType ?? "living_room" }, preferences: null,
    plan, geometry, openings: [], zones: generatedPlan.zones,
    groups: options.includeGroup === false ? [] : [primaryGroup],
    spatialReport,
    itemMetadataByPlanId,
  });
  return { context, plan, zones: generatedPlan.zones, group: primaryGroup, rugIds: rugs.map((item) => item.id), sofaId: sofa.id };
}

function rugFindings(report: ReturnType<typeof evaluateRugZoneIntelligence>) {
  return report.findings.filter((finding) => finding.target.dimension === "rug_zone_coherence");
}

function observationOf(finding: ReturnType<typeof evaluateRugZoneIntelligence>["findings"][number]) {
  const observation = finding.supportingEvidence[0]?.observation;
  assert.ok(observation);
  assert.equal(observation.kind, "rug_zone_structure");
  if (observation.kind !== "rug_zone_structure") assert.fail("expected rug-zone structural evidence");
  return observation;
}

test("T1-T6 rugs retain authoritative group, secondary-anchor, zone and CENTERED_IN_ZONE evidence", () => {
  for (const template of livingRoomCompositions) {
    const { context, group, rugIds, zones } = makeContext({ templateId: template.id });
    const report = evaluateRugZoneIntelligence(context);
    const findings = rugFindings(report);
    assert.equal(findings.length, 1, template.id);
    const observation = observationOf(findings[0]);
    assert.equal(observation.rugItemId, rugIds[0]);
    assert.equal(observation.groupId, group.id);
    assert.equal(observation.groupZoneId, group.zoneId);
    assert.equal(observation.rugZoneId, "primary-seating");
    assert.equal(observation.rugGroupRoles.includes("SECONDARY_ANCHOR"), true);
    assert.equal(observation.placement.mode, "CENTERED_IN_ZONE");
    assert.deepEqual(observation.placement.approximatePosition, context.items.find((item) => item.itemId === rugIds[0])?.placement.approximatePosition);
    assert.equal(observation.placement.preferredOrientationDegrees, context.items.find((item) => item.itemId === rugIds[0])?.placement.preferredOrientationDegrees);
    assert.deepEqual(observation.groupZone?.polygon, zones[0].polygon);
    assert.equal(observation.assessmentStatus, "STRUCTURE_RECORDED");
    assert.equal(findings[0].coverage.status, "NOT_EVALUATED");
    assert.equal(findings[0].impact, "NEUTRAL");
    assert.equal(findings[0].compatibility, "unknown");
  }
});

test("PRIMARY_SEATING bootstrap polygon matching the room does not claim rug defines the seating zone", () => {
  const { context } = makeContext();
  const report = evaluateRugZoneIntelligence(context);
  const observation = observationOf(rugFindings(report)[0]);
  assert.deepEqual(observation.groupZone?.polygon, context.geometry.vertices);
  assert.equal(observation.groupZone?.polygonRelationToRoom, "SAME_POLYGON");
  assert.equal(observation.unavailableAssessments.includes("TRUE_ZONE_DEFINITION"), true);
  assert.equal(rugFindings(report)[0].coverage.status, "NOT_EVALUATED");
  assert.equal(rugFindings(report)[0].impact, "NEUTRAL");
  assert.equal(rugFindings(report)[0].priority, "P3");
  assert.equal("definesZone" in observation, false);
});

test("supported family room is applicable; unsupported bedroom is NOT_EVALUATED without pairing", () => {
  const family = evaluateRugZoneIntelligence(makeContext({ roomType: "family_room" }).context);
  assert.equal(rugFindings(family).length, 1);
  assert.equal(family.coverage.find((entry) => entry.dimension === "rug_zone_coherence")?.status, "NOT_EVALUATED");
  const bedroom = evaluateRugZoneIntelligence(makeContext({ roomType: "bedroom" }).context);
  assert.deepEqual(rugFindings(bedroom), []);
  assert.deepEqual(bedroom.relationships, []);
  assert.equal(bedroom.coverage.find((entry) => entry.dimension === "rug_zone_coherence")?.status, "NOT_EVALUATED");
  assert.ok(bedroom.diagnostics.some((entry) => entry.code === "rug_zone.room_type_not_supported"));
});

test("ungrouped rug near sofa is not paired by proximity and is not penalized", () => {
  const base = makeContext({ includeGroup: false });
  const sofaPosition = base.context.items.find((item) => item.itemId === base.sofaId)?.placement.approximatePosition;
  assert.ok(sofaPosition);
  const context = aestheticDesignContextSchema.parse({
    ...base.context,
    items: base.context.items.map((item) => item.semanticRole === "AREA_RUG"
      ? { ...item, placement: { ...item.placement, approximatePosition: { ...sofaPosition } } } : item),
  });
  const { sofaId, rugIds } = base;
  const report = evaluateRugZoneIntelligence(context);
  assert.deepEqual(rugFindings(report), []);
  assert.deepEqual(report.relationships, []);
  assert.equal(report.coverage.find((entry) => entry.dimension === "rug_zone_coherence")?.status, "NOT_EVALUATED");
  assert.ok(report.diagnostics.some((entry) => entry.code === "rug_zone.explicit_group_association_unavailable" && entry.itemIds.includes(rugIds[0])));
  assert.equal(report.issues.length, 0);
  assert.ok(context.items.some((item) => item.itemId === sofaId));
  assert.deepEqual(context.items.find((item) => item.itemId === rugIds[0])?.placement.approximatePosition, sofaPosition);
});

test("a rug with a missing group or rug zone reference is insufficient, never a defect", () => {
  const base = makeContext().context;
  const cases = [
    { context: aestheticDesignContextSchema.parse({ ...base, groups: [{ ...base.groups[0], zoneId: null }] }), status: "GROUP_ZONE_MISSING" },
    { context: aestheticDesignContextSchema.parse({ ...base, items: base.items.map((item) => item.semanticRole === "AREA_RUG" ? { ...item, placement: { ...item.placement, zoneId: null } } : item) }), status: "RUG_ZONE_MISSING" },
    { context: aestheticDesignContextSchema.parse({ ...base, groups: [{ ...base.groups[0], zoneId: "missing-zone" }] }), status: "GROUP_ZONE_UNRESOLVED" },
    { context: aestheticDesignContextSchema.parse({ ...base, items: base.items.map((item) => item.semanticRole === "AREA_RUG" ? { ...item, placement: { ...item.placement, zoneId: "missing-zone" } } : item) }), status: "RUG_ZONE_UNRESOLVED" },
  ] as const;
  for (const { context, status } of cases) {
    const report = evaluateRugZoneIntelligence(context);
    const finding = rugFindings(report)[0];
    assert.ok(finding);
    const observation = observationOf(finding);
    assert.equal(observation.zoneReferenceStatus, status);
    assert.equal(observation.assessmentStatus, "INSUFFICIENT_EVIDENCE");
    assert.equal(finding.coverage.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(finding.compatibility, "unknown");
    assert.equal(finding.impact, "NEUTRAL");
    assert.equal(finding.priority, "P3");
    assert.equal(report.issues.includes(finding.findingId), false);
  }
});

test("different resolved group/rug zones are recorded without claiming mismatch is bad", () => {
  const base = makeContext();
  const secondaryZone = { ...base.zones[0], id: "reading-zone", type: "READING" as const };
  const context = aestheticDesignContextSchema.parse({
    ...base.context,
    zones: [...base.context.zones, secondaryZone],
    groups: [{ ...base.context.groups[0], zoneId: "primary-seating" }],
    items: base.context.items.map((item) => item.semanticRole === "AREA_RUG"
      ? { ...item, placement: { ...item.placement, zoneId: "reading-zone" } } : item),
  });
  const report = evaluateRugZoneIntelligence(context);
  const finding = rugFindings(report)[0];
  const observation = observationOf(finding);
  assert.equal(observation.zoneReferenceStatus, "DIFFERENT_ZONES");
  assert.equal(observation.assessmentStatus, "STRUCTURE_RECORDED");
  assert.equal(finding.coverage.status, "NOT_EVALUATED");
  assert.equal(finding.impact, "NEUTRAL");
  assert.deepEqual(report.issues, []);
});

test("multiple rugs in one group remain separate, with no invented primary rug", () => {
  const { context, rugIds } = makeContext({ extraRugs: 1, attachExtraRugsToGroup: true });
  const report = evaluateRugZoneIntelligence(context);
  assert.equal(rugFindings(report).length, 2);
  assert.deepEqual(rugFindings(report).map((finding) => observationOf(finding).rugItemId), [...rugIds].sort());
  assert.equal(rugFindings(report).every((finding) => finding.target.kind === "dimension"), true);
  assert.equal(rugFindings(report).some((finding) => "primaryRugItemId" in observationOf(finding)), false);
  assert.deepEqual(report.relationships, []);
});

test("rugs in separate groups stay separate with stable group/rug identities", () => {
  const base = makeContext({ extraRugs: 1 });
  const first = base.context.groups[0];
  const second = {
    id: "secondary-rug-group", type: "PRIMARY_SEATING_GROUP", itemIds: [base.sofaId, base.rugIds[1]],
    zoneId: first.zoneId, primaryAnchorItemId: base.sofaId, secondaryAnchorItemIds: [base.rugIds[1]], dependentItemIds: [],
  };
  const context = aestheticDesignContextSchema.parse({ ...base.context, groups: [first, second] });
  const report = evaluateRugZoneIntelligence(context);
  assert.equal(rugFindings(report).length, 2);
  assert.deepEqual(rugFindings(report).map((finding) => finding.findingId), [
    `rug-zone:${first.id.length}:${first.id}:${base.rugIds[0].length}:${base.rugIds[0]}`,
    `rug-zone:${second.id.length}:${second.id}:${base.rugIds[1].length}:${base.rugIds[1]}`,
  ].sort());
  assert.deepEqual(rugFindings(report).map((finding) => observationOf(finding).groupId).sort(), [first.id, second.id].sort());
});

test("duplicate group IDs are rejected rather than collapsing distinct rug memberships", () => {
  const base = makeContext({ extraRugs: 1, attachExtraRugsToGroup: true });
  const duplicate = aestheticDesignContextSchema.parse({
    ...base.context,
    groups: [base.context.groups[0], { ...base.context.groups[0], secondaryAnchorItemIds: [base.rugIds[1]] }],
  });
  assert.throws(() => evaluateRugZoneIntelligence(duplicate), /RUG_ZONE_DUPLICATE_GROUP_ID/);
});

test("missing exact rug measurements remain absent while planning ranges are preserved", () => {
  const report = evaluateRugZoneIntelligence(makeContext({ rugDimensions: { widthCm: null, depthCm: null } }).context);
  const observation = observationOf(rugFindings(report)[0]);
  assert.deepEqual(observation.dimensions.catalogMeasurementsCm, { width: null, depth: null });
  assert.deepEqual(observation.dimensions.planningRangeCm, { widthMin: 180, widthMax: 240, depthMin: 240, depthMax: 300 });
  assert.equal(rugFindings(report)[0].coverage.status, "NOT_EVALUATED");
  assert.equal(rugFindings(report)[0].recommendationCategory, null);
});

test("B.2 owns sofa/rug width proportion; B.5 creates no proportion judgment or recommendation", () => {
  const { context } = makeContext({ sofaColor: "cream", rugColor: "charcoal" });
  const b2 = evaluateFurnitureProportions(context);
  const b5 = evaluateRugZoneIntelligence(context);
  assert.ok(b2.findings.some((finding) => finding.target.dimension === "scale_proportion"));
  assert.equal(rugFindings(b5).length, 1);
  assert.equal(rugFindings(b5).some((finding) => finding.target.dimension === "scale_proportion"), false);
  assert.ok(rugFindings(b5).every((finding) => finding.recommendationCategory === null));
  const observation = observationOf(rugFindings(b5)[0]);
  assert.equal(observation.unavailableAssessments.includes("RUG_FURNITURE_INTERSECTION_QUALITY"), true);
  assert.equal(observation.unavailableAssessments.includes("FOOTPRINT_COVERAGE_JUDGMENT"), true);
});

test("B.3 color/material/texture changes do not affect B.5 structural output", () => {
  const first = makeContext({ rugColor: "cream", sofaColor: "blue", rugMaterial: "wool", sofaMaterial: "oak", rugTexture: "boucle", sofaTexture: "linen" }).context;
  const second = makeContext({ rugColor: "charcoal", sofaColor: "red", rugMaterial: "metal", sofaMaterial: "leather", rugTexture: "chenille", sofaTexture: "velvet" }).context;
  const firstReport = evaluateRugZoneIntelligence(first);
  const secondReport = evaluateRugZoneIntelligence(second);
  assert.notDeepEqual(evaluateColorHarmony(first).findings, evaluateColorHarmony(second).findings);
  assert.notDeepEqual(evaluateMaterialTextureHarmony(first).findings, evaluateMaterialTextureHarmony(second).findings);
  assert.deepEqual(rugFindings(firstReport), rugFindings(secondReport));
  assert.deepEqual(firstReport.relationships, secondReport.relationships);
});

test("known rug and sofa colors do not create a lightness or visual-quietness claim", () => {
  const report = evaluateRugZoneIntelligence(makeContext({ rugColor: "cream", sofaColor: "charcoal" }).context);
  const observation = observationOf(rugFindings(report)[0]);
  assert.ok(observation.unavailableAssessments.includes("LIGHTNESS_RELATIONSHIP"));
  assert.ok(observation.unavailableAssessments.includes("VISUAL_DOMINANCE"));
  assert.equal("rugIsLighter" in observation, false);
  assert.equal("visuallyQuieter" in observation, false);
  assert.equal("dominant" in observation, false);
});

test("visual weight, leg placement, and pattern intensity stay unavailable", () => {
  const base = makeContext().context;
  const heavy = aestheticDesignContextSchema.parse({
    ...base,
    items: base.items.map((item) => item.semanticRole === "AREA_RUG" ? { ...item, metadata: { ...item.metadata, visualWeight: "HEAVY" } } : item),
  });
  const report = evaluateRugZoneIntelligence(heavy);
  const observation = observationOf(rugFindings(report)[0]);
  assert.ok(observation.unavailableAssessments.includes("VISUAL_DOMINANCE"));
  assert.ok(observation.unavailableAssessments.includes("LEG_PLACEMENT"));
  assert.ok(observation.unavailableAssessments.includes("PATTERN_INTENSITY"));
  assert.equal("legLocations" in observation, false);
  assert.equal("pattern" in observation, false);
  assert.equal("visualWeight" in observation, false);
  assert.deepEqual(rugFindings(report), rugFindings(evaluateRugZoneIntelligence(base)));
});

test("title, description, vendor, URL, price, color labels and category do not create B.5 conclusions", () => {
  const baseline = makeContext({ rugColor: "cream", sofaColor: "charcoal" }).context;
  const untrusted = makeContext({ rugColor: "cream", sofaColor: "charcoal", includeCatalogMarketingFields: true }).context;
  assert.deepEqual(rugFindings(evaluateRugZoneIntelligence(untrusted)), rugFindings(evaluateRugZoneIntelligence(baseline)));
});

test("VALID, INVALID, and NOT_FULLY_EVALUATED E.10-A states are preserved without duplicate spatial issues", () => {
  const base = makeContext().context;
  for (const status of ["VALID", "INVALID", "NOT_FULLY_EVALUATED"] as const) {
    const context = aestheticDesignContextSchema.parse({
      ...base,
      spatialValidation: { ...base.spatialValidation, status, valid: status === "INVALID" ? false : base.spatialValidation.valid },
    });
    const report = evaluateRugZoneIntelligence(context);
    assert.equal(report.spatialStatus.status, status);
    assert.equal(report.issues.length, 0);
    assert.equal(rugFindings(report)[0].impact, "NEUTRAL");
    assert.equal(rugFindings(report)[0].priority, "P3");
  }
});

test("stable IDs, canonical output, repeated runs, permutations, immutability, and JSON roundtrip", () => {
  const base = makeContext({ extraRugs: 1, attachExtraRugsToGroup: true }).context;
  const permuted = aestheticDesignContextSchema.parse({
    ...base,
    items: [...base.items].reverse(),
    groups: [...base.groups].reverse().map((group) => ({
      ...group,
      itemIds: [...group.itemIds].reverse(),
      secondaryAnchorItemIds: [...group.secondaryAnchorItemIds].reverse(),
      dependentItemIds: [...group.dependentItemIds].reverse(),
    })),
    zones: [...base.zones].reverse(),
  });
  const snapshot = structuredClone(permuted);
  const report = evaluateRugZoneIntelligence(permuted);
  assert.deepEqual(evaluateRugZoneIntelligence(permuted), report);
  assert.deepEqual(evaluateRugZoneIntelligence(base), report);
  assert.deepEqual(permuted, snapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  assert.equal(aestheticEvaluationReportSchema.safeParse(report).success, true);
  assert.deepEqual(rugFindings(report).map((finding) => finding.findingId), [...rugFindings(report).map((finding) => finding.findingId)].sort());
  assert.deepEqual(report.findings.map((finding) => finding.supportingEvidence[0].evidenceId), [...report.findings.map((finding) => finding.supportingEvidence[0].evidenceId)].sort());
});

test("B.1 contract binds e10a_plan rug evidence to group/rug subjects and neutral unevaluated coverage", () => {
  const report = evaluateRugZoneIntelligence(makeContext().context);
  const finding = rugFindings(report)[0];
  const evidence = finding.supportingEvidence[0];
  assert.equal(evidence.source, "e10a_plan");
  assert.equal(aestheticFindingSchema.safeParse({
    ...finding,
    supportingEvidence: [{ ...evidence, source: "normalized_attributes" }],
  }).success, false);
  assert.equal(aestheticFindingSchema.safeParse({
    ...finding,
    subjects: finding.subjects.map((subject) => subject.kind === "GROUP" ? { ...subject, id: "other-group" } : subject),
  }).success, false);
  assert.equal(aestheticFindingSchema.safeParse({ ...finding, target: { kind: "dimension", dimension: "composition" } }).success, false);
  assert.equal(aestheticFindingSchema.safeParse({ ...finding, impact: "POSITIVE" }).success, false);
  assert.equal(aestheticFindingSchema.safeParse({ ...finding, recommendationCategory: "CHANGE_COLOR" }).success, false);
  assert.equal(aestheticFindingSchema.safeParse({ ...finding, coverage: { status: "EVALUATED" } }).success, false);
});