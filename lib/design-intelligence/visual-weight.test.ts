import assert from "node:assert/strict";
import test from "node:test";

import { createRectangleGeometry } from "@/lib/geometry/templates";
import { resolveLivingRoomComposition } from "@/lib/furniture-planning/role-plan";
import { validateSpatialPlan } from "@/lib/furniture-planning/spatial-validator";
import type { FurnitureDesignAttributes } from "./furniture-attributes";
import { createAestheticDesignContext, aestheticDesignContextSchema } from "./aesthetic-context";
import { aestheticEvaluationReportSchema, aestheticVisualWeightObservationSchema } from "./aesthetic-contracts";
import { evaluateItemVisualWeight, evaluateVisualWeight, VISUAL_WEIGHT_UNAVAILABLE_ATTRIBUTES } from "./visual-weight";

const project = { id: "visual-weight-project", room_type: "living_room" as const };
const geometry = createRectangleGeometry(800, 500, 250);
const composition = resolveLivingRoomComposition({ geometry, mustHaveItems: ["sofa"], roomFunctions: [] });

function catalog(options: {
  widthCm?: number | null;
  depthCm?: number | null;
  heightCm?: number | null;
  color?: string | null;
  material?: string | null;
  style?: string | null;
  visualWeight?: "LIGHT" | "MEDIUM" | "HEAVY";
  productId?: string;
  variantId?: string;
  vendorName?: string;
  productTitle?: string;
  roomaiDescription?: string | null;
  roomaiSellingPrice?: number | null;
}) {
  return {
    productId: options.productId ?? "catalog-product-1", variantId: options.variantId ?? "catalog-variant-1",
    normalizedStyle: options.style ?? "modern", normalizedColor: options.color ?? "black",
    normalizedMaterial: options.material ?? "oak", seatingCapacity: null,
    widthCm: options.widthCm === undefined ? 220 : options.widthCm,
    depthCm: options.depthCm === undefined ? 90 : options.depthCm,
    heightCm: options.heightCm === undefined ? 80 : options.heightCm,
    vendorName: options.vendorName ?? "Known Vendor",
    productTitle: options.productTitle ?? "Very heavy solid designer sofa",
    roomaiDescription: options.roomaiDescription === undefined ? "A massive, chunky piece with airy open styling." : options.roomaiDescription,
    roomaiSellingPrice: options.roomaiSellingPrice === undefined ? 12000 : options.roomaiSellingPrice,
  };
}

function makeContext(options: {
  category?: string;
  widthCm?: number | null;
  depthCm?: number | null;
  heightCm?: number | null;
  color?: string | null;
  material?: string | null;
  style?: string | null;
  visualWeight?: "LIGHT" | "MEDIUM" | "HEAVY";
  vendorName?: string;
  productTitle?: string;
  roomaiDescription?: string | null;
  roomaiSellingPrice?: number | null;
  productId?: string;
  variantId?: string;
  attributes?: FurnitureDesignAttributes;
} = {}) {
  const category = options.category;
  const plan = category
    ? { ...composition.plan, items: composition.plan.items.map((item) => item.semanticPlacement.role === "PRIMARY_SEATING"
      ? { ...item, category } : item) }
    : composition.plan;
  const primary = plan.items.find((item) => item.semanticPlacement.role === "PRIMARY_SEATING");
  assert.ok(primary);
  const spatialReport = validateSpatialPlan(plan, geometry, [], composition.zones);
  const itemMetadataByPlanId = {
    [primary.id]: {
      catalog: catalog(options),
      visualWeight: options.visualWeight,
      furnitureAttributes: options.attributes,
    },
  };
  return createAestheticDesignContext({
    designId: "visual-weight-design",
    project,
    preferences: null,
    plan,
    geometry,
    openings: [],
    zones: composition.zones,
    groups: [composition.group],
    spatialReport,
    itemMetadataByPlanId,
  });
}

test("complete dimensions provide supporting evidence but never fabricate visual weight", () => {
  const context = makeContext();
  const item = context.items.find((candidate) => candidate.semanticRole === "PRIMARY_SEATING");
  assert.ok(item);
  const assessment = evaluateItemVisualWeight(item);
  assert.equal(assessment.classification, "UNKNOWN");
  assert.equal(assessment.evidenceStatus, "INSUFFICIENT_EVIDENCE");
  assert.deepEqual(assessment.directFormEvidence, []);
  const dimensions = assessment.supportingEvidence.find((evidence) => evidence.kind === "DIMENSIONS");
  assert.ok(dimensions);
  if (dimensions?.kind === "DIMENSIONS") {
    assert.equal(dimensions.widthCm, 220);
    assert.equal(dimensions.depthCm, 90);
    assert.equal(dimensions.decisive, false);
  }
});

