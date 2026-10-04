import assert from "node:assert/strict";
import test from "node:test";

import { createLShapeGeometry, createRectangleGeometry } from "@/lib/geometry/templates";
import { getPolygonAreaCm2 } from "@/lib/geometry/dimensions";
import { roomGeometrySchema } from "@/lib/geometry/schema";
import type { RoomGeometry } from "@/lib/geometry/types";
import { resolveLivingRoomComposition } from "@/lib/furniture-planning/role-plan";
import { furniturePlanV11Schema } from "@/lib/furniture-planning/semantic-schema";
import { validateSpatialPlan } from "@/lib/furniture-planning/spatial-validator";
import { aestheticSpatialItemSchema, createAestheticDesignContext, aestheticDesignContextSchema } from "./aesthetic-context";
import { aestheticEvaluationReportSchema } from "./aesthetic-contracts";
import { evaluateRoomFurnitureScale, classifyLivingRoomScale, ROOM_SCALE_V1_PRIMARY_CATEGORIES } from "./room-furniture-scale";

const project = { id: "room-project-1", room_type: "living_room" as const };
function createConcaveRoomAtAreaBoundary(notchWidthCm: number): RoomGeometry {
  const base = createRectangleGeometry(600, 500, 250);
  const vertices = [[0, 0], [notchWidthCm, 0], [notchWidthCm, 200], [600, 200], [600, 500], [0, 500]]
    .map(([xCm, yCm], index) => ({ id: `v${index + 1}`, xCm, yCm }));
  return roomGeometrySchema.parse({
    ...base,
    shapeType: "l_shape",
    vertices,
    wallSegments: vertices.map((vertex, index) => ({ id: `wall-${index + 1}`, startVertexId: vertex.id, endVertexId: vertices[(index + 1) % vertices.length].id })),
  });
}
const catalogMetadata = (widthCm: number | null, depthCm: number | null) => ({
  productId: "catalog-item", variantId: "catalog-item-variant", normalizedStyle: "modern", normalizedColor: "cream",
  normalizedMaterial: "linen", seatingCapacity: null, widthCm, depthCm, heightCm: null,
  productTitle: "Oversized luxury designer sofa",
  roomaiDescription: "A plush statement piece for spacious rooms.",
  vendorName: "Example Vendor",
  categoryName: "Living Room",
  furnitureTypeName: "Sofa",
  roomaiSellingPrice: 9000,
});

function makeContext(options: {
  widthCm: number;
  lengthCm: number;
  category: string;
  itemWidthCm: number | null;
  itemDepthCm: number | null;
  includeGroupSeats?: boolean;
  roomType?: "living_room" | "bedroom";
  invalidPosition?: boolean;
}, geometryOverride?: RoomGeometry) {
  const geometry = geometryOverride ?? createRectangleGeometry(options.widthCm, options.lengthCm, 250);
  const composition = resolveLivingRoomComposition({ geometry, mustHaveItems: [options.category], roomFunctions: [] });
  const primary = composition.plan.items.find((item) => item.semanticPlacement.role === "PRIMARY_SEATING");
  assert.ok(primary);
  let plan = composition.plan;
  let groups = [composition.group];
  if (!options.includeGroupSeats) {
    plan = { ...composition.plan, items: [primary] };
    groups = [{ ...composition.group, secondaryAnchorItemIds: [], dependentItemIds: [] }];
  } else if (options.category === "loveseat") {
    plan = { ...composition.plan, items: composition.plan.items.map((item) => item.semanticPlacement.role === "SECONDARY_SEATING"
      ? { ...item, placement: { ...item.placement, approximatePosition: { xCm: item.id === "chairs-1" ? 70 : options.widthCm - 70, yCm: 160 } } }
      : item) };
  }
  if (options.invalidPosition) {
    plan = { ...plan, items: plan.items.map((item) => item.id === primary.id
      ? { ...item, placement: { ...item.placement, approximatePosition: { xCm: options.widthCm + 500, yCm: options.lengthCm + 500 } } }
      : item) };
  }
  const spatialReport = validateSpatialPlan(plan, geometry, [], composition.zones);
  const context = createAestheticDesignContext({
    designId: "scale-test-design", project: { ...project, room_type: options.roomType ?? "living_room" }, preferences: null,
    plan, geometry, openings: [], zones: composition.zones, groups, spatialReport,
    itemMetadataByPlanId: { [primary.id]: { catalog: catalogMetadata(options.itemWidthCm, options.itemDepthCm) } },
  });
  return { context, primaryId: primary.id, geometry, spatialReport, composition, plan, groups };
}

