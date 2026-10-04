import assert from "node:assert/strict";
import test from "node:test";

import { createRectangleGeometry } from "@/lib/geometry/templates";
import type { RoomOpening } from "@/lib/geometry/types";
import { resolveLivingRoomComposition } from "@/lib/furniture-planning/role-plan";
import { validateSpatialPlan } from "@/lib/furniture-planning/spatial-validator";
import { evaluateDiningTableChairRelationship } from "./dining-table-chair-relationship";
import { evaluateBedNightstandRelationship } from "./bed-nightstand-relationship";
import { evaluateDeskOfficeChairRelationship } from "./desk-office-chair-relationship";
import { aestheticDesignContextSchema, createAestheticDesignContext } from "./aesthetic-context";
import { aestheticEvaluationReportSchema } from "./aesthetic-contracts";
import { evaluateFurnitureProportions } from "./furniture-proportion";
import type { DesignRole } from "./schema";
import type { CatalogCandidate } from "@/lib/catalog/schema";

const livingProject = { id: "proportion-project", room_type: "living_room" as const };

function catalogWidth(widthCm: number | null) {
  return {
    productId: "catalog-product-id",
    variantId: "catalog-variant-id",
    normalizedStyle: "modern",
    normalizedColor: "cream",
    normalizedMaterial: "linen",
    seatingCapacity: null,
    widthCm,
    depthCm: 90,
    heightCm: 80,
    productTitle: "Vendor names a very wide luxury statement sofa",
    roomaiDescription: "A plush product description claiming room dominance.",
    vendorName: "Proportion Test Vendor",
    roomaiSellingPrice: 9900,
    categoryName: "Living Room",
    furnitureTypeName: "Sofa",
  };
}

function makeLivingContext(options: {
  seatingWidthCm?: number | null;
  rugWidthCm?: number | null;
  roomType?: "living_room" | "family_room" | "bedroom";
  omitGroup?: boolean;
  alterPlan?: (plan: ReturnType<typeof resolveLivingRoomComposition>["plan"], geometry: ReturnType<typeof createRectangleGeometry>, group: ReturnType<typeof resolveLivingRoomComposition>["group"]) => {
    plan: ReturnType<typeof resolveLivingRoomComposition>["plan"];
    groups: ReturnType<typeof resolveLivingRoomComposition>["group"][];
  };
} = {}) {
  const geometry = createRectangleGeometry(800, 500, 250);
  const composition = resolveLivingRoomComposition({ geometry, mustHaveItems: ["sofa"], roomFunctions: [] });
  const sofa = composition.plan.items.find((item) => item.semanticPlacement.role === "PRIMARY_SEATING");
  const rug = composition.plan.items.find((item) => item.semanticPlacement.role === "AREA_RUG");
  assert.ok(sofa && rug);
  const altered = options.alterPlan?.(composition.plan, geometry, composition.group);
  const plan = altered?.plan ?? composition.plan;
  const groups = altered?.groups ?? (options.omitGroup ? [] : [composition.group]);
  const openings: RoomOpening[] = [];
  const zones = composition.zones;
  const spatialReport = validateSpatialPlan(plan, geometry, openings, zones);
  const context = createAestheticDesignContext({
    designId: "proportion-design",
    project: { ...livingProject, room_type: options.roomType ?? "living_room" },
    preferences: null,
    plan,
    geometry,
    openings,
    zones,
    groups,
    spatialReport,
    itemMetadataByPlanId: {
      [sofa.id]: { catalog: catalogWidth(options.seatingWidthCm === undefined ? 240 : options.seatingWidthCm) },
      [rug.id]: { catalog: catalogWidth(options.rugWidthCm === undefined ? 180 : options.rugWidthCm) },
    },
  });
  return { context, plan, geometry, zones, groups, spatialReport, sofaId: sofa.id, rugId: rug.id };
}

