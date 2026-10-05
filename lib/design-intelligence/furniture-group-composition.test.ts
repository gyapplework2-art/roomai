import assert from "node:assert/strict";
import test from "node:test";

import { createRectangleGeometry } from "@/lib/geometry/templates";
import { aestheticDesignContextSchema, createAestheticDesignContext } from "./aesthetic-context";
import { aestheticEvaluationReportSchema, aestheticFindingSchema } from "./aesthetic-contracts";
import { evaluateFurnitureGroupComposition } from "./furniture-group-composition";
import { livingRoomCompositions } from "@/lib/furniture-planning/compositions";
import { generateCompositionRolePlan } from "@/lib/furniture-planning/role-plan";
import { validateSpatialPlan } from "@/lib/furniture-planning/spatial-validator";

const geometry = createRectangleGeometry(800, 600, 250);
const project = { id: "group-composition-project", room_type: "living_room" as const };
const expectedRoleCounts = {
  T1: { PRIMARY_SEATING: 1, COFFEE_TABLE: 1, AREA_RUG: 1, SECONDARY_SEATING: 2 },
  T2: { PRIMARY_SEATING: 1, COFFEE_TABLE: 1, AREA_RUG: 1, SECONDARY_SEATING: 1 },
  T3: { PRIMARY_SEATING: 1, COFFEE_TABLE: 1, AREA_RUG: 1 },
  T4: { PRIMARY_SEATING: 1, COFFEE_TABLE: 1, AREA_RUG: 1, SECONDARY_SEATING: 2 },
  T5: { PRIMARY_SEATING: 1, COFFEE_TABLE: 1, AREA_RUG: 1, SECONDARY_SEATING: 1 },
  T6: { PRIMARY_SEATING: 1, COFFEE_TABLE: 1, AREA_RUG: 1 },
} as const;

function contextFor(templateId: string, options: { includeGroup?: boolean } = {}) {
  const template = livingRoomCompositions.find((entry) => entry.id === templateId);
  assert.ok(template);
  const generated = generateCompositionRolePlan(template, geometry);
  const spatialReport = validateSpatialPlan(generated.plan, geometry, [], generated.zones);
  return createAestheticDesignContext({
    designId: `group-design-${templateId}`, project, preferences: null, plan: generated.plan,
    geometry, openings: [], zones: generated.zones,
    groups: options.includeGroup === false ? [] : [generated.group], spatialReport,
  });
}

function groupFinding(report: ReturnType<typeof evaluateFurnitureGroupComposition>) {
  const finding = report.findings[0];
  assert.ok(finding);
  const evidence = finding.supportingEvidence[0];
  assert.ok(evidence);
  assert.equal(evidence.observation.kind, "furniture_group_composition");
  if (evidence.observation.kind !== "furniture_group_composition") assert.fail("expected E.10-A group observation");
  return { finding, observation: evidence.observation };
}

test("T1-T6 group inventories preserve exact roles, multiplicities, anchors, and dependents", () => {
  for (const template of livingRoomCompositions) {
    const context = contextFor(template.id);
    const report = evaluateFurnitureGroupComposition(context);
    const { finding, observation } = groupFinding(report);
    const roleCounts: Record<string, number> = {};
    for (const member of observation.members) roleCounts[member.semanticRole ?? "UNKNOWN"] = (roleCounts[member.semanticRole ?? "UNKNOWN"] ?? 0) + 1;
    assert.deepEqual(roleCounts, expectedRoleCounts[template.id]);
    assert.equal(observation.groupId, context.groups[0].id);
    assert.equal(observation.groupType, "PRIMARY_SEATING_GROUP");
    assert.equal(observation.primaryAnchorItemId, "primary-seating-1");
    assert.deepEqual(observation.secondaryAnchorItemIds, ["area-rug-1", "coffee-table-1"]);
    assert.deepEqual(observation.dependentItemIds, template.id === "T1" || template.id === "T4"
      ? ["chairs-1", "chairs-2"]
      : template.id === "T2" ? ["chairs-1"]
        : template.id === "T5" ? ["secondary-seating-1"] : []);
    assert.equal(observation.structuralStatus, "EXPLICIT_HIERARCHY");
    assert.equal(observation.templateConformance, "NOT_EVALUATED");
    assert.equal(observation.visualQuality, "NOT_EVALUATED");
    assert.equal("templateId" in observation, false);
    assert.deepEqual(finding.itemIds, [...context.groups[0].itemIds].sort());
  }
});

