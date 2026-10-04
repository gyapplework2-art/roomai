import {
  SOFA_RUG_COMPATIBLE_WIDTH_RATIO,
  SOFA_RUG_MIXED_WIDTH_RATIO,
  SOFA_RUG_PROPORTION_RULE_ID,
  evaluateSofaRugScaleProportion,
} from "./sofa-rug-relationship";
import type { AestheticDesignContext, AestheticItemContext } from "./aesthetic-context";
import {
  aestheticFindingSchema,
  aestheticItemSchema,
  type AestheticEvaluationReport,
  type AestheticFinding,
  type AestheticRelationship,
} from "./aesthetic-contracts";
import { buildAestheticEvaluationReport } from "./aesthetic-report";

export const FURNITURE_PROPORTION_EVALUATOR_ID = "furniture-proportion";
export const FURNITURE_PROPORTION_EVALUATOR_VERSION = "1.0";
export const SUPPORTED_FURNITURE_PROPORTION_RELATIONSHIPS = ["sofa_rug"] as const;

type FurnitureProportionSource =
  | { kind: "E10A_GROUP"; groupId: string }
  | { kind: "SEMANTIC_RELATIONSHIP"; relationshipType: "GROUPED_WITH" };

type SofaRugPair = {
  relationshipType: "sofa_rug";
  relationshipId: string;
  itemIds: [string, string];
  seatingItem: AestheticItemContext;
  rugItem: AestheticItemContext;
  sources: FurnitureProportionSource[];
};

type DeferredPair = {
  relationshipType: "dining_table_chair" | "bed_nightstand" | "desk_office_chair";
  relationshipId: string;
  itemIds: [string, string];
  reason: string;
};

type ExplicitPair = {
  first: AestheticItemContext;
  second: AestheticItemContext;
  source: FurnitureProportionSource;
};

const compareText = (first: string, second: string) => first < second ? -1 : first > second ? 1 : 0;
const pairSuffix = (itemIds: readonly [string, string]) => itemIds.map((itemId) => `${itemId.length}:${itemId}`).join(":");
function canonicalItemIds(first: string, second: string): [string, string] {
  return compareText(first, second) <= 0 ? [first, second] : [second, first];
}