test("compact primary seating with its E.10-A supporting group is appropriate in a small room", () => {
  const { context, primaryId, spatialReport } = makeContext({ widthCm: 400, lengthCm: 400, category: "loveseat", itemWidthCm: 140, itemDepthCm: 80, includeGroupSeats: true });
  assert.equal(spatialReport.valid, true);
  const report = evaluateRoomFurnitureScale(context);
  const finding = report.findings[0];
  assert.equal(finding.itemIds[0], primaryId);
  assert.equal(finding.compatibility, "compatible");
  assert.equal(finding.impact, "POSITIVE");
  assert.equal(finding.code, "scale.primary_seating_scale_appropriate_for_room");
  assert.ok(report.strengths.includes(finding.findingId));
  assert.equal(report.coverage.find((entry) => entry.dimension === "scale_proportion")?.status, "EVALUATED");
  const validatedReport = aestheticEvaluationReportSchema.parse(report);
  assert.equal(finding.supportingEvidence[0].observation.kind, "room_furniture_scale");
  if (finding.supportingEvidence[0].observation.kind === "room_furniture_scale") {
    assert.equal(finding.supportingEvidence[0].observation.roomScale, "SMALL");
    assert.equal(finding.supportingEvidence[0].observation.itemCategory, "loveseat");
    assert.equal(finding.supportingEvidence[0].observation.appliedRule, "GROUP_CONTEXT");
    assert.deepEqual(validatedReport.findings[0].supportingEvidence[0].observation, finding.supportingEvidence[0].observation);
  }
});

test("physical fit alone does not establish aesthetic scale for a small-room sectional", () => {
  const { context, primaryId, spatialReport } = makeContext({ widthCm: 800, lengthCm: 220, category: "sectional", itemWidthCm: 320, itemDepthCm: 180 });
  assert.equal(spatialReport.valid, true);
  assert.equal(spatialReport.physicallyValid, true);
  assert.equal(context.spatialValidation.violatingItemIds.includes(primaryId), false);
  const report = evaluateRoomFurnitureScale(context);
  assert.equal(report.spatialStatus.valid, spatialReport.valid);
  assert.equal(report.findings[0].compatibility, "unknown");
  assert.equal(report.findings[0].impact, "NEUTRAL");
  assert.equal(report.findings[0].code, "scale.primary_seating_room_scale_not_established");
  assert.equal(report.findings[0].coverage.status, "EVALUATED");
  assert.deepEqual(report.issues, []);
  assert.equal(report.findings[0].target.dimension, "scale_proportion");
});

test("measurements outside the E.10-A role envelope do not receive an unsupported room-scale pass or issue", () => {
  const { context } = makeContext({ widthCm: 400, lengthCm: 400, category: "sofa", itemWidthCm: 300, itemDepthCm: 180, includeGroupSeats: true });
  const report = evaluateRoomFurnitureScale(context);
  const finding = report.findings[0];
  assert.equal(finding.coverage.status, "EVALUATED");
  assert.equal(finding.compatibility, "unknown");
  assert.equal(finding.impact, "NEUTRAL");
  assert.deepEqual(report.strengths, []);
  assert.deepEqual(report.issues, []);
  const observation = finding.supportingEvidence[0].observation;
  assert.equal(observation.kind, "room_furniture_scale");
  if (observation.kind === "room_furniture_scale") {
    assert.equal(observation.roleEnvelopeCompatibility, "incompatible");
    assert.ok(observation.roleEnvelopeReasons.includes("candidate_width_far_above_role_range"));
    assert.equal(observation.outcome, "NO_REPOSITORY_BACKED_DEVIATION");
  }
});