function createExplicitPairContext(
  roomType: "dining_room" | "bedroom" | "guest_room" | "home_office",
  firstCategory: string,
  secondCategories: string[],
  secondWidths: Array<number | null> = secondCategories.map(() => 50),
) {
  const geometry = createRectangleGeometry(1000, 700, 250);
  const composition = resolveLivingRoomComposition({ geometry, mustHaveItems: ["sofa"], roomFunctions: [] });
  const primary = composition.plan.items.find((item) => item.semanticPlacement.role === "PRIMARY_SEATING");
  const table = composition.plan.items.find((item) => item.semanticPlacement.role === "COFFEE_TABLE");
  assert.ok(primary && table);
  const relatedIds = secondCategories.map((_, index) => `related-${index + 1}`);
  const anchor = {
    ...primary,
    id: "anchor-item",
    category: firstCategory,
    placement: { ...primary.placement, anchorWallId: null, approximatePosition: { xCm: 500, yCm: 200 } },
    semanticPlacement: {
      ...primary.semanticPlacement,
      role: "STORAGE" as const,
      mode: "FLOATING" as const,
      targetWallId: null,
      relationships: relatedIds.map((targetItemId) => ({ type: "GROUPED_WITH" as const, targetItemId })),
    },
  };
  const related = secondCategories.map((category, index) => ({
    ...table,
    id: relatedIds[index],
    category,
    placement: { ...table.placement, anchorWallId: null, approximatePosition: { xCm: 180 + index * 250, yCm: 450 } },
    semanticPlacement: { ...table.semanticPlacement, role: "SIDE_TABLE" as const, mode: "FLOATING" as const, targetWallId: null, relationships: [] },
  }));
  const plan = { ...composition.plan, roomIntent: "Explicitly grouped proportion evaluator fixture.", items: [anchor, ...related] };
  const spatialReport = validateSpatialPlan(plan, geometry, [], composition.zones);
  const itemMetadataByPlanId = Object.fromEntries([
    [anchor.id, { catalog: catalogWidth(200) }],
    ...related.map((item, index) => [item.id, { catalog: catalogWidth(secondWidths[index]) }]),
  ]);
  const context = createAestheticDesignContext({
    designId: `deferred-${roomType}`, project: { id: `deferred-${roomType}`, room_type: roomType }, preferences: null,
    plan, geometry, openings: [], zones: composition.zones, groups: [], spatialReport, itemMetadataByPlanId,
  });
  return { context, anchorId: anchor.id, relatedIds, spatialReport };
}

function fullCandidate(type: string, dimensions: { widthCm: number | null; depthCm?: number | null; heightCm?: number | null }): CatalogCandidate {
  return {
    productId: `product-${type}`, variantId: `variant-${type}`, countryCode: "US", categoryCode: null, categoryName: null,
    furnitureTypeCode: type, furnitureTypeName: type, productTitle: type, roomaiDescription: null,
    normalizedColor: null, normalizedMaterial: null, normalizedStyle: null, configuration: null, seatingCapacity: null,
    widthCm: dimensions.widthCm, depthCm: dimensions.depthCm ?? 90, heightCm: dimensions.heightCm ?? 75, weightKg: null, currency: "USD",
    roomaiSellingPrice: 100, normalizedAvailability: "in_stock", deliveryText: null, estimatedDeliveryDaysMin: null,
    estimatedDeliveryDaysMax: null, vendorDataCheckedAt: null, roomaiPriceCalculatedAt: null, vendorName: "test",
    productUrl: "https://example.test/product", primaryImageUrl: null,
  };
}

function role(roleId: string, furnitureTypeCode: string): DesignRole {
  return { roleId, furnitureTypeCode, required: true, approximatePosition: null,
    sizeRange: { widthMinCm: 1, widthMaxCm: 1000, depthMinCm: 1, depthMaxCm: 1000, heightMinCm: 1, heightMaxCm: 1000 } };
}