function normalizeCategory(item: AestheticItemContext): string {
  return item.category.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function toProportionRole(item: AestheticItemContext) {
  return { roleId: item.itemId, furnitureTypeCode: normalizeCategory(item) };
}

function identifySofaRugPair(first: AestheticItemContext, second: AestheticItemContext) {
  if (!["PRIMARY_SEATING", "SECONDARY_SEATING"].includes(first.semanticRole ?? "")
    && !["PRIMARY_SEATING", "SECONDARY_SEATING"].includes(second.semanticRole ?? "")) return null;
  if (first.semanticRole !== "AREA_RUG" && second.semanticRole !== "AREA_RUG") return null;
  const evaluation = evaluateSofaRugScaleProportion(toProportionRole(first), null, toProportionRole(second), null);
  if (!evaluation.applicable || !evaluation.seatingRoleId || !evaluation.rugRoleId) return null;
  const seatingItem = first.itemId === evaluation.seatingRoleId ? first : second;
  const rugItem = first.itemId === evaluation.rugRoleId ? first : second;
  const itemIds = canonicalItemIds(seatingItem.itemId, rugItem.itemId);
  return {
    relationshipType: "sofa_rug" as const,
    relationshipId: `furniture_proportion:sofa_rug:${pairSuffix(itemIds)}`,
    itemIds,
    seatingItem,
    rugItem,
  };
}

function deferredRelationship(first: AestheticItemContext, second: AestheticItemContext): DeferredPair["relationshipType"] | null {
  const firstCategory = normalizeCategory(first);
  const secondCategory = normalizeCategory(second);
  if ([firstCategory, secondCategory].includes("dining_table") && [firstCategory, secondCategory].includes("dining_chair")) return "dining_table_chair";
  if ((["bed", "bed_frame"].includes(firstCategory) && secondCategory === "nightstand")
    || (["bed", "bed_frame"].includes(secondCategory) && firstCategory === "nightstand")) return "bed_nightstand";
  if ([firstCategory, secondCategory].includes("desk") && [firstCategory, secondCategory].includes("office_chair")) return "desk_office_chair";
  return null;
}

function explicitPairs(context: AestheticDesignContext): ExplicitPair[] {
  const itemsById = new Map(context.items.map((item) => [item.itemId, item]));
  const pairs: ExplicitPair[] = [];
  for (const group of context.groups) {
    const anchor = group.primaryAnchorItemId ? itemsById.get(group.primaryAnchorItemId) : undefined;
    if (!anchor || anchor.semanticRole !== "PRIMARY_SEATING") continue;
    for (const memberId of group.itemIds) {
      if (memberId === anchor.itemId) continue;
      const member = itemsById.get(memberId);
      if (member?.semanticRole === "AREA_RUG") pairs.push({ first: anchor, second: member, source: { kind: "E10A_GROUP", groupId: group.id } });
    }
  }
  for (const item of context.items) for (const relationship of item.placement.relationships) {
    if (relationship.type !== "GROUPED_WITH") continue;
    const target = itemsById.get(relationship.targetItemId);
    if (target) pairs.push({ first: item, second: target, source: { kind: "SEMANTIC_RELATIONSHIP", relationshipType: "GROUPED_WITH" } });
  }
  return pairs;
}

function discoverPairs(context: AestheticDesignContext) {
  const sofaRugPairs = new Map<string, SofaRugPair>();
  const unsupportedRoomPairs = new Map<string, SofaRugPair>();
  const deferredPairs = new Map<string, DeferredPair>();
  const roomSupported = context.roomType === "living_room" || context.roomType === "family_room";
  for (const pair of explicitPairs(context)) {
    const sofaRug = identifySofaRugPair(pair.first, pair.second);
    if (sofaRug) {
      const key = JSON.stringify(sofaRug.itemIds);
      const destination = roomSupported ? sofaRugPairs : unsupportedRoomPairs;
      const existing = destination.get(key);
      if (existing) existing.sources.push(pair.source);
      else destination.set(key, { ...sofaRug, sources: [pair.source] });
      continue;
    }
    const relationshipType = deferredRelationship(pair.first, pair.second);
    if (!relationshipType) continue;
    const itemIds = canonicalItemIds(pair.first.itemId, pair.second.itemId);
    const relationshipId = `furniture_proportion:${relationshipType}:${pairSuffix(itemIds)}`;
    const key = JSON.stringify([relationshipType, ...itemIds]);
    const reason = deferredReason(relationshipType);
    if (!deferredPairs.has(key)) deferredPairs.set(key, { relationshipType, relationshipId, itemIds, reason });
  }
  for (const pair of [...sofaRugPairs.values(), ...unsupportedRoomPairs.values()]) {
    const seen = new Set<string>();
    pair.sources = pair.sources.filter((source) => {
      const key = source.kind === "E10A_GROUP" ? `E10A_GROUP:${source.groupId}` : source.kind;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((first, second) => compareText(
      first.kind === "E10A_GROUP" ? `E10A_GROUP:${first.groupId}` : first.kind,
      second.kind === "E10A_GROUP" ? `E10A_GROUP:${second.groupId}` : second.kind,
    ));
  }
  return {
    sofaRugPairs: [...sofaRugPairs.values()].sort((first, second) => compareText(first.relationshipId, second.relationshipId)),
    unsupportedRoomPairs: [...unsupportedRoomPairs.values()].sort((first, second) => compareText(first.relationshipId, second.relationshipId)),
    deferredPairs: [...deferredPairs.values()].sort((first, second) => compareText(first.relationshipId, second.relationshipId)),
  };
}

function deferredReason(type: DeferredPair["relationshipType"]): string {
  switch (type) {
    case "dining_table_chair": return "The existing evaluator checks typical table height (70-80 cm) and whether overall chair height is available, but it does not compare table and chair proportions.";
    case "bed_nightstand": return "The existing evaluator checks standalone typical nightstand dimensions (35-70 cm wide, 30-55 cm deep, 45-75 cm high); bed-relative proportion is unavailable.";
    case "desk_office_chair": return "The existing evaluator reports overall dimension availability and leaves ergonomic/functional fit unknown; it does not evaluate desk-chair proportion.";
  }
}

type WidthMeasurement = { value: number | null; source: "catalog" | "design_object" | null };
function explicitWidth(item: AestheticItemContext): WidthMeasurement {
  for (const [source, measurements] of [["design_object", item.metadata.designMeasurements], ["catalog", item.metadata.catalogMeasurements]] as const) {
    if (measurements && measurements.widthCm !== null && Number.isFinite(measurements.widthCm) && measurements.widthCm > 0) {
      return { value: measurements.widthCm, source };
    }
  }
  return { value: null, source: null };
}

function toReportItem(item: AestheticItemContext) {
  const measurements = item.metadata.designMeasurements ?? item.metadata.catalogMeasurements;
  return aestheticItemSchema.parse({
    itemId: item.itemId, role: item.role,
    styleCode: item.metadata.style.status === "KNOWN" ? item.metadata.style.value : null,
    color: item.metadata.color.status === "KNOWN" ? item.metadata.color.value : null,
    materials: item.metadata.materials.status === "KNOWN" ? item.metadata.materials.values : null,
    furnitureAttributes: item.metadata.attributes, visualWeight: item.metadata.visualWeight,
    measurements: { widthCm: measurements?.widthCm ?? null, depthCm: measurements?.depthCm ?? null, heightCm: measurements?.heightCm ?? null },
  });
}

function relationshipForPair(pair: SofaRugPair): AestheticRelationship {
  return { relationshipId: pair.relationshipId, type: "sofa_rug", itemIds: pair.itemIds };
}

function deferredRelationshipForPair(pair: DeferredPair): AestheticRelationship {
  return { relationshipId: pair.relationshipId, type: pair.relationshipType, itemIds: pair.itemIds };
}

function sofaRugFinding(context: AestheticDesignContext, pair: SofaRugPair): AestheticFinding {
  const seatingWidth = explicitWidth(pair.seatingItem);
  const rugWidth = explicitWidth(pair.rugItem);
  const rule = evaluateSofaRugScaleProportion(
    toProportionRole(pair.seatingItem), seatingWidth.value,
    toProportionRole(pair.rugItem), rugWidth.value,
  );
  const pairViolationItemIds = pair.itemIds.filter((id) => context.spatialValidation.violatingItemIds.includes(id));
  const missingItemIds = [
    ...(seatingWidth.value === null ? [pair.seatingItem.itemId] : []),
    ...(rugWidth.value === null ? [pair.rugItem.itemId] : []),
  ].sort(compareText);
  const assessmentReason = missingItemIds.length > 0 ? "MISSING_REQUIRED_WIDTH"
    : pairViolationItemIds.length > 0 ? "PAIR_MEMBER_SPATIAL_VIOLATION" : null;
  const assessmentStatus = assessmentReason === null ? "EVALUATED" : "INSUFFICIENT_EVIDENCE";
  const compatibility = assessmentStatus === "EVALUATED" ? rule.scaleProportion.compatibility : "unknown";
  const impact = compatibility === "compatible" ? "POSITIVE"
    : compatibility === "mixed" ? "MINOR_ISSUE"
      : compatibility === "incompatible" ? "MODERATE_ISSUE" : "NEUTRAL";
  const priority = compatibility === "incompatible" ? "P2" : "P3";
  const code = compatibility === "compatible" ? "proportion.sofa_rug.compatible"
    : compatibility === "unknown" ? "proportion.sofa_rug.insufficient_evidence" : "proportion.sofa_rug.mismatch";
  const explanation = assessmentReason === "MISSING_REQUIRED_WIDTH"
    ? "The existing sofa/rug proportion rule requires explicit seating and rug widths; missing dimensions are not inferred."
    : assessmentReason === "PAIR_MEMBER_SPATIAL_VIOLATION"
      ? "An E.10-A spatial violation affects a pair member, so the sofa/rug proportion judgment is withheld without changing spatial status."
      : rule.scaleProportion.compatibility === "compatible"
        ? "The existing sofa/rug width rule finds the rug proportionate to the related seating."
        : rule.scaleProportion.compatibility === "mixed"
          ? "The existing sofa/rug width rule finds the rug somewhat small relative to the related seating."
          : "The existing sofa/rug width rule finds the rug too small relative to the related seating.";
  const pairItems = [pair.seatingItem, pair.rugItem].sort((first, second) => compareText(first.itemId, second.itemId));
  const observation = {
    kind: "furniture_proportion" as const,
    relationshipType: "sofa_rug" as const,
    pairItems: pairItems.map((item) => {
      if (!item.semanticRole) throw new Error("FURNITURE_PROPORTION_PAIR_ROLE_MISSING");
      return { itemId: item.itemId, semanticRole: item.semanticRole, category: item.category, subtype: item.subtype };
    }),
    relationshipSources: pair.sources,
    measurements: {
      seatingWidthCm: seatingWidth.value, seatingWidthSource: seatingWidth.source,
      rugWidthCm: rugWidth.value, rugWidthSource: rugWidth.source,
      rugToSeatingWidthRatio: seatingWidth.value !== null && rugWidth.value !== null ? rugWidth.value / seatingWidth.value : null,
    },
    rule: {
      evaluatorId: "sofa-rug-relationship", ruleId: SOFA_RUG_PROPORTION_RULE_ID, version: "1.0",
      compatibleAtOrAbove: SOFA_RUG_COMPATIBLE_WIDTH_RATIO, mixedAtOrAbove: SOFA_RUG_MIXED_WIDTH_RATIO,
      ratioMeaning: "rug_width_over_seating_width" as const,
    },
    ruleResult: rule.scaleProportion.compatibility,
    assessmentStatus,
    assessmentReason,
    reasons: rule.scaleProportion.reasons,
  };
  const missingInformation = missingItemIds.map((itemId) => ({
    code: "proportion.sofa_rug.required_width_missing",
    dimension: "scale_proportion" as const,
    itemIds: [itemId],
    description: itemId === pair.seatingItem.itemId ? "Explicit seating width is unavailable." : "Explicit rug width is unavailable.",
  }));
  if (pairViolationItemIds.length > 0) missingInformation.push({
    code: "proportion.sofa_rug.spatial_context_unreliable",
    dimension: "scale_proportion" as const,
    itemIds: pairViolationItemIds,
    description: "One or both pair members have an E.10-A spatial violation.",
  });
  return aestheticFindingSchema.parse({
    findingId: `proportion.sofa_rug:${pairSuffix(pair.itemIds)}`,
    code,
    target: { kind: "relationship", relationshipId: pair.relationshipId, relationshipType: "sofa_rug", dimension: "scale_proportion" },
    subjects: pair.itemIds.map((id) => ({ kind: "ITEM" as const, id })),
    itemIds: pair.itemIds,
    compatibility,
    priority,
    impact,
    explanation,
    evaluator: { evaluatorId: FURNITURE_PROPORTION_EVALUATOR_ID, ruleId: SOFA_RUG_PROPORTION_RULE_ID, version: FURNITURE_PROPORTION_EVALUATOR_VERSION },
    coverage: assessmentStatus === "EVALUATED" ? { status: "EVALUATED" } : { status: "INSUFFICIENT_EVIDENCE", reason: explanation },
    evidenceCompleteness: assessmentStatus === "EVALUATED" ? "complete" : "partial",
    supportingEvidence: [{
      evidenceId: `proportion-evidence.sofa_rug:${pairSuffix(pair.itemIds)}`,
      source: "measured_dimensions",
      dimension: "scale_proportion",
      itemIds: pair.itemIds,
      description: explanation,
      observation,
    }],
    missingInformation,
    recommendationCategory: null,
  });
}

function deferredRoomTypeSupported(type: DeferredPair["relationshipType"], roomType: AestheticDesignContext["roomType"]): boolean {
  if (type === "dining_table_chair") return roomType === "dining_room";
  if (type === "bed_nightstand") return roomType === "bedroom" || roomType === "guest_room";
  return roomType === "home_office";
}

/** Evaluates only explicitly related sofa/rug width proportion; other existing relationship modules are currently deferred. */
export function evaluateFurnitureProportions(context: AestheticDesignContext): AestheticEvaluationReport {
  const discovered = discoverPairs(context);
  const deferredPairs = discovered.deferredPairs.filter((pair) => deferredRoomTypeSupported(pair.relationshipType, context.roomType));
  const pairs = discovered.sofaRugPairs;
  const findings = pairs.map((pair) => sofaRugFinding(context, pair));
  const relationships = [
    ...pairs.map(relationshipForPair),
    ...discovered.unsupportedRoomPairs.map(relationshipForPair),
    ...deferredPairs.map(deferredRelationshipForPair),
  ];
  const deferredDiagnostics = deferredPairs.map((pair) => ({
    code: `proportion.${pair.relationshipType}.deferred`,
    description: pair.reason,
    itemIds: pair.itemIds,
  }));
  const unsupportedRoomDiagnostics = discovered.unsupportedRoomPairs.length > 0 ? [{
    code: "proportion.sofa_rug.room_type_not_supported",
    description: "RoomAI currently applies sofa/rug proportion rules only to living rooms and family rooms.",
    itemIds: [...new Set(discovered.unsupportedRoomPairs.flatMap((pair) => pair.itemIds))].sort(compareText),
  }] : [];
  const unknownPair = findings.some((finding) => finding.coverage.status === "INSUFFICIENT_EVIDENCE");
  const coveredItemIds = [...new Set([...pairs.flatMap((pair) => pair.itemIds), ...deferredPairs.flatMap((pair) => pair.itemIds)])].sort(compareText);
  let coverage: AestheticEvaluationReport["coverage"][number];
  if (pairs.length === 0 && deferredPairs.length === 0) {
    coverage = { dimension: "scale_proportion", status: "NOT_APPLICABLE", itemIds: [], reason: null };
  } else if (deferredPairs.length > 0) {
    coverage = { dimension: "scale_proportion", status: "NOT_EVALUATED", itemIds: coveredItemIds, reason: "One or more explicit furniture relationships have no existing pairwise proportion evaluator." };
  } else if (unknownPair) {
    coverage = { dimension: "scale_proportion", status: "INSUFFICIENT_EVIDENCE", itemIds: coveredItemIds, reason: "One or more related sofa/rug pairs lack reliable width evidence or have a pair-member spatial violation." };
  } else {
    coverage = { dimension: "scale_proportion", status: "EVALUATED", itemIds: coveredItemIds, reason: null };
  }
  const diagnostics = [...deferredDiagnostics, ...unsupportedRoomDiagnostics];
  return buildAestheticEvaluationReport({
    context,
    items: context.items.map(toReportItem),
    relationships,
    findings,
    coverage: [coverage],
    diagnostics,
  });
}