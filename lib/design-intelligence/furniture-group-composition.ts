import type { AestheticDesignContext, AestheticGroupReference, AestheticItemContext } from "./aesthetic-context";
import {
  aestheticFindingSchema,
  aestheticItemSchema,
  type AestheticEvaluationReport,
  type AestheticFinding,
} from "./aesthetic-contracts";
import { buildAestheticEvaluationReport } from "./aesthetic-report";

export const FURNITURE_GROUP_COMPOSITION_EVALUATOR_ID = "furniture-group-composition";
export const FURNITURE_GROUP_COMPOSITION_EVALUATOR_VERSION = "1.0";
export const FURNITURE_GROUP_COMPOSITION_RULE_ID = "e10a_group_hierarchy_inventory";

const compareText = (first: string, second: string) => first < second ? -1 : first > second ? 1 : 0;
const UNAVAILABLE_ASSESSMENTS = ["TEMPLATE_CONFORMANCE", "VISUAL_BALANCE", "SYMMETRY", "DOMINANCE", "COMPOSITION_QUALITY"] as const;

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function reportItem(item: AestheticItemContext) {
  const measurements = item.metadata.designMeasurements ?? item.metadata.catalogMeasurements;
  return aestheticItemSchema.parse({
    itemId: item.itemId,
    role: item.role,
    styleCode: item.metadata.style.status === "KNOWN" ? item.metadata.style.value : null,
    color: item.metadata.color.status === "KNOWN" ? item.metadata.color.value : null,
    materials: item.metadata.materials.status === "KNOWN" ? item.metadata.materials.values : null,
    furnitureAttributes: item.metadata.attributes,
    visualWeight: item.metadata.visualWeight,
    measurements: {
      widthCm: measurements?.widthCm ?? null,
      depthCm: measurements?.depthCm ?? null,
      heightCm: measurements?.heightCm ?? null,
    },
  });
}

function groupObservation(group: AestheticGroupReference, itemsById: ReadonlyMap<string, AestheticItemContext>) {
  const memberIds = [...group.itemIds].sort(compareText);
  const secondaryAnchorItemIds = [...group.secondaryAnchorItemIds].sort(compareText);
  const dependentItemIds = [...group.dependentItemIds].sort(compareText);
  const members = memberIds.flatMap((itemId) => {
    const item = itemsById.get(itemId);
    if (!item) return [];
    const groupRoles = [
      ...(group.primaryAnchorItemId === itemId ? ["PRIMARY_ANCHOR" as const] : []),
      ...(group.secondaryAnchorItemIds.includes(itemId) ? ["SECONDARY_ANCHOR" as const] : []),
      ...(group.dependentItemIds.includes(itemId) ? ["DEPENDENT" as const] : []),
    ].sort(compareText);
    const relationships = item.placement.relationships.map((relationship) => ({ ...relationship }))
      .sort((first, second) => compareText(`${first.type}:${first.targetItemId}`, `${second.type}:${second.targetItemId}`));
    return [{ itemId, semanticRole: item.semanticRole, category: item.category, subtype: item.subtype, groupRoles, relationships }];
  });
  const itemIds = new Set(memberIds);
  const roleReferences = [group.primaryAnchorItemId, ...secondaryAnchorItemIds, ...dependentItemIds].filter((id): id is string => id !== null);
  const hasValidAnchor = group.primaryAnchorItemId !== null && itemIds.has(group.primaryAnchorItemId);
  const hierarchyComplete = hasValidAnchor
    && !hasDuplicates(secondaryAnchorItemIds)
    && !hasDuplicates(dependentItemIds)
    && roleReferences.every((id) => itemIds.has(id))
    && members.length === memberIds.length
    && members.every((member) => member.groupRoles.length === 1);
  return {
    kind: "furniture_group_composition" as const,
    groupId: group.id,
    groupType: group.type,
    primaryAnchorItemId: group.primaryAnchorItemId,
    secondaryAnchorItemIds,
    dependentItemIds,
    members,
    structuralStatus: hierarchyComplete ? "EXPLICIT_HIERARCHY" as const : "PARTIAL_HIERARCHY" as const,
    templateConformance: "NOT_EVALUATED" as const,
    visualQuality: "NOT_EVALUATED" as const,
    unavailableAssessments: [...UNAVAILABLE_ASSESSMENTS],
  };
}