test("hierarchy member semantics and explicit directed relationships remain separate evidence", () => {
  const context = contextFor("T1");
  const report = evaluateFurnitureGroupComposition(context);
  const { observation } = groupFinding(report);
  const primary = observation.members.find((member) => member.itemId === observation.primaryAnchorItemId);
  const chair = observation.members.find((member) => member.itemId === "chairs-1");
  assert.deepEqual(primary?.groupRoles, ["PRIMARY_ANCHOR"]);
  assert.deepEqual(chair?.groupRoles, ["DEPENDENT"]);
  assert.deepEqual(chair?.relationships, [
    { type: "ADJACENT_TO", targetItemId: "primary-seating-1" },
    { type: "FACES", targetItemId: "primary-seating-1" },
  ]);
  assert.deepEqual(chair?.relationships.map((relationship) => `${relationship.type}:${relationship.targetItemId}`),
    [...(chair?.relationships ?? [])].map((relationship) => `${relationship.type}:${relationship.targetItemId}`).sort());
  assert.deepEqual(observation.unavailableAssessments, ["TEMPLATE_CONFORMANCE", "VISUAL_BALANCE", "SYMMETRY", "DOMINANCE", "COMPOSITION_QUALITY"]);
});

test("group structure is neutral inventory, not a quality score, issue, strength, or recommendation", () => {
  const report = evaluateFurnitureGroupComposition(contextFor("T1"));
  const { finding } = groupFinding(report);
  assert.equal(finding.target.kind, "dimension");
  assert.equal(finding.target.dimension, "composition");
  assert.equal(finding.priority, "P3");
  assert.equal(finding.impact, "NEUTRAL");
  assert.equal(finding.compatibility, "unknown");
  assert.equal(finding.coverage.status, "EVALUATED");
  assert.equal(finding.recommendationCategory, null);
  assert.deepEqual(report.strengths, []);
  assert.deepEqual(report.issues, []);
  assert.deepEqual(report.relationships, []);
  assert.equal("score" in report, false);
  for (const dimension of ["scale_proportion", "visual_weight", "color_harmony", "material_harmony", "texture_harmony", "visual_balance"] as const) {
    assert.equal(report.coverage.find((entry) => entry.dimension === dimension)?.status, "NOT_EVALUATED");
    assert.equal(report.findings.some((entry) => entry.target.dimension === dimension), false);
  }
  assert.equal(aestheticEvaluationReportSchema.safeParse(report).success, true);
});

test("primary anchor never becomes DOMINANT and B.4 emits no dominance or visual-balance finding", () => {
  const context = contextFor("T1");
  const report = evaluateFurnitureGroupComposition(context);
  const { finding, observation } = groupFinding(report);
  assert.equal(context.items.find((item) => item.itemId === observation.primaryAnchorItemId)?.role, null);
  assert.ok(report.findings.every((entry) => entry.target.dimension === "composition"));
  assert.ok(observation.unavailableAssessments.includes("DOMINANCE"));
  assert.ok(observation.unavailableAssessments.includes("VISUAL_BALANCE"));
  assert.equal(report.coverage.find((entry) => entry.dimension === "visual_balance")?.status, "NOT_EVALUATED");
  assert.equal(finding.impact, "NEUTRAL");
});

test("missing group is NOT_APPLICABLE and does not invent group relationships", () => {
  const report = evaluateFurnitureGroupComposition(contextFor("T1", { includeGroup: false }));
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.relationships, []);
  assert.equal(report.coverage.find((entry) => entry.dimension === "composition")?.status, "NOT_APPLICABLE");
  assert.deepEqual(report.strengths, []);
  assert.deepEqual(report.issues, []);
});