test("substantial sofa scale can be appropriate in a large room without requiring a sectional", () => {
  const { context } = makeContext({ widthCm: 600, lengthCm: 400, category: "sofa", itemWidthCm: 220, itemDepthCm: 90, includeGroupSeats: true });
  const report = evaluateRoomFurnitureScale(context);
  assert.equal(report.findings[0].compatibility, "compatible");
  assert.equal(report.findings[0].impact, "POSITIVE");
  assert.ok(report.strengths.includes(report.findings[0].findingId));
  assert.equal(aestheticEvaluationReportSchema.safeParse(report).success, true);
  assert.equal(report.coverage.find((entry) => entry.dimension === "scale_proportion")?.status, "EVALUATED");
  assert.equal(report.findings[0].supportingEvidence[0].observation.kind, "room_furniture_scale");
  if (report.findings[0].supportingEvidence[0].observation.kind === "room_furniture_scale") {
    assert.equal(report.findings[0].supportingEvidence[0].observation.roomScale, "LARGE");
    assert.equal(report.findings[0].supportingEvidence[0].observation.itemCategory, "sofa");
  }
  const sectional = makeContext({ widthCm: 600, lengthCm: 400, category: "sectional", itemWidthCm: 320, itemDepthCm: 180 });
  const sectionalFinding = evaluateRoomFurnitureScale(sectional.context).findings[0];
  assert.equal(sectionalFinding.compatibility, "compatible");
  assert.equal(sectionalFinding.impact, "POSITIVE");
  const sectionalEvidence = sectionalFinding.supportingEvidence[0].observation;
  assert.equal(sectionalEvidence.kind, "room_furniture_scale");
  if (sectionalEvidence.kind === "room_furniture_scale") {
    const sofaEvidence = report.findings[0].supportingEvidence[0].observation;
    assert.equal(sofaEvidence.kind, "room_furniture_scale");
    if (sofaEvidence.kind === "room_furniture_scale") assert.ok(sectionalEvidence.itemToRoomAreaRatio > sofaEvidence.itemToRoomAreaRatio);
  }
});

test("medium-room sofa uses medium composition semantics and never claims a large-room minimum", () => {
  const { context, composition } = makeContext({ widthCm: 500, lengthCm: 400, category: "sofa", itemWidthCm: 220, itemDepthCm: 90, includeGroupSeats: true });
  assert.equal(composition.templateId, "T2");
  const report = evaluateRoomFurnitureScale(context);
  const finding = report.findings[0];
  assert.equal(classifyLivingRoomScale(context.geometry), "MEDIUM");
  assert.equal(finding.compatibility, "compatible");
  assert.equal(finding.impact, "POSITIVE");
  assert.equal(finding.evaluator.ruleId, "primary_seating_room_class_composition");
  assert.match(finding.explanation, /medium-room/);
  assert.doesNotMatch(finding.explanation, /large room|large-room/i);
  const observation = finding.supportingEvidence[0].observation;
  assert.equal(observation.kind, "room_furniture_scale");
  if (observation.kind === "room_furniture_scale") {
    assert.equal(observation.roomScale, "MEDIUM");
    assert.equal(observation.appliedRule, "ROOM_CLASS_COMPOSITION");
    assert.equal("thresholdRatio" in observation, false);
  }
});