test("related sofa/rug ratio comes from the E.10-A primary seating group and emits a validated positive", () => {
  const { context, sofaId, rugId } = makeLivingContext();
  const report = evaluateFurnitureProportions(context);
  assert.equal(context.spatialValidation.violatingItemIds.includes(sofaId), false);
  assert.equal(context.spatialValidation.violatingItemIds.includes(rugId), false);
  assert.equal(report.findings.length, 1);
  assert.equal(report.relationships.length, 1);
  assert.equal(report.relationships[0].type, "sofa_rug");
  const finding = report.findings[0];
  const pairSuffix = [sofaId, rugId].sort().map((itemId) => `${itemId.length}:${itemId}`).join(":");
  assert.equal(finding.findingId, `proportion.sofa_rug:${pairSuffix}`);
  assert.equal(finding.code, "proportion.sofa_rug.compatible");
  assert.equal(finding.target.dimension, "scale_proportion");
  assert.equal(finding.target.kind, "relationship");
  assert.deepEqual(finding.itemIds, [sofaId, rugId].sort());
  assert.equal(finding.compatibility, "compatible");
  assert.equal(finding.impact, "POSITIVE");
  assert.equal(finding.priority, "P3");
  assert.ok(report.strengths.includes(finding.findingId));
  assert.equal(report.coverage.find((entry) => entry.dimension === "scale_proportion")?.status, "EVALUATED");
  const parsed = aestheticEvaluationReportSchema.parse(report);
  assert.deepEqual(parsed.findings[0].supportingEvidence[0].observation, finding.supportingEvidence[0].observation);
  assert.equal(finding.supportingEvidence[0].observation.kind, "furniture_proportion");
  if (finding.supportingEvidence[0].observation.kind === "furniture_proportion") {
    assert.equal(finding.supportingEvidence[0].observation.relationshipType, "sofa_rug");
    assert.equal(finding.supportingEvidence[0].observation.measurements.seatingWidthCm, 240);
    assert.equal(finding.supportingEvidence[0].observation.measurements.rugWidthCm, 180);
    assert.equal(finding.supportingEvidence[0].observation.measurements.rugToSeatingWidthRatio, 0.75);
    assert.deepEqual(finding.supportingEvidence[0].observation.relationshipSources, [{ kind: "E10A_GROUP", groupId: "primary-seating-group" }]);
  }
  assert.equal(report.spatialStatus.status, context.spatialValidation.status);
  assert.equal(report.findings.every((entry) => entry.code.startsWith("proportion.")), true);
  assert.equal(report.findings.some((entry) => entry.code.startsWith("scale.primary_seating")), false);
});

test("existing sofa/rug mixed and incompatible outcomes map to B.1 issues without changing thresholds", () => {
  const mixedContext = makeLivingContext({ seatingWidthCm: 200, rugWidthCm: 120 }).context;
  const mixed = evaluateFurnitureProportions(mixedContext);
  assert.equal(mixed.findings[0].compatibility, "mixed");
  assert.equal(mixed.findings[0].impact, "MINOR_ISSUE");
  assert.equal(mixed.findings[0].priority, "P3");
  assert.ok(mixed.issues.includes(mixed.findings[0].findingId));

  const incompatibleContext = makeLivingContext({ seatingWidthCm: 200, rugWidthCm: 118 }).context;
  const incompatible = evaluateFurnitureProportions(incompatibleContext);
  assert.equal(incompatible.findings[0].compatibility, "incompatible");
  assert.equal(incompatible.findings[0].impact, "MODERATE_ISSUE");
  assert.equal(incompatible.findings[0].priority, "P2");
  assert.ok(incompatible.issues.includes(incompatible.findings[0].findingId));
  assert.equal(aestheticEvaluationReportSchema.safeParse(incompatible).success, true);
});