test("partial or unresolved E.10-A hierarchy is inventoried without repair or negative judgment", () => {
  const base = contextFor("T1");
  const partial = aestheticDesignContextSchema.parse({
    ...base,
    groups: [{ ...base.groups[0], primaryAnchorItemId: null, dependentItemIds: ["chairs-1", "orphan-role-reference"] }],
  });
  const snapshot = structuredClone(partial);
  const report = evaluateFurnitureGroupComposition(partial);
  const { finding, observation } = groupFinding(report);
  assert.equal(observation.structuralStatus, "PARTIAL_HIERARCHY");
  assert.equal(observation.primaryAnchorItemId, null);
  assert.deepEqual(observation.dependentItemIds, ["chairs-1", "orphan-role-reference"]);
  assert.equal(finding.impact, "NEUTRAL");
  assert.equal(finding.compatibility, "unknown");
  assert.deepEqual(report.issues, []);
  assert.deepEqual(partial, snapshot);
});

test("group member with no anchor/member role remains visible and makes hierarchy partial", () => {
  const base = contextFor("T2");
  const extra = { ...base.items[0], itemId: "unassigned-group-member", category: "artwork", semanticRole: null };
  const context = aestheticDesignContextSchema.parse({
    ...base,
    items: [...base.items, extra],
    planReference: { ...base.planReference, itemIds: [...base.planReference.itemIds, extra.itemId] },
    groups: [{ ...base.groups[0], itemIds: [...base.groups[0].itemIds, extra.itemId] }],
  });
  const report = evaluateFurnitureGroupComposition(context);
  const { finding, observation } = groupFinding(report);
  const unassigned = observation.members.find((member) => member.itemId === extra.itemId);
  assert.ok(unassigned);
  assert.deepEqual(unassigned.groupRoles, []);
  assert.equal(observation.structuralStatus, "PARTIAL_HIERARCHY");
  assert.ok(finding.itemIds.includes(extra.itemId));
  assert.equal(finding.impact, "NEUTRAL");
  assert.deepEqual(report.issues, []);
});

test("schema rejects group.itemIds references absent from the authoritative plan", () => {
  const base = contextFor("T3");
  const result = aestheticDesignContextSchema.safeParse({
    ...base,
    groups: [{ ...base.groups[0], itemIds: [...base.groups[0].itemIds, "missing-plan-member"] }],
  });
  assert.equal(result.success, false);
  if (!result.success) assert.ok(result.error.issues.some((issue) => issue.path[0] === "groups"));
});

test("schema-valid single-member group follows explicit hierarchy without being called incomplete", () => {
  const base = contextFor("T3");
  const onlyMemberId = base.groups[0].primaryAnchorItemId;
  const context = aestheticDesignContextSchema.parse({
    ...base,
    groups: [{ ...base.groups[0], itemIds: [onlyMemberId], primaryAnchorItemId: onlyMemberId, secondaryAnchorItemIds: [], dependentItemIds: [] }],
  });
  const report = evaluateFurnitureGroupComposition(context);
  const { finding, observation } = groupFinding(report);
  assert.deepEqual(observation.members.map((member) => member.itemId), [onlyMemberId]);
  assert.equal(observation.structuralStatus, "EXPLICIT_HIERARCHY");
  assert.equal(finding.impact, "NEUTRAL");
  assert.equal(finding.coverage.status, "EVALUATED");
  assert.deepEqual(report.issues, []);
});

test("ungrouped room item is not pulled into group evidence or findings", () => {
  const base = contextFor("T3");
  const extra = { ...base.items[0], itemId: "unassigned-art-item", category: "artwork", semanticRole: null };
  const baseReport = evaluateFurnitureGroupComposition(base);
  const expanded = aestheticDesignContextSchema.parse({
    ...base,
    items: [...base.items, extra],
    planReference: { ...base.planReference, itemIds: [...base.planReference.itemIds, extra.itemId] },
  });
  const expandedReport = evaluateFurnitureGroupComposition(expanded);
  const baseGroup = groupFinding(baseReport);
  const expandedGroup = groupFinding(expandedReport);
  assert.deepEqual(expandedGroup.finding, baseGroup.finding);
  assert.deepEqual(expandedGroup.observation, baseGroup.observation);
  assert.equal(expandedReport.items.some((item) => item.itemId === extra.itemId), true);
  assert.equal(expandedGroup.finding.itemIds.includes(extra.itemId), false);
  assert.deepEqual(expandedReport.issues, []);
});