test("a lone loveseat is under-scaled in a large room but group-supported loveseat seating can be appropriate", () => {
  const lone = makeContext({ widthCm: 800, lengthCm: 500, category: "loveseat", itemWidthCm: 140, itemDepthCm: 80 });
  const loneFinding = evaluateRoomFurnitureScale(lone.context).findings[0];
  assert.equal(loneFinding.compatibility, "mixed");
  assert.equal(loneFinding.impact, "MODERATE_ISSUE");
  assert.equal(loneFinding.priority, "P2");
  assert.equal(loneFinding.code, "scale.primary_seating_underscaled_for_room");
  const loneReport = evaluateRoomFurnitureScale(lone.context);
  assert.ok(loneReport.issues.includes(loneFinding.findingId));
  const validatedReport = aestheticEvaluationReportSchema.parse(loneReport);
  assert.equal(loneReport.spatialStatus.status, lone.spatialReport.status);
  assert.equal(loneReport.spatialStatus.valid, lone.spatialReport.valid);
  assert.equal(loneReport.coverage.find((entry) => entry.dimension === "scale_proportion")?.status, "EVALUATED");
  const loneEvidence = loneFinding.supportingEvidence[0].observation;
  assert.equal(loneEvidence.kind, "room_furniture_scale");
  if (loneEvidence.kind === "room_furniture_scale") {
    assert.equal(loneEvidence.outcome, "UNDER_SUPPORTED_BY_COMPOSITION");
    assert.equal(loneEvidence.appliedRule, "LARGE_COMPACT_SOLO");
    assert.equal(loneEvidence.roomScale, "LARGE");
    assert.equal(loneEvidence.plannedWidthRangeCm.maximum, 180);
    assert.equal(loneEvidence.supportingItemIds.length, 0);
    assert.deepEqual(validatedReport.findings[0].supportingEvidence[0].observation, loneEvidence);
  }

  const grouped = makeContext({ widthCm: 800, lengthCm: 500, category: "loveseat", itemWidthCm: 140, itemDepthCm: 80, includeGroupSeats: true });
  const groupFinding = evaluateRoomFurnitureScale(grouped.context).findings[0];
  assert.equal(groupFinding.compatibility, "compatible");
  assert.equal(groupFinding.impact, "POSITIVE");
  const evidence = groupFinding.supportingEvidence[0].observation;
  assert.equal(evidence.kind, "room_furniture_scale");
  if (evidence.kind === "room_furniture_scale") {
    assert.equal(evidence.appliedRule, "GROUP_CONTEXT");
    assert.ok(evidence.supportingItemIds.length > 0);
  }

  const invalidSupportPlan = { ...grouped.plan, items: grouped.plan.items.map((item) => item.semanticPlacement.role === "SECONDARY_SEATING"
    ? { ...item, placement: { ...item.placement, approximatePosition: { xCm: 9000, yCm: 9000 } } } : item) };
  const invalidSupportReport = validateSpatialPlan(invalidSupportPlan, grouped.geometry, [], grouped.composition.zones);
  const unsupportedContext = createAestheticDesignContext({
    project, preferences: null, plan: invalidSupportPlan, geometry: grouped.geometry, openings: [],
    zones: grouped.composition.zones, groups: grouped.groups, spatialReport: invalidSupportReport,
    itemMetadataByPlanId: { [grouped.primaryId]: { catalog: catalogMetadata(140, 80) } },
  });
  assert.ok(unsupportedContext.spatialValidation.violatingItemIds.length > 0);
  assert.equal(unsupportedContext.spatialValidation.violatingItemIds.includes(grouped.primaryId), false);
  assert.equal(evaluateRoomFurnitureScale(unsupportedContext).findings[0].code, "scale.primary_seating_underscaled_for_room");
});

