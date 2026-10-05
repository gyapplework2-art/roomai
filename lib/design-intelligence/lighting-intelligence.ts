import type { AestheticDesignContext, AestheticGroupReference, AestheticItemContext } from "./aesthetic-context";
import {
  aestheticFindingSchema,
  aestheticItemSchema,
  type AestheticEvaluationReport,
  type AestheticFinding,
} from "./aesthetic-contracts";
import { buildAestheticEvaluationReport } from "./aesthetic-report";

export const LIGHTING_EVALUATOR_ID = "lighting-intelligence";
export const LIGHTING_EVALUATOR_VERSION = "1.0";
export const LIGHTING_STRUCTURE_RULE_ID = "e10a_lighting_role_placement_inventory";

const compareText = (first: string, second: string) => first < second ? -1 : first > second ? 1 : 0;
const UNAVAILABLE_ASSESSMENTS = [
  "FIXTURE_TYPE_CLASSIFICATION", "FIXTURE_MOUNTING_TYPE", "PHOTOMETRIC_ADEQUACY", "BRIGHTNESS_LEVEL",
  "COLOR_TEMPERATURE", "CRI_QUALITY", "DIMMABILITY", "LIGHT_DIRECTION", "BEAM_COVERAGE", "SHADE_DIFFUSION",
  "VERTICAL_RELATIONSHIP", "TASK_PERFORMANCE", "AMBIENT_COVERAGE", "ACCENT_LIGHTING_CLASSIFICATION", "FIXTURE_SCALE_RELATIONSHIP",
] as const;
type ExplicitLightingRelationship = {
  direction: "OUTGOING" | "INCOMING";
  sourceItemId: string;
  relationshipType: string;
  targetItemId: string;
};

function relationshipKey(relationship: { direction: string; sourceItemId: string; relationshipType: string; targetItemId: string }): string {
  return `${relationship.direction}:${relationship.sourceItemId}:${relationship.relationshipType}:${relationship.targetItemId}`;
}

function groupMemberships(groups: readonly AestheticGroupReference[], itemId: string) {
  return groups.filter((group) => group.itemIds.includes(itemId)).map((group) => ({
    groupId: group.id,
    groupType: group.type,
    groupZoneId: group.zoneId,
    hierarchyRoles: [
      ...(group.primaryAnchorItemId === itemId ? ["PRIMARY_ANCHOR" as const] : []),
      ...(group.secondaryAnchorItemIds.includes(itemId) ? ["SECONDARY_ANCHOR" as const] : []),
      ...(group.dependentItemIds.includes(itemId) ? ["DEPENDENT" as const] : []),
    ].sort(compareText),
  })).sort((first, second) => compareText(first.groupId, second.groupId));
}

function lightingRelationships(items: readonly AestheticItemContext[], lightingItemId: string) {
  const relationships: ExplicitLightingRelationship[] = [];
  for (const item of items) for (const relationship of item.placement.relationships) {
    if (item.itemId === lightingItemId) relationships.push({
      direction: "OUTGOING",
      sourceItemId: item.itemId,
      relationshipType: relationship.type,
      targetItemId: relationship.targetItemId,
    });
    else if (relationship.targetItemId === lightingItemId) relationships.push({
      direction: "INCOMING",
      sourceItemId: item.itemId,
      relationshipType: relationship.type,
      targetItemId: lightingItemId,
    });
  }
  return [...new Map(relationships.map((relationship) => [relationshipKey(relationship), relationship])).values()]
    .sort((first, second) => compareText(relationshipKey(first), relationshipKey(second)));
}

function lightingObservation(context: AestheticDesignContext, item: AestheticItemContext) {
  const matchingZones = item.placement.zoneId === null ? [] : context.zones.filter((zone) => zone.id === item.placement.zoneId);
  const zoneResolutionStatus = item.placement.zoneId === null ? "NO_ZONE_REFERENCE" as const
    : matchingZones.length === 1 ? "RESOLVED" as const
      : matchingZones.length === 0 ? "UNRESOLVED" as const : "AMBIGUOUS" as const;
  const zone = zoneResolutionStatus === "RESOLVED" ? matchingZones[0] : null;
  return {
    kind: "lighting_composition_structure" as const,
    lightingItemId: item.itemId,
    semanticRole: item.semanticRole as "TASK_LIGHTING" | "AMBIENT_LIGHTING",
    planCategory: item.category,
    planSubtype: item.subtype,
    groupMemberships: groupMemberships(context.groups, item.itemId),
    zoneId: item.placement.zoneId,
    zoneResolutionStatus,
    zone: zone ? {
      zoneId: zone.id,
      type: zone.type,
      polygon: zone.polygon.map((vertex) => ({ ...vertex })),
      center: { ...zone.center },
      orientationDegrees: zone.orientationDegrees ?? null,
    } : null,
    placement: {
      mode: item.placement.mode,
      approximatePosition: item.placement.approximatePosition ? { ...item.placement.approximatePosition } : null,
      preferredOrientationDegrees: item.placement.preferredOrientationDegrees,
    },
    explicitRelationships: lightingRelationships(context.items, item.itemId),
    assessmentStatus: "EVIDENCE_RECORDED" as const,
    unavailableAssessments: [...UNAVAILABLE_ASSESSMENTS],
  };
}