test("overlapping anchor roles are preserved and classified as partial hierarchy", () => {
  const base = contextFor("T3");
  const overlapping = aestheticDesignContextSchema.parse({
    ...base,
    groups: [{ ...base.groups[0], secondaryAnchorItemIds: [base.groups[0].primaryAnchorItemId, ...base.groups[0].secondaryAnchorItemIds] }],
  });
  const { observation, finding } = groupFinding(evaluateFurnitureGroupComposition(overlapping));
  assert.equal(observation.structuralStatus, "PARTIAL_HIERARCHY");
  assert.deepEqual(observation.members.find((member) => member.itemId === observation.primaryAnchorItemId)?.groupRoles,
    ["PRIMARY_ANCHOR", "SECONDARY_ANCHOR"]);
  assert.equal(finding.impact, "NEUTRAL");
});

test("duplicate secondary or dependent references are never explicit hierarchy", () => {
  const base = contextFor("T1");
  const groups = [
    { ...base.groups[0], secondaryAnchorItemIds: [...base.groups[0].secondaryAnchorItemIds, base.groups[0].secondaryAnchorItemIds[0]] },
    { ...base.groups[0], dependentItemIds: [...base.groups[0].dependentItemIds, base.groups[0].dependentItemIds[0]] },
  ];
  for (const group of groups) {
    const context = aestheticDesignContextSchema.parse({ ...base, groups: [group] });
    assert.equal(groupFinding(evaluateFurnitureGroupComposition(context)).observation.structuralStatus, "PARTIAL_HIERARCHY");
  }
});

test("secondary-anchor/dependent overlap is preserved as partial hierarchy", () => {
  const base = contextFor("T2");
  const overlapId = base.groups[0].secondaryAnchorItemIds[0];
  const context = aestheticDesignContextSchema.parse({
    ...base,
    groups: [{ ...base.groups[0], dependentItemIds: [...base.groups[0].dependentItemIds, overlapId] }],
  });
  const { observation } = groupFinding(evaluateFurnitureGroupComposition(context));
  assert.deepEqual(observation.members.find((member) => member.itemId === overlapId)?.groupRoles, ["DEPENDENT", "SECONDARY_ANCHOR"]);
  assert.equal(observation.structuralStatus, "PARTIAL_HIERARCHY");
});

test("empty E.10-A group reports insufficient structural evidence without a fake finding", () => {
  const base = contextFor("T3");
  const empty = aestheticDesignContextSchema.parse({
    ...base,
    groups: [{ ...base.groups[0], itemIds: [], primaryAnchorItemId: null, secondaryAnchorItemIds: [], dependentItemIds: [] }],
  });
  const report = evaluateFurnitureGroupComposition(empty);
  assert.deepEqual(report.findings, []);
  assert.equal(report.coverage.find((entry) => entry.dimension === "composition")?.status, "INSUFFICIENT_EVIDENCE");
  assert.ok(report.diagnostics.some((diagnostic) => diagnostic.code === "composition.group.members_unavailable"));
  assert.deepEqual(report.issues, []);
});

test("T3 and T6 without secondary seating dependents remain neutral explicit inventories", () => {
  for (const templateId of ["T3", "T6"]) {
    const report = evaluateFurnitureGroupComposition(contextFor(templateId));
    const { finding, observation } = groupFinding(report);
    assert.deepEqual(observation.dependentItemIds, []);
    assert.equal(observation.structuralStatus, "EXPLICIT_HIERARCHY");
    assert.equal(finding.impact, "NEUTRAL");
    assert.equal(finding.coverage.status, "EVALUATED");
    assert.deepEqual(report.issues, []);
  }
});