function groupFinding(group: AestheticGroupReference, observation: ReturnType<typeof groupObservation>): AestheticFinding {
  const itemIds = [...group.itemIds].sort(compareText);
  const explanation = observation.structuralStatus === "EXPLICIT_HIERARCHY"
    ? "This finding inventories the explicit E.10-A group hierarchy and member roles only; template conformance and visual composition quality are not evaluated."
    : "This finding inventories the available E.10-A group hierarchy, but one or more anchor/member roles are missing or inconsistent; template conformance and visual composition quality are not evaluated.";
  return aestheticFindingSchema.parse({
    findingId: `composition.group:${group.id}`,
    code: observation.structuralStatus === "EXPLICIT_HIERARCHY" ? "composition.group.structure_inventory" : "composition.group.partial_structure_inventory",
    target: { kind: "dimension", dimension: "composition" },
    subjects: [
      { kind: "GROUP", id: group.id },
      ...itemIds.map((id) => ({ kind: "ITEM" as const, id })),
    ],
    itemIds,
    compatibility: "unknown",
    priority: "P3",
    impact: "NEUTRAL",
    explanation,
    evaluator: {
      evaluatorId: FURNITURE_GROUP_COMPOSITION_EVALUATOR_ID,
      ruleId: FURNITURE_GROUP_COMPOSITION_RULE_ID,
      version: FURNITURE_GROUP_COMPOSITION_EVALUATOR_VERSION,
    },
    coverage: { status: "EVALUATED" },
    evidenceCompleteness: "complete",
    supportingEvidence: [{
      evidenceId: `composition-evidence.group:${group.id}`,
      source: "e10a_plan",
      dimension: "composition",
      itemIds,
      description: explanation,
      observation,
    }],
    missingInformation: [],
    recommendationCategory: null,
  });
}

/** Inventories authoritative E.10-A group structure; it does not judge furniture composition quality. */
export function evaluateFurnitureGroupComposition(context: AestheticDesignContext): AestheticEvaluationReport {
  const groupsById = new Map<string, AestheticGroupReference>();
  for (const group of context.groups) {
    if (groupsById.has(group.id)) throw new Error("FURNITURE_GROUP_COMPOSITION_DUPLICATE_GROUP_ID");
    groupsById.set(group.id, group);
  }
  const groups = [...groupsById.values()].sort((first, second) => compareText(first.id, second.id));
  const itemsById = new Map(context.items.map((item) => [item.itemId, item]));
  const findings = groups.filter((group) => group.itemIds.length > 0)
    .map((group) => groupFinding(group, groupObservation(group, itemsById)));
  const emptyGroupIds = groups.filter((group) => group.itemIds.length === 0).map((group) => group.id);
  const memberIds = sortedUnique(groups.flatMap((group) => group.itemIds));
  const coverage = groups.length === 0
    ? { dimension: "composition" as const, status: "NOT_APPLICABLE" as const, itemIds: [], reason: null }
    : emptyGroupIds.length > 0
      ? { dimension: "composition" as const, status: "INSUFFICIENT_EVIDENCE" as const, itemIds: memberIds, reason: "One or more E.10-A groups have no member items to inventory." }
      : { dimension: "composition" as const, status: "EVALUATED" as const, itemIds: memberIds, reason: null };
  const diagnostics = emptyGroupIds.map((groupId) => ({
    code: "composition.group.members_unavailable",
    description: `E.10-A group ${groupId} has no member items, so its structure cannot be inventoried.`,
    itemIds: [],
  }));
  return buildAestheticEvaluationReport({
    context,
    items: context.items.map(reportItem),
    relationships: [],
    findings,
    coverage: [coverage],
    diagnostics,
  });
}