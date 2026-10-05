import type { AestheticDesignContext, AestheticGroupReference, AestheticItemContext } from "./aesthetic-context";
import {
  aestheticFindingSchema,
  aestheticItemSchema,
  type AestheticEvaluationReport,
  type AestheticFinding,
} from "./aesthetic-contracts";
import { buildAestheticEvaluationReport } from "./aesthetic-report";

export const RUG_ZONE_EVALUATOR_ID = "rug-zone-intelligence";
export const RUG_ZONE_EVALUATOR_VERSION = "1.0";
export const RUG_ZONE_STRUCTURE_RULE_ID = "e10a_rug_group_zone_inventory";

const compareText = (first: string, second: string) => first < second ? -1 : first > second ? 1 : 0;
const UNAVAILABLE_ASSESSMENTS = [
  "TRUE_ZONE_DEFINITION", "ZONE_QUALITY", "LIGHTNESS_RELATIONSHIP", "VISUAL_DOMINANCE",
  "LEG_PLACEMENT", "PATTERN_INTENSITY", "RUG_FURNITURE_INTERSECTION_QUALITY", "FOOTPRINT_COVERAGE_JUDGMENT",
] as const;

function pairIdentity(groupId: string, rugItemId: string): string {
  return `${groupId.length}:${groupId}:${rugItemId.length}:${rugItemId}`;
}

function canonicalPolygon(vertices: readonly { xCm: number; yCm: number }[]): string {
  if (!vertices.length) return "[]";
  const points = vertices.map((point) => `${JSON.stringify(point.xCm)},${JSON.stringify(point.yCm)}`);
  const variants: string[] = [];
  for (const sequence of [points, [...points].reverse()]) {
    for (let offset = 0; offset < sequence.length; offset += 1) {
      variants.push(JSON.stringify([...sequence.slice(offset), ...sequence.slice(0, offset)]));
    }
  }
  return variants.sort(compareText)[0];
}

function zoneEvidence(context: AestheticDesignContext, zoneId: string | null) {
  if (zoneId === null) return null;
  const matching = context.zones.filter((zone) => zone.id === zoneId);
  if (matching.length !== 1) return null;
  const zone = matching[0];
  return {
    zoneId: zone.id,
    type: zone.type,
    polygon: zone.polygon.map((vertex) => ({ ...vertex })),
    center: { ...zone.center },
    orientationDegrees: zone.orientationDegrees ?? null,
    polygonRelationToRoom: canonicalPolygon(zone.polygon) === canonicalPolygon(context.geometry.vertices)
      ? "SAME_POLYGON" as const : "DIFFERENT_POLYGON" as const,
  };
}

function groupRoles(group: AestheticGroupReference, rugItemId: string) {
  return [
    ...(group.primaryAnchorItemId === rugItemId ? ["PRIMARY_ANCHOR" as const] : []),
    ...(group.secondaryAnchorItemIds.includes(rugItemId) ? ["SECONDARY_ANCHOR" as const] : []),
    ...(group.dependentItemIds.includes(rugItemId) ? ["DEPENDENT" as const] : []),
  ].sort(compareText);
}