test("asymmetric one-chair T2 remains neutral with no symmetry recommendation", () => {
  const report = evaluateFurnitureGroupComposition(contextFor("T2"));
  const { finding, observation } = groupFinding(report);
  assert.deepEqual(observation.dependentItemIds, ["chairs-1"]);
  assert.equal(finding.impact, "NEUTRAL");
  assert.equal(finding.recommendationCategory, null);
  assert.ok(observation.unavailableAssessments.includes("SYMMETRY"));
  assert.deepEqual(report.issues, []);
  assert.deepEqual(report.strengths, []);
});

test("different structures without downstream template IDs are never reconstructed", () => {
  for (const templateId of ["T2", "T5"]) {
    const report = evaluateFurnitureGroupComposition(contextFor(templateId));
    const { finding, observation } = groupFinding(report);
    assert.equal("templateId" in observation, false);
    assert.equal(JSON.stringify(observation).includes(templateId), false);
    assert.equal(observation.templateConformance, "NOT_EVALUATED");
    assert.equal(observation.visualQuality, "NOT_EVALUATED");
    assert.equal(finding.impact, "NEUTRAL");
    assert.deepEqual(report.issues, []);
  }
});

test("spatial status remains authoritative for valid, invalid, and incomplete inputs", () => {
  const base = contextFor("T4");
  for (const status of ["VALID", "INVALID", "NOT_FULLY_EVALUATED"] as const) {
    const context = aestheticDesignContextSchema.parse({
      ...base,
      spatialValidation: { ...base.spatialValidation, status, valid: status === "INVALID" ? false : base.spatialValidation.valid },
    });
    const report = evaluateFurnitureGroupComposition(context);
    assert.equal(report.spatialStatus.status, status);
    assert.equal(report.spatialStatus.status === "INVALID" ? report.spatialStatus.valid : true,
      status === "INVALID" ? false : true);
    assert.equal(groupFinding(report).finding.coverage.status, "EVALUATED");
  }
});

test("item/group permutation, repeated evaluation, report IDs, and JSON roundtrip are deterministic", () => {
  const base = contextFor("T5");
  const permuted = aestheticDesignContextSchema.parse({
    ...base,
    items: [...base.items].reverse().map((item) => ({
      ...item,
      placement: { ...item.placement, relationships: [...item.placement.relationships].reverse() },
    })),
    groups: [...base.groups].reverse().map((group) => ({
      ...group,
      itemIds: [...group.itemIds].reverse(),
      secondaryAnchorItemIds: [...group.secondaryAnchorItemIds].reverse(),
      dependentItemIds: [...group.dependentItemIds].reverse(),
    })),
  });
  const snapshot = structuredClone(permuted);
  const report = evaluateFurnitureGroupComposition(permuted);
  assert.deepEqual(evaluateFurnitureGroupComposition(permuted), report);
  assert.deepEqual(evaluateFurnitureGroupComposition(base), report);
  assert.deepEqual(permuted, snapshot);
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  assert.equal(aestheticEvaluationReportSchema.safeParse(report).success, true);
  assert.equal(report.findings[0].findingId, `composition.group:${base.groups[0].id}`);
  assert.equal(report.findings[0].supportingEvidence[0].evidenceId, `composition-evidence.group:${base.groups[0].id}`);
});

test("multiple authoritative groups produce independent findings in stable group-ID order", () => {
  const base = contextFor("T1");
  const firstGroup = { ...base.groups[0], id: "group-alpha" };
  const secondGroup = {
    id: "group-beta", type: "SECONDARY_SEATING_GROUP", itemIds: ["chairs-1", "chairs-2"], zoneId: base.groups[0].zoneId,
    primaryAnchorItemId: "chairs-1", secondaryAnchorItemIds: [], dependentItemIds: ["chairs-2"],
  };
  const make = (groups: typeof base.groups) => aestheticDesignContextSchema.parse({ ...base, groups });
  const forward = evaluateFurnitureGroupComposition(make([firstGroup, secondGroup]));
  const reverse = evaluateFurnitureGroupComposition(make([secondGroup, firstGroup]));
  assert.deepEqual(forward.findings.map((finding) => finding.findingId), ["composition.group:group-alpha", "composition.group:group-beta"]);
  assert.deepEqual(reverse, forward);
  assert.deepEqual(forward.findings[0].itemIds, [...firstGroup.itemIds].sort());
  assert.deepEqual(forward.findings[1].itemIds, [...secondGroup.itemIds].sort());
  assert.notDeepEqual(forward.findings[0].itemIds, forward.findings[1].itemIds);
});