test("normalized material alone is supporting evidence, not LIGHT/MEDIUM/HEAVY", () => {
  const context = makeContext({ widthCm: null, depthCm: null, heightCm: null, material: "steel" });
  const item = context.items.find((candidate) => candidate.semanticRole === "PRIMARY_SEATING");
  assert.ok(item);
  const assessment = evaluateItemVisualWeight(item);
  assert.equal(assessment.classification, "UNKNOWN");
  assert.equal(assessment.directFormEvidence.length, 0);
  const material = assessment.supportingEvidence.find((evidence) => evidence.kind === "MATERIAL");
  assert.ok(material);
  if (material?.kind === "MATERIAL") assert.equal(material.decisive, false);
});

test("dark and light normalized colors remain non-decisive supporting evidence", () => {
  for (const color of ["black", "white"]) {
    const context = makeContext({ widthCm: null, depthCm: null, heightCm: null, color });
    const item = context.items.find((candidate) => candidate.semanticRole === "PRIMARY_SEATING");
    assert.ok(item);
    const assessment = evaluateItemVisualWeight(item);
    assert.equal(assessment.classification, "UNKNOWN");
    const colorEvidence = assessment.supportingEvidence.find((evidence) => evidence.kind === "COLOR");
    assert.ok(colorEvidence);
    if (colorEvidence?.kind === "COLOR") assert.equal(colorEvidence.decisive, false);
  }
});

test("known normalized form attributes are retained as support but do not independently classify weight", () => {
  const furnitureAttributes = {
    seatingCapacity: null, silhouette: "curved", armStyle: "track", backStyle: "low_back", cushionStyle: "loose",
    upholsteryType: "fabric" as const, upholsteryMaterial: "linen", fabricTexture: "linen", tufting: false,
    legBaseStyle: "tapered", exposedWood: true, exposedMetal: false, heightProfile: "low", seatDepthCm: null,
  };
  const context = makeContext({ widthCm: null, depthCm: null, heightCm: null, attributes: furnitureAttributes });
  const item = context.items.find((candidate) => candidate.semanticRole === "PRIMARY_SEATING");
  assert.ok(item);
  const assessment = evaluateItemVisualWeight(item);
  assert.equal(assessment.classification, "UNKNOWN");
  const form = assessment.supportingEvidence.find((evidence) => evidence.kind === "NORMALIZED_FURNITURE_ATTRIBUTES");
  assert.ok(assessment.directFormEvidence.some((evidence) => evidence.attribute === "silhouette" && evidence.value === "curved"));
  assert.ok(assessment.directFormEvidence.some((evidence) => evidence.attribute === "legBaseStyle" && evidence.value === "tapered"));
  assert.equal(assessment.classification, "UNKNOWN");
  assert.ok(form);
  if (form?.kind === "NORMALIZED_FURNITURE_ATTRIBUTES") {
    assert.equal(form.values.silhouette, "curved");
    assert.equal(form.values.legBaseStyle, "tapered");
    assert.equal(form.decisive, false);
  }
});

test("large and small furniture categories do not by themselves determine visual weight", () => {
  const large = makeContext({ category: "sectional", widthCm: 360, depthCm: 180 });
  const small = makeContext({ category: "armchair", widthCm: 70, depthCm: 70 });
  for (const context of [large, small]) {
    const item = context.items.find((candidate) => candidate.semanticRole === "PRIMARY_SEATING");
    assert.ok(item);
    assert.equal(evaluateItemVisualWeight(item).classification, "UNKNOWN");
  }
});

test("unproven caller-supplied visualWeight does not become direct evidence", () => {
  const context = makeContext({ visualWeight: "HEAVY" });
  const item = context.items.find((candidate) => candidate.semanticRole === "PRIMARY_SEATING");
  assert.ok(item);
  assert.equal(item.metadata.visualWeight, "HEAVY");
  const assessment = evaluateItemVisualWeight(item);
  assert.equal(assessment.classification, "UNKNOWN");
  assert.deepEqual(assessment.directFormEvidence, []);
});

test("vendor, product identity, price, title, description, style, color and material do not affect classification", () => {
  const first = makeContext({
    widthCm: null, depthCm: null, heightCm: null,
    vendorName: "Vendor A", productTitle: "Airy glass lightweight sofa", roomaiDescription: "Open, slim, transparent", roomaiSellingPrice: 99,
    style: "minimalist", color: "white", material: "glass",
  });
  const second = makeContext({
    widthCm: null, depthCm: null, heightCm: null,
    vendorName: "Vendor B", productTitle: "Massive solid heavy sofa", roomaiDescription: "Chunky, closed, dense", roomaiSellingPrice: 99999,
    style: "traditional", color: "black", material: "oak",
  });
  const firstItem = first.items.find((candidate) => candidate.semanticRole === "PRIMARY_SEATING");
  const secondItem = second.items.find((candidate) => candidate.semanticRole === "PRIMARY_SEATING");
  assert.ok(firstItem && secondItem);
  const firstAssessment = evaluateItemVisualWeight(firstItem);
  const secondAssessment = evaluateItemVisualWeight(secondItem);
  assert.equal(firstAssessment.classification, "UNKNOWN");
  assert.equal(secondAssessment.classification, "UNKNOWN");
  assert.deepEqual(firstAssessment.directFormEvidence, []);
  assert.deepEqual(secondAssessment.directFormEvidence, []);
  const serialized = JSON.stringify([firstAssessment, secondAssessment]);
  for (const untrusted of ["Vendor A", "Vendor B", "Airy glass lightweight sofa", "Massive solid heavy sofa", "Open, slim, transparent", "Chunky, closed, dense", "99999", "catalog-product-1"]) {
    assert.equal(serialized.includes(untrusted), false);
  }
});