test("missing dimensions produce explicit insufficient scale coverage without inference", () => {
  const { context, primaryId } = makeContext({ widthCm: 800, lengthCm: 500, category: "sofa", itemWidthCm: null, itemDepthCm: 90 });
  assert.equal(context.metadataCoverage.find((entry) => entry.dimension === "scale_proportion")?.status, "UNAVAILABLE");
  const report = evaluateRoomFurnitureScale(context);
  assert.equal(report.findings[0].compatibility, "unknown");
  assert.equal(report.findings[0].coverage.status, "INSUFFICIENT_EVIDENCE");
  assert.deepEqual(report.findings[0].itemIds, [primaryId]);
  assert.equal(report.findings[0].supportingEvidence.length, 0);
  assert.equal(report.coverage.find((entry) => entry.dimension === "scale_proportion")?.status, "INSUFFICIENT_EVIDENCE");
});

test("missing width is not inferred from product name, vendor, price, style, color or material", () => {
  const { context, primaryId } = makeContext({ widthCm: 800, lengthCm: 500, category: "sofa", itemWidthCm: null, itemDepthCm: 90 });
  const item = context.items.find((entry) => entry.itemId === primaryId);
  assert.ok(item);
  assert.equal(item.metadata.catalogMeasurements?.widthCm, null);
  assert.equal(item.metadata.catalogMeasurements?.depthCm, 90);
  assert.equal(item.metadata.style.status, "KNOWN");
  assert.equal(item.metadata.color.status, "KNOWN");
  assert.equal(item.metadata.materials.status, "KNOWN");
  assert.equal(item.catalogReference?.productId, "catalog-item");
  const serializedContext = JSON.stringify(context);
  for (const omitted of ["Oversized luxury designer sofa", "A plush statement piece", "Example Vendor", "9000", "Living Room", "Sofa"]) {
    assert.equal(serializedContext.includes(omitted), false, `context must not copy ${omitted}`);
  }
  const finding = evaluateRoomFurnitureScale(context).findings[0];
  assert.equal(finding.coverage.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(finding.compatibility, "unknown");
  assert.equal(finding.supportingEvidence.length, 0);
});

test("missing depth is not inferred from width or other catalog fields", () => {
  const { context, primaryId } = makeContext({ widthCm: 800, lengthCm: 500, category: "sofa", itemWidthCm: 220, itemDepthCm: null });
  const item = context.items.find((entry) => entry.itemId === primaryId);
  assert.ok(item);
  assert.equal(item.metadata.catalogMeasurements?.widthCm, 220);
  assert.equal(item.metadata.catalogMeasurements?.depthCm, null);
  assert.equal(evaluateRoomFurnitureScale(context).findings[0].coverage.status, "INSUFFICIENT_EVIDENCE");
});

test("nonpositive or nonfinite raw dimensions are sanitized to unknown; B.1 rejects invalid context measurements", () => {
  for (const invalidWidth of [0, -1, Infinity, NaN]) {
    const { context } = makeContext({ widthCm: 800, lengthCm: 500, category: "sofa", itemWidthCm: invalidWidth, itemDepthCm: 90 });
    const item = context.items.find((entry) => entry.semanticRole === "PRIMARY_SEATING");
    assert.ok(item);
    assert.equal(item.metadata.catalogMeasurements?.widthCm, null);
    assert.equal(evaluateRoomFurnitureScale(context).findings[0].coverage.status, "INSUFFICIENT_EVIDENCE");
    for (const invalidContextWidth of [0, -1, Infinity, NaN]) {
      const injected: NonNullable<typeof item> = { ...item, metadata: { ...item.metadata, catalogMeasurements: {
        widthCm: invalidContextWidth, depthCm: 90, heightCm: null,
      } } };
      assert.equal(aestheticSpatialItemSchema.safeParse(injected).success, false);
    }
  }
});

test("a known spatial failure is not restated as an aesthetic overscale finding", () => {
  const { context, primaryId } = makeContext({ widthCm: 800, lengthCm: 220, category: "sectional", itemWidthCm: 320, itemDepthCm: 180, invalidPosition: true });
  assert.ok(context.spatialValidation.violatingItemIds.includes(primaryId));
  const report = evaluateRoomFurnitureScale(context);
  assert.equal(report.spatialStatus.valid, context.spatialValidation.valid);
  assert.equal(report.findings[0].compatibility, "unknown");
  assert.equal(report.findings[0].coverage.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(report.findings[0].code, "scale.primary_seating_spatial_context_unreliable");
});

test("NOT_FULLY_EVALUATED spatial status is preserved while independent scale evidence is evaluated", () => {
  const { context, spatialReport, primaryId } = makeContext({ widthCm: 500, lengthCm: 400, category: "sofa", itemWidthCm: 220, itemDepthCm: 90, includeGroupSeats: true });
  assert.equal(spatialReport.status, "NOT_FULLY_EVALUATED");
  assert.equal(context.spatialValidation.status, "NOT_FULLY_EVALUATED");
  assert.equal(context.spatialValidation.valid, spatialReport.valid);
  const report = evaluateRoomFurnitureScale(context);
  assert.equal(report.spatialStatus.status, "NOT_FULLY_EVALUATED");
  assert.equal(report.spatialStatus.valid, spatialReport.valid);
  assert.equal(report.spatialStatus.physicallyValid, spatialReport.physicallyValid);
  assert.equal(report.spatialStatus.functionallyValid, spatialReport.functionallyValid);
  assert.equal(report.spatialStatus.circulationStatus, spatialReport.circulation.status);
  assert.equal(report.findings[0].itemIds[0], primaryId);
  assert.equal(report.findings[0].coverage.status, "EVALUATED");
  assert.equal(report.findings[0].impact, "POSITIVE");
  assert.ok(report.strengths.includes(report.findings[0].findingId));
  assert.equal(report.status, "PARTIALLY_EVALUATED");
});

test("non-rectangular classification uses actual polygon area, not bounding-box area", () => {
  const geometry = createLShapeGeometry(600, 350, 250);
  const actualArea = getPolygonAreaCm2(geometry.vertices);
  const boundingBoxArea = 600 * 350;
  assert.ok(actualArea < 180000);
  assert.ok(boundingBoxArea > 180000);
  assert.equal(classifyLivingRoomScale(geometry), "SMALL");
  const { context } = makeContext({ widthCm: 600, lengthCm: 350, category: "sofa", itemWidthCm: 220, itemDepthCm: 90 }, geometry);
  const evidence = evaluateRoomFurnitureScale(context).findings[0].supportingEvidence[0].observation;
  assert.equal(evidence.kind, "room_furniture_scale");
  if (evidence.kind === "room_furniture_scale") assert.equal(evidence.roomAreaCm2, getPolygonAreaCm2(context.geometry.vertices));
});

test("room classification matches the E.10-A small and large policy boundaries", () => {
  assert.equal(classifyLivingRoomScale(createRectangleGeometry(450, 399.99, 250)), "SMALL");
  assert.equal(classifyLivingRoomScale(createRectangleGeometry(450, 400, 250)), "MEDIUM");
  assert.equal(classifyLivingRoomScale(createRectangleGeometry(450, 400.01, 250)), "MEDIUM");
  assert.equal(classifyLivingRoomScale(createRectangleGeometry(600, 349.99, 250)), "SMALL");
  assert.equal(classifyLivingRoomScale(createRectangleGeometry(600, 350, 250)), "MEDIUM");
  assert.equal(classifyLivingRoomScale(createRectangleGeometry(600, 350.01, 250)), "MEDIUM");
  assert.equal(classifyLivingRoomScale(createRectangleGeometry(600, 399.99, 250)), "MEDIUM");
  assert.equal(classifyLivingRoomScale(createRectangleGeometry(600, 400, 250)), "LARGE");
  assert.equal(classifyLivingRoomScale(createRectangleGeometry(600, 400.01, 250)), "LARGE");
  assert.equal(classifyLivingRoomScale(createRectangleGeometry(599.99, 400, 250)), "MEDIUM");
  assert.equal(classifyLivingRoomScale(createRectangleGeometry(600.01, 400, 250)), "LARGE");
  assert.equal(classifyLivingRoomScale(createRectangleGeometry(700, 399.99, 250)), "MEDIUM");
  assert.equal(classifyLivingRoomScale(createRectangleGeometry(700, 400, 250)), "LARGE");
  assert.equal(classifyLivingRoomScale(createRectangleGeometry(700, 400.01, 250)), "LARGE");
  assert.equal(classifyLivingRoomScale(createRectangleGeometry(400.1, 599.99, 250)), "MEDIUM");
  assert.equal(classifyLivingRoomScale(createRectangleGeometry(400.1, 600, 250)), "LARGE");
  assert.equal(classifyLivingRoomScale(createRectangleGeometry(400.1, 600.01, 250)), "LARGE");
  assert.equal(classifyLivingRoomScale(createLShapeGeometry(600, 467.5, 250)), "MEDIUM");
  assert.equal(classifyLivingRoomScale(createLShapeGeometry(600, 467.52, 250)), "LARGE");
  const concaveBelow = createConcaveRoomAtAreaBoundary(299.99);
  const concaveAt = createConcaveRoomAtAreaBoundary(300);
  const concaveAbove = createConcaveRoomAtAreaBoundary(300.01);
  assert.equal(getPolygonAreaCm2(concaveBelow.vertices), 239998);
  assert.equal(getPolygonAreaCm2(concaveAt.vertices), 240000);
  assert.equal(getPolygonAreaCm2(concaveAbove.vertices), 240002);
  assert.equal(classifyLivingRoomScale(concaveBelow), "MEDIUM");
  assert.equal(classifyLivingRoomScale(concaveAt), "LARGE");
  assert.equal(classifyLivingRoomScale(concaveAbove), "LARGE");
});

test("observed room/item ratios are evidence only and never control outcome", () => {
  const smaller = makeContext({ widthCm: 800, lengthCm: 500, category: "sofa", itemWidthCm: 200, itemDepthCm: 90, includeGroupSeats: true });
  const larger = makeContext({ widthCm: 800, lengthCm: 500, category: "sofa", itemWidthCm: 240, itemDepthCm: 100, includeGroupSeats: true });
  const smallerFinding = evaluateRoomFurnitureScale(smaller.context).findings[0];
  const largerFinding = evaluateRoomFurnitureScale(larger.context).findings[0];
  assert.equal(smallerFinding.compatibility, "compatible");
  assert.equal(largerFinding.compatibility, "compatible");
  const smallerEvidence = smallerFinding.supportingEvidence[0].observation;
  const largerEvidence = largerFinding.supportingEvidence[0].observation;
  assert.equal(smallerEvidence.kind, "room_furniture_scale");
  assert.equal(largerEvidence.kind, "room_furniture_scale");
  if (smallerEvidence.kind === "room_furniture_scale" && largerEvidence.kind === "room_furniture_scale") {
    assert.ok(smallerEvidence.itemToRoomAreaRatio < largerEvidence.itemToRoomAreaRatio);
    assert.equal(smallerEvidence.outcome, "APPROPRIATE");
    assert.equal(largerEvidence.outcome, "APPROPRIATE");
  }
  assert.deepEqual(ROOM_SCALE_V1_PRIMARY_CATEGORIES, ["sofa", "sectional", "loveseat", "modular_seating"]);
});

test("other room types and absent primary seating are not evaluated", () => {
  const bedroom = makeContext({ widthCm: 800, lengthCm: 500, category: "sofa", itemWidthCm: 220, itemDepthCm: 90, roomType: "bedroom" });
  const bedroomReport = evaluateRoomFurnitureScale(bedroom.context);
  assert.equal(bedroomReport.coverage.find((entry) => entry.dimension === "scale_proportion")?.status, "NOT_APPLICABLE");
  assert.equal(bedroomReport.findings.length, 0);

  const living = makeContext({ widthCm: 800, lengthCm: 500, category: "sofa", itemWidthCm: 220, itemDepthCm: 90 });
  const withoutPrimary = { ...living.context, items: living.context.items.map((item) => item.itemId === living.primaryId
    ? { ...item, semanticRole: "SECONDARY_SEATING" as const } : item), groups: [] };
  const validated = aestheticDesignContextSchema.parse(withoutPrimary);
  const noSeatReport = evaluateRoomFurnitureScale(validated);
  assert.equal(noSeatReport.coverage.find((entry) => entry.dimension === "scale_proportion")?.status, "NOT_APPLICABLE");
  assert.equal(noSeatReport.findings.length, 0);
});

test("evaluation is deterministic, serializable and leaves geometry/context unchanged", () => {
  const { context, plan, groups, geometry, composition, spatialReport } = makeContext({ widthCm: 800, lengthCm: 500, category: "loveseat", itemWidthCm: 140, itemDepthCm: 80, includeGroupSeats: true });
  const sourceSnapshot = structuredClone({
    items: plan.items.map((item) => ({ id: item.id, role: item.semanticPlacement.role, approximatePosition: item.placement.approximatePosition,
      orientation: item.placement.preferredOrientationDegrees, semanticPlacement: item.semanticPlacement })),
    groups, geometry, zones: composition.zones, spatialReport,
  });
  const snapshot = structuredClone(context);
  const first = evaluateRoomFurnitureScale(context);
  const second = evaluateRoomFurnitureScale(context);
  assert.deepEqual(second, first);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.deepEqual(context, snapshot);
  assert.deepEqual({
    items: plan.items.map((item) => ({ id: item.id, role: item.semanticPlacement.role, approximatePosition: item.placement.approximatePosition,
      orientation: item.placement.preferredOrientationDegrees, semanticPlacement: item.semanticPlacement })),
    groups, geometry, zones: composition.zones, spatialReport,
  }, sourceSnapshot);
  const permuted = aestheticDesignContextSchema.parse({ ...context, items: [...context.items].reverse() });
  assert.deepEqual(evaluateRoomFurnitureScale(permuted), first);
});

test("schema-valid multiple PRIMARY_SEATING items produce canonical findings under permutation", () => {
  const geometry = createRectangleGeometry(1200, 700, 250);
  const composition = resolveLivingRoomComposition({ geometry, mustHaveItems: ["sofa"], roomFunctions: [] });
  const templatePrimary = composition.plan.items.find((item) => item.semanticPlacement.role === "PRIMARY_SEATING");
  assert.ok(templatePrimary);
  const makePrimary = (id: string, xCm: number) => ({
    ...structuredClone(templatePrimary), id,
    placement: { ...templatePrimary.placement, anchorWallId: null, approximatePosition: { xCm, yCm: 350 } },
    semanticPlacement: { ...templatePrimary.semanticPlacement, mode: "FLOATING" as const, targetWallId: null, relationships: [] },
  });
  const plan = { ...composition.plan, items: [makePrimary("primary-a", 300), makePrimary("primary-b", 900)] };
  assert.equal(furniturePlanV11Schema.safeParse(plan).success, true);
  const spatialReport = validateSpatialPlan(plan, geometry, [], composition.zones);
  assert.equal(spatialReport.valid, true);
  const context = createAestheticDesignContext({
    project, preferences: null, plan, geometry, openings: [], zones: composition.zones, groups: [], spatialReport,
    itemMetadataByPlanId: {
      "primary-a": { catalog: catalogMetadata(220, 90) },
      "primary-b": { catalog: catalogMetadata(220, 90) },
    },
  });
  const first = evaluateRoomFurnitureScale(context);
  const permuted = evaluateRoomFurnitureScale(aestheticDesignContextSchema.parse({ ...context, items: [...context.items].reverse() }));
  assert.deepEqual(permuted, first);
  assert.deepEqual(first.findings.map((finding) => finding.findingId), ["room-scale.primary-a", "room-scale.primary-b"]);
});