test("duplicate group IDs are rejected rather than silently merged into false hierarchy", () => {
  const base = contextFor("T2");
  const duplicate = aestheticDesignContextSchema.parse({
    ...base,
    groups: [base.groups[0], { ...base.groups[0], dependentItemIds: [] }],
  });
  assert.throws(() => evaluateFurnitureGroupComposition(duplicate), /FURNITURE_GROUP_COMPOSITION_DUPLICATE_GROUP_ID/);
});

test("unrelated spatial and catalog metadata do not alter structural findings", () => {
  const base = contextFor("T6");
  const changed = aestheticDesignContextSchema.parse({
    ...base,
    spatialValidation: { ...base.spatialValidation, status: "INVALID", valid: false },
    items: base.items.map((item) => ({
      ...item,
      catalogReference: { productId: `catalog-${item.itemId}`, variantId: `variant-${item.itemId}` },
      placement: { ...item.placement, approximatePosition: { xCm: 9999, yCm: -9999 }, preferredOrientationDegrees: 13 },
    })),
  });
  const source = evaluateFurnitureGroupComposition(base);
  const report = evaluateFurnitureGroupComposition(changed);
  assert.deepEqual(report.findings, source.findings);
  assert.equal(report.spatialStatus.status, "INVALID");
});

test("color, material, style, dimensions, and visual weight do not alter group findings", () => {
  const base = contextFor("T4");
  const changed = aestheticDesignContextSchema.parse({
    ...base,
    items: base.items.map((item) => ({
      ...item,
      metadata: {
        ...item.metadata,
        style: { status: "KNOWN", value: "modern", source: "catalog" },
        color: { status: "KNOWN", value: { value: "cream", family: "cream" }, source: "catalog" },
        materials: { status: "KNOWN", values: [{ value: "oak", family: "wood" }], source: "catalog" },
        visualWeight: "HEAVY",
        designMeasurements: { widthCm: 123, depthCm: 57, heightCm: 43 },
      },
    })),
  });
  assert.deepEqual(evaluateFurnitureGroupComposition(changed).findings, evaluateFurnitureGroupComposition(base).findings);
});

test("B.1 group evidence contract binds source, group subject, member IDs, neutral impact, and no recommendation", () => {
  const report = evaluateFurnitureGroupComposition(contextFor("T1"));
  const finding = report.findings[0];
  assert.ok(finding);
  const evidence = finding.supportingEvidence[0];
  assert.ok(evidence);
  assert.equal(evidence.source, "e10a_plan");
  assert.equal(aestheticFindingSchema.safeParse({
    ...finding,
    supportingEvidence: [{ ...evidence, source: "normalized_attributes" }],
  }).success, false);
  assert.equal(aestheticFindingSchema.safeParse({
    ...finding,
    supportingEvidence: [{
      ...evidence,
      observation: { kind: "design_intent", preference: "STYLE", values: ["modern"] },
    }],
  }).success, false);
  assert.equal(aestheticFindingSchema.safeParse({
    ...finding,
    subjects: finding.subjects.map((subject) => subject.kind === "GROUP" ? { ...subject, id: "different-group" } : subject),
  }).success, false);
  assert.equal(aestheticFindingSchema.safeParse({ ...finding, itemIds: finding.itemIds.slice(1) }).success, false);
  assert.equal(aestheticFindingSchema.safeParse({ ...finding, impact: "POSITIVE" }).success, false);
  assert.equal(aestheticFindingSchema.safeParse({ ...finding, impact: "MINOR_ISSUE" }).success, false);
  assert.equal(aestheticFindingSchema.safeParse({ ...finding, recommendationCategory: "CHANGE_MATERIAL" }).success, false);
  assert.equal(aestheticEvaluationReportSchema.safeParse({
    ...report,
    findings: report.findings.map((entry) => ({
      ...entry,
      supportingEvidence: entry.supportingEvidence.map((item) => ({ ...item, source: "design_intent" })),
    })),
  }).success, false);
});