test("missing seating and rug widths independently produce insufficient evidence", () => {
  for (const options of [{ seatingWidthCm: null, rugWidthCm: 180 }, { seatingWidthCm: 240, rugWidthCm: null }]) {
    const report = evaluateFurnitureProportions(makeLivingContext(options).context);
    const finding = report.findings[0];
    assert.equal(finding.compatibility, "unknown");
    assert.equal(finding.coverage.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(finding.evidenceCompleteness, "partial");
    assert.equal(finding.supportingEvidence[0].observation.kind, "furniture_proportion");
    assert.equal(report.coverage.find((entry) => entry.dimension === "scale_proportion")?.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(aestheticEvaluationReportSchema.safeParse(report).success, true);
  }
});

test("product description, vendor, price, appearance and catalog identity do not supply a missing width", () => {
  const context = makeLivingContext({ seatingWidthCm: null, rugWidthCm: 180 }).context;
  const sofa = context.items.find((item) => item.semanticRole === "PRIMARY_SEATING");
  assert.ok(sofa);
  assert.equal(sofa.metadata.catalogMeasurements?.widthCm, null);
  assert.equal(sofa.metadata.style.status, "KNOWN");
  assert.equal(sofa.metadata.color.status, "KNOWN");
  assert.equal(sofa.metadata.materials.status, "KNOWN");
  assert.equal(sofa.catalogReference?.productId, "catalog-product-id");
  const report = evaluateFurnitureProportions(context);
  assert.equal(report.findings[0].compatibility, "unknown");
  assert.equal(report.findings[0].coverage.status, "INSUFFICIENT_EVIDENCE");
  const serialized = JSON.stringify(report);
  for (const omitted of ["Vendor names a very wide luxury statement sofa", "A plush product description", "Proportion Test Vendor", "9900"]) {
    assert.equal(serialized.includes(omitted), false);
  }
});

test("sofa and rug that merely coexist without group or GROUPED_WITH evidence are not paired", () => {
  const unrelated = makeLivingContext({ omitGroup: true });
  const report = evaluateFurnitureProportions(unrelated.context);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.relationships, []);
  assert.equal(report.coverage.find((entry) => entry.dimension === "scale_proportion")?.status, "NOT_APPLICABLE");
});

test("family rooms are supported, while an explicitly grouped sofa/rug pair in a bedroom is not evaluated", () => {
  const family = evaluateFurnitureProportions(makeLivingContext({ roomType: "family_room" }).context);
  assert.equal(family.findings[0].compatibility, "compatible");

  const bedroom = evaluateFurnitureProportions(makeLivingContext({ roomType: "bedroom" }).context);
  assert.deepEqual(bedroom.findings, []);
  assert.equal(bedroom.relationships.length, 1);
  assert.equal(bedroom.coverage.find((entry) => entry.dimension === "scale_proportion")?.status, "NOT_APPLICABLE");
  assert.ok(bedroom.diagnostics.some((diagnostic) => diagnostic.code === "proportion.sofa_rug.room_type_not_supported"));
});

test("an explicit GROUPED_WITH semantic relationship can establish a pair without a group subject", () => {
  const base = makeLivingContext({ omitGroup: true });
  const context = aestheticDesignContextSchema.parse({
    ...base.context,
    items: base.context.items.map((item) => item.itemId === base.sofaId
      ? { ...item, placement: { ...item.placement, relationships: [{ type: "GROUPED_WITH", targetItemId: base.rugId }] } }
      : item),
  });
  const report = evaluateFurnitureProportions(context);
  assert.equal(report.findings.length, 1);
  const observation = report.findings[0].supportingEvidence[0].observation;
  assert.equal(observation.kind, "furniture_proportion");
  if (observation.kind === "furniture_proportion") {
    assert.deepEqual(observation.relationshipSources, [{ kind: "SEMANTIC_RELATIONSHIP", relationshipType: "GROUPED_WITH" }]);
  }
});

test("multiple rugs are evaluated only against their explicitly shared E.10-A primary seating group", () => {
  const base = makeLivingContext();
  const rug = base.plan.items.find((item) => item.semanticPlacement.role === "AREA_RUG");
  assert.ok(rug);
  const secondRug = { ...rug, id: "area-rug-2", placement: { ...rug.placement, approximatePosition: { xCm: 160, yCm: 250 } } };
  const plan = { ...base.plan, items: [...base.plan.items, secondRug] };
  const group = { ...base.groups[0], secondaryAnchorItemIds: [...base.groups[0].secondaryAnchorItemIds, secondRug.id] };
  const spatialReport = validateSpatialPlan(plan, base.geometry, [], base.zones);
  assert.equal(spatialReport.valid, true);
  const context = createAestheticDesignContext({
    designId: "multiple-rugs", project: livingProject, preferences: null, plan, geometry: base.geometry, openings: [],
    zones: base.zones, groups: [group], spatialReport,
    itemMetadataByPlanId: {
      [base.sofaId]: { catalog: catalogWidth(240) }, [base.rugId]: { catalog: catalogWidth(180) }, [secondRug.id]: { catalog: catalogWidth(null) },
    },
  });
  const report = evaluateFurnitureProportions(context);
  assert.equal(report.findings.length, 2);
  assert.equal(report.relationships.length, 2);
  assert.equal(report.coverage.find((entry) => entry.dimension === "scale_proportion")?.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(report.status, "PARTIALLY_EVALUATED");
  assert.deepEqual(report.evaluatedItemIds, [base.sofaId, base.rugId].sort());
  assert.equal(report.findings.filter((finding) => finding.coverage.status === "EVALUATED").length, 1);
  assert.equal(report.findings.filter((finding) => finding.coverage.status === "INSUFFICIENT_EVIDENCE").length, 1);
  assert.ok(report.findings.every((finding) => finding.itemIds.includes(base.sofaId)));
  assert.ok(report.findings.every((finding) => finding.itemIds.includes(base.rugId) || finding.itemIds.includes(secondRug.id)));
  assert.equal(report.relationships.some((relationship) => relationship.itemIds.includes(base.rugId) && relationship.itemIds.includes(secondRug.id)), false);
});

test("an unrelated spatial violation does not suppress a clean sofa/rug proportion", () => {
  const base = makeLivingContext();
  const coffee = base.plan.items.find((item) => item.semanticPlacement.role === "COFFEE_TABLE");
  assert.ok(coffee);
  const plan = { ...base.plan, items: base.plan.items.map((item) => item.id === coffee.id
    ? { ...item, placement: { ...item.placement, approximatePosition: { xCm: 9000, yCm: 9000 } } } : item) };
  const spatialReport = validateSpatialPlan(plan, base.geometry, [], base.zones);
  assert.equal(spatialReport.valid, false);
  assert.ok(spatialReport.violations.some((violation) => violation.itemIds.includes(coffee.id)));
  assert.equal(spatialReport.violations.some((violation) => violation.itemIds.includes(base.sofaId) || violation.itemIds.includes(base.rugId)), false);
  const context = createAestheticDesignContext({
    designId: "unrelated-spatial-failure", project: livingProject, preferences: null, plan, geometry: base.geometry,
    openings: [], zones: base.zones, groups: base.groups, spatialReport,
    itemMetadataByPlanId: { [base.sofaId]: { catalog: catalogWidth(240) }, [base.rugId]: { catalog: catalogWidth(180) } },
  });
  assert.equal(context.items.find((item) => item.itemId === base.sofaId)?.metadata.catalogMeasurements?.widthCm, 240);
  assert.equal(context.items.find((item) => item.itemId === base.rugId)?.metadata.catalogMeasurements?.widthCm, 180);
  assert.equal(context.spatialValidation.violatingItemIds.includes(base.rugId), false);
  const report = evaluateFurnitureProportions(context);
  assert.equal(report.spatialStatus.status, "INVALID");
  assert.equal(report.findings[0].compatibility, "compatible");
  assert.equal(report.findings[0].coverage.status, "EVALUATED");
});

test("a pair-member spatial violation makes only that pair insufficient", () => {
  const base = makeLivingContext();
  const plan = { ...base.plan, items: base.plan.items.map((item) => item.id === base.rugId
    ? { ...item, placement: { ...item.placement, approximatePosition: { xCm: 9000, yCm: 9000 } } } : item) };
  const spatialReport = validateSpatialPlan(plan, base.geometry, [], base.zones);
  const context = createAestheticDesignContext({
    designId: "pair-spatial-failure", project: livingProject, preferences: null, plan, geometry: base.geometry,
    openings: [], zones: base.zones, groups: base.groups, spatialReport,
    itemMetadataByPlanId: { [base.sofaId]: { catalog: catalogWidth(240) }, [base.rugId]: { catalog: catalogWidth(180) } },
  });
  assert.equal(context.spatialValidation.violatingItemIds.includes(base.rugId), true);
  const report = evaluateFurnitureProportions(context);
  assert.equal(report.spatialStatus.status, spatialReport.status);
  assert.equal(report.findings[0].compatibility, "unknown");
  assert.equal(report.findings[0].coverage.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(report.findings[0].supportingEvidence[0].observation.kind, "furniture_proportion");
  if (report.findings[0].supportingEvidence[0].observation.kind === "furniture_proportion") {
    assert.equal(report.findings[0].supportingEvidence[0].observation.assessmentReason, "PAIR_MEMBER_SPATIAL_VIOLATION");
    assert.equal(report.findings[0].supportingEvidence[0].observation.ruleResult, "compatible");
  }
});

test("NOT_FULLY_EVALUATED room status is preserved while explicit sofa/rug widths remain evaluable", () => {
  const { context, spatialReport } = makeLivingContext();
  assert.equal(spatialReport.status, "NOT_FULLY_EVALUATED");
  const report = evaluateFurnitureProportions(context);
  assert.equal(report.spatialStatus.status, "NOT_FULLY_EVALUATED");
  assert.equal(report.spatialStatus.valid, spatialReport.valid);
  assert.equal(report.findings[0].coverage.status, "EVALUATED");
});

test("explicit dining-table/chair relationship is deferred, not forced into a proportion rule", () => {
  const { context, relatedIds } = createExplicitPairContext("dining_room", "dining_table", ["dining_chair"]);
  const existing = evaluateDiningTableChairRelationship(
    role("table", "dining_table"), fullCandidate("dining_table", { widthCm: 180, heightCm: 75 }),
    role("chair", "dining_chair"), fullCandidate("dining_chair", { widthCm: 50, heightCm: 90 }),
  );
  assert.equal(existing.scaleProportion.compatibility, "compatible");
  assert.ok(existing.scaleProportion.reasons.includes("chair_overall_height_available_but_seat_height_unknown"));
  const report = evaluateFurnitureProportions(context);
  assert.deepEqual(report.findings, []);
  assert.equal(report.relationships[0].type, "dining_table_chair");
  assert.equal(report.relationships[0].itemIds.includes(relatedIds[0]), true);
  assert.equal(report.coverage.find((entry) => entry.dimension === "scale_proportion")?.status, "NOT_EVALUATED");
  assert.equal(report.status, "NOT_EVALUATED");
  assert.ok(report.diagnostics.some((diagnostic) => diagnostic.code === "proportion.dining_table_chair.deferred"));
});

test("two explicitly related nightstands remain separate deferred relationships without a sameness requirement", () => {
  const { context, relatedIds } = createExplicitPairContext("bedroom", "bed", ["nightstand", "nightstand"], [40, 65]);
  const typical = evaluateBedNightstandRelationship(
    role("bed", "bed"), fullCandidate("bed", { widthCm: 165 }),
    role("nightstand", "nightstand"), fullCandidate("nightstand", { widthCm: 40, depthCm: 40 }),
  );
  assert.equal(typical.scaleProportion.compatibility, "compatible");
  const report = evaluateFurnitureProportions(context);
  assert.equal(report.relationships.length, 2);
  assert.equal(report.relationships.every((relationship) => relationship.type === "bed_nightstand"), true);
  assert.deepEqual(report.relationships.map((relationship) => relationship.itemIds).sort(), relatedIds.map((id) => ["anchor-item", id]).sort());
  assert.deepEqual(report.findings, []);
  assert.equal(report.coverage.find((entry) => entry.dimension === "scale_proportion")?.status, "NOT_EVALUATED");
});

test("explicit desk/chair relationship is deferred because existing output is dimension presence, not proportion", () => {
  const { context } = createExplicitPairContext("home_office", "desk", ["office_chair"]);
  const existing = evaluateDeskOfficeChairRelationship(
    role("desk", "desk"), fullCandidate("desk", { widthCm: 140 }),
    role("chair", "office_chair"), fullCandidate("office_chair", { widthCm: 60 }),
  );
  assert.equal(existing.scaleProportion.compatibility, "compatible");
  assert.equal(existing.scaleProportion.reasons.includes("desk_overall_dimensions_available"), true);
  assert.equal(existing.scaleProportion.reasons.includes("office_chair_overall_dimensions_available"), true);
  const report = evaluateFurnitureProportions(context);
  assert.deepEqual(report.findings, []);
  assert.equal(report.relationships[0].type, "desk_office_chair");
  assert.ok(report.diagnostics.some((diagnostic) => diagnostic.code === "proportion.desk_office_chair.deferred"));
});

test("pair identity, findings, report, and input remain invariant to item/group/relationship permutation", () => {
  const base = makeLivingContext();
  const context = aestheticDesignContextSchema.parse({
    ...base.context,
    items: base.context.items.map((item) => ({ ...item, placement: { ...item.placement, relationships: [...item.placement.relationships].reverse() } })).reverse(),
    groups: [...base.context.groups].reverse().map((group) => ({ ...group, itemIds: [...group.itemIds].reverse(), secondaryAnchorItemIds: [...group.secondaryAnchorItemIds].reverse() })),
  });
  const snapshot = structuredClone(context);
  const first = evaluateFurnitureProportions(context);
  const second = evaluateFurnitureProportions(context);
  assert.deepEqual(second, first);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.deepEqual(context, snapshot);
  assert.deepEqual(evaluateFurnitureProportions(aestheticDesignContextSchema.parse({ ...context, items: [...context.items].reverse() })), first);
});