function observationFor(
  context: AestheticDesignContext,
  group: AestheticGroupReference,
  rug: AestheticItemContext,
) {
  const groupZoneId = group.zoneId;
  const rugZoneId = rug.placement.zoneId;
  const groupZone = zoneEvidence(context, groupZoneId);
  const rugZone = zoneEvidence(context, rugZoneId);
  const zoneReferenceStatus = groupZoneId === null ? "GROUP_ZONE_MISSING" as const
    : rugZoneId === null ? "RUG_ZONE_MISSING" as const
      : !groupZone ? "GROUP_ZONE_UNRESOLVED" as const
        : !rugZone ? "RUG_ZONE_UNRESOLVED" as const
          : groupZoneId === rugZoneId ? "MATCHED_ZONE" as const : "DIFFERENT_ZONES" as const;
  const assessmentStatus = groupZone && rugZone ? "STRUCTURE_RECORDED" as const : "INSUFFICIENT_EVIDENCE" as const;
  return {
    kind: "rug_zone_structure" as const,
    rugItemId: rug.itemId,
    groupId: group.id,
    groupType: group.type,
    rugGroupRoles: groupRoles(group, rug.itemId),
    groupZoneId,
    rugZoneId,
    groupZone,
    rugZone,
    zoneReferenceStatus,
    placement: {
      mode: rug.placement.mode,
      approximatePosition: rug.placement.approximatePosition ? { ...rug.placement.approximatePosition } : null,
      preferredOrientationDegrees: rug.placement.preferredOrientationDegrees,
    },
    dimensions: {
      planningRangeCm: {
        widthMin: rug.sizeRange.widthMinCm,
        widthMax: rug.sizeRange.widthMaxCm,
        depthMin: rug.sizeRange.depthMinCm,
        depthMax: rug.sizeRange.depthMaxCm,
      },
      catalogMeasurementsCm: rug.metadata.catalogMeasurements
        ? { width: rug.metadata.catalogMeasurements.widthCm, depth: rug.metadata.catalogMeasurements.depthCm } : null,
      designMeasurementsCm: rug.metadata.designMeasurements
        ? { width: rug.metadata.designMeasurements.widthCm, depth: rug.metadata.designMeasurements.depthCm } : null,
    },
    assessmentStatus,
    unavailableAssessments: [...UNAVAILABLE_ASSESSMENTS],
  };
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

function rugFinding(group: AestheticGroupReference, rug: AestheticItemContext, observation: ReturnType<typeof observationFor>): AestheticFinding {
  const insufficient = observation.assessmentStatus === "INSUFFICIENT_EVIDENCE";
  const explanation = insufficient
    ? "The explicit E.10-A rug/group association is recorded, but one or both referenced zones are unavailable; no zone-quality conclusion is made."
    : observation.zoneReferenceStatus === "MATCHED_ZONE"
      ? "The rug is an explicit member of this E.10-A group and shares its resolved zone reference; zone-definition and rug-zone quality are not evaluated."
      : "The rug is an explicit member of this E.10-A group; the group and rug reference different resolved zones, and no quality judgment is inferred.";
  return aestheticFindingSchema.parse({
    findingId: `rug-zone:${pairIdentity(group.id, rug.itemId)}`,
    code: insufficient ? "rug_zone.structure_evidence_insufficient" : "rug_zone.explicit_group_zone_structure",
    target: { kind: "dimension", dimension: "rug_zone_coherence" },
    subjects: [{ kind: "GROUP", id: group.id }, { kind: "ITEM", id: rug.itemId }],
    itemIds: [rug.itemId],
    compatibility: "unknown",
    priority: "P3",
    impact: "NEUTRAL",
    explanation,
    evaluator: { evaluatorId: RUG_ZONE_EVALUATOR_ID, ruleId: RUG_ZONE_STRUCTURE_RULE_ID, version: RUG_ZONE_EVALUATOR_VERSION },
    coverage: insufficient ? { status: "INSUFFICIENT_EVIDENCE", reason: explanation } : { status: "NOT_EVALUATED", reason: explanation },
    evidenceCompleteness: insufficient ? "partial" : "complete",
    supportingEvidence: [{
      evidenceId: `rug-zone-evidence:${pairIdentity(group.id, rug.itemId)}`,
      source: "e10a_plan",
      dimension: "rug_zone_coherence",
      itemIds: [rug.itemId],
      description: explanation,
      observation,
    }],
    missingInformation: insufficient ? [{
      code: "rug_zone.zone_reference_unavailable",
      dimension: "rug_zone_coherence",
      itemIds: [rug.itemId],
      description: explanation,
    }] : [],
    recommendationCategory: null,
  });
}

/** Records only explicit E.10-A rug/group/zone structure; it does not evaluate rug-zone aesthetic quality. */
export function evaluateRugZoneIntelligence(context: AestheticDesignContext): AestheticEvaluationReport {
  const rugs = context.items.filter((item) => item.semanticRole === "AREA_RUG").sort((first, second) => compareText(first.itemId, second.itemId));
  const supportedRoom = context.roomType === "living_room" || context.roomType === "family_room";
  const groupById = new Map<string, (typeof context.groups)[number]>();
  for (const group of context.groups) {
    if (groupById.has(group.id)) throw new Error("RUG_ZONE_DUPLICATE_GROUP_ID");
    groupById.set(group.id, group);
  }
  const rugsByGroup = new Map<string, Set<string>>();
  for (const group of context.groups) for (const itemId of group.itemIds) {
    if (!rugs.some((rug) => rug.itemId === itemId)) continue;
    const groupRugs = rugsByGroup.get(group.id) ?? new Set<string>();
    groupRugs.add(itemId);
    rugsByGroup.set(group.id, groupRugs);
  }

  const associations = [...rugsByGroup.entries()].flatMap(([groupId, itemIds]) => {
    const group = groupById.get(groupId);
    if (!group) return [];
    return [...itemIds].sort(compareText).flatMap((itemId) => {
      const rug = rugs.find((item) => item.itemId === itemId);
      return rug ? [{ group, rug }] : [];
    });
  }).sort((first, second) => compareText(pairIdentity(first.group.id, first.rug.itemId), pairIdentity(second.group.id, second.rug.itemId)));

  const findings = supportedRoom
    ? associations.map(({ group, rug }) => rugFinding(group, rug, observationFor(context, group, rug)))
    : [];
  const groupedRugIds = new Set(associations.map(({ rug }) => rug.itemId));
  const ungroupedRugIds = rugs.filter((rug) => !groupedRugIds.has(rug.itemId)).map((rug) => rug.itemId);
  const diagnostics = [
    ...(!supportedRoom && rugs.length ? [{
      code: "rug_zone.room_type_not_supported",
      description: "Rug-zone structural evaluation is currently scoped to living rooms and family rooms.",
      itemIds: rugs.map((rug) => rug.itemId),
    }] : []),
    ...(supportedRoom && ungroupedRugIds.length ? [{
      code: "rug_zone.explicit_group_association_unavailable",
      description: "These rugs are not members of an authoritative E.10-A group; no nearby furniture is inferred as a pair.",
      itemIds: [...ungroupedRugIds].sort(compareText),
    }] : []),
  ];
  const missingZoneEvidence = findings.some((finding) => finding.coverage.status === "INSUFFICIENT_EVIDENCE");
  const coverage = rugs.length === 0
    ? { dimension: "rug_zone_coherence" as const, status: "NOT_APPLICABLE" as const, itemIds: [], reason: null }
    : !supportedRoom || associations.length === 0
      ? { dimension: "rug_zone_coherence" as const, status: "NOT_EVALUATED" as const, itemIds: rugs.map((rug) => rug.itemId), reason: "No supported explicit rug/group/zone evaluation is available for this context." }
      : missingZoneEvidence
        ? { dimension: "rug_zone_coherence" as const, status: "INSUFFICIENT_EVIDENCE" as const, itemIds: rugs.map((rug) => rug.itemId), reason: "One or more explicit rug/group associations lack resolvable zone evidence." }
        : { dimension: "rug_zone_coherence" as const, status: "NOT_EVALUATED" as const, itemIds: rugs.map((rug) => rug.itemId), reason: "Explicit rug/group/zone structure is recorded, but no repository-backed rule evaluates rug-zone aesthetic quality." };

  return buildAestheticEvaluationReport({
    context,
    items: context.items.map(reportItem),
    relationships: [],
    findings,
    coverage: [coverage],
    diagnostics,
  });
}