test("catalog product and variant identity do not affect the visual-weight observation", () => {
  const first = makeContext({ widthCm: null, depthCm: null, heightCm: null, productId: "catalog-a", variantId: "variant-a" });
  const second = makeContext({ widthCm: null, depthCm: null, heightCm: null, productId: "catalog-b", variantId: "variant-b" });
  const firstItem = first.items.find((candidate) => candidate.semanticRole === "PRIMARY_SEATING");
  const secondItem = second.items.find((candidate) => candidate.semanticRole === "PRIMARY_SEATING");
  assert.ok(firstItem && secondItem);
  assert.notEqual(firstItem.catalogReference?.productId, secondItem.catalogReference?.productId);
  assert.deepEqual(evaluateItemVisualWeight(firstItem), evaluateItemVisualWeight(secondItem));
});

test("B.1 report carries item observations with insufficient visual-weight coverage and no fabricated findings", () => {
  const context = makeContext();
  const report = evaluateVisualWeight(context);
  const itemObservation = report.items.find((item) => item.itemId === context.items[0].itemId)?.visualWeightEvidence;
  assert.ok(itemObservation);
  assert.equal(itemObservation.classification, "UNKNOWN");
  assert.equal(itemObservation.evidenceStatus, "INSUFFICIENT_EVIDENCE");
  assert.deepEqual(itemObservation.directFormEvidence, []);
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.strengths, []);
  assert.deepEqual(report.issues, []);
  assert.equal(report.coverage.find((entry) => entry.dimension === "visual_weight")?.status, "INSUFFICIENT_EVIDENCE");
  assert.equal(report.status, "NOT_EVALUATED");
  assert.equal(aestheticEvaluationReportSchema.safeParse(report).success, true);
});

test("an empty room plan marks visual weight not applicable rather than creating empty-item issues", () => {
  const plan = { ...composition.plan, roomIntent: "No furniture objects.", items: [] };
  const spatialReport = validateSpatialPlan(plan, geometry, [], composition.zones);
  const context = createAestheticDesignContext({
    designId: "empty-visual-weight", project, preferences: null, plan, geometry, openings: [], zones: composition.zones,
    groups: [], spatialReport,
  });
  const report = evaluateVisualWeight(context);
  assert.deepEqual(report.findings, []);
  assert.equal(report.coverage.find((entry) => entry.dimension === "visual_weight")?.status, "NOT_APPLICABLE");
  assert.deepEqual(report.strengths, []);
  assert.deepEqual(report.issues, []);
});

test("unknown-only visual-weight output remains deterministic, immutable, permutation-invariant and JSON-safe", () => {
  const context = makeContext();
  const snapshot = structuredClone(context);
  const first = evaluateVisualWeight(context);
  const second = evaluateVisualWeight(context);
  assert.deepEqual(second, first);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.deepEqual(context, snapshot);
  const permuted = aestheticDesignContextSchema.parse({ ...context, items: [...context.items].reverse() });
  assert.deepEqual(evaluateVisualWeight(permuted), first);
  assert.equal(first.spatialStatus.status, context.spatialValidation.status);
  assert.equal(first.spatialStatus.valid, context.spatialValidation.valid);
  assert.equal(first.findings.some((finding) => finding.code.startsWith("scale.") || finding.code.startsWith("proportion.")), false);
});

test("B.1 observation schema rejects fabricated HEAVY classification without a visual-weight rule", () => {
  const context = makeContext();
  const item = context.items.find((candidate) => candidate.semanticRole === "PRIMARY_SEATING");
  assert.ok(item);
  const observation = evaluateItemVisualWeight(item);
  assert.equal(aestheticVisualWeightObservationSchema.safeParse({
    ...observation, classification: "HEAVY", evidenceStatus: "EVALUATED",
  }).success, false);
});

test("current structured form fields remain distinct from missing direct visual-mass attributes", () => {
  const context = makeContext({ attributes: {
    seatingCapacity: null, silhouette: "curved", armStyle: null, backStyle: "low_back", cushionStyle: null,
    upholsteryType: null, upholsteryMaterial: null, fabricTexture: null, tufting: null, legBaseStyle: "tapered",
    exposedWood: true, exposedMetal: false, heightProfile: "low", seatDepthCm: null,
  } });
  const item = context.items.find((candidate) => candidate.semanticRole === "PRIMARY_SEATING");
  assert.ok(item);
  const assessment = evaluateItemVisualWeight(item);
  assert.deepEqual(assessment.unavailableEvidence, [...VISUAL_WEIGHT_UNAVAILABLE_ATTRIBUTES]);
  assert.equal(assessment.unavailableEvidence.includes("LEG_EXPOSURE"), true);
  assert.equal(assessment.classification, "UNKNOWN");
});