function lightingFinding(item: AestheticItemContext, observation: ReturnType<typeof lightingObservation>): AestheticFinding {
  const explanation = observation.groupMemberships.length || observation.zoneId !== null || observation.explicitRelationships.length
    ? "Explicit E.10-A lighting role, group/zone references, placement, and semantic links are recorded as evidence only; lighting performance is not evaluated."
    : "The explicit E.10-A lighting role and available placement are recorded; no group, zone, or semantic relationship is inferred.";
  return aestheticFindingSchema.parse({
    findingId: `lighting.structure:${item.itemId}`,
    code: "lighting.structure.evidence_recorded",
    target: { kind: "dimension", dimension: "lighting_composition" },
    subjects: [
      ...observation.groupMemberships.map((membership) => ({ kind: "GROUP" as const, id: membership.groupId })),
      { kind: "ITEM", id: item.itemId },
    ],
    itemIds: [item.itemId],
    compatibility: "unknown",
    priority: "P3",
    impact: "NEUTRAL",
    explanation,
    evaluator: { evaluatorId: LIGHTING_EVALUATOR_ID, ruleId: LIGHTING_STRUCTURE_RULE_ID, version: LIGHTING_EVALUATOR_VERSION },
    coverage: { status: "NOT_EVALUATED", reason: "Only explicit lighting structure is represented; no repository-backed lighting-performance evaluator exists." },
    evidenceCompleteness: "partial",
    supportingEvidence: [{
      evidenceId: `lighting-evidence.structure:${item.itemId}`,
      source: "e10a_plan",
      dimension: "lighting_composition",
      itemIds: [item.itemId],
      description: explanation,
      observation,
    }],
    missingInformation: [{
      code: "lighting.performance_rules_unavailable",
      dimension: "lighting_composition",
      itemIds: [item.itemId],
      description: "Brightness, photometric adequacy, mounting/elevation, task performance, and ambient coverage lack authoritative evidence or supported rules.",
    }],
    recommendationCategory: null,
  });
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

/** Records only existing E.10-A lighting roles and authored structural links; no performance or quality inference. */
export function evaluateLightingIntelligence(context: AestheticDesignContext): AestheticEvaluationReport {
  const groupsById = new Map<string, AestheticGroupReference>();
  for (const group of context.groups) {
    if (groupsById.has(group.id)) throw new Error("LIGHTING_DUPLICATE_GROUP_ID");
    groupsById.set(group.id, group);
  }
  const lightingItems = context.items.filter((item) => item.semanticRole === "TASK_LIGHTING" || item.semanticRole === "AMBIENT_LIGHTING")
    .sort((first, second) => compareText(first.itemId, second.itemId));
  const observations = lightingItems.map((item) => ({ item, observation: lightingObservation(context, item) }));
  const findings = observations.map(({ item, observation }) => lightingFinding(item, observation));
  const itemIds = lightingItems.map((item) => item.itemId);
  const diagnostics = [
    ...(lightingItems.length ? [{
    code: "lighting.performance_evaluator_unavailable",
    description: "RoomAI can inventory explicit lighting intent/placement, but lacks authoritative photometric and fixture-performance rules.",
    itemIds,
    }] : []),
    ...observations.filter(({ observation }) => observation.groupMemberships.length === 0
      && observation.zoneId === null && observation.explicitRelationships.length === 0).map(({ item }) => ({
      code: "lighting.explicit_association_unavailable",
      description: "No E.10-A group, zone, or semantic relationship is attached to this lighting item; RoomAI does not infer a nearby furniture target.",
      itemIds: [item.itemId],
    })),
  ];
  const coverage = lightingItems.length === 0
    ? { dimension: "lighting_composition" as const, status: "NOT_APPLICABLE" as const, itemIds: [], reason: null }
    : { dimension: "lighting_composition" as const, status: "NOT_EVALUATED" as const, itemIds, reason: "Lighting structure is recorded, but brightness, task/ambient performance, fixture scale, and vertical placement are unsupported." };
  return buildAestheticEvaluationReport({
    context,
    items: context.items.map(reportItem),
    relationships: [],
    findings,
    coverage: [coverage],
    diagnostics,
  });
}