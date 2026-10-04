import type { NormalizedDesignColor } from "./color-harmony";
import { evaluateCandidateColorHarmony, evaluateColorPairHarmony } from "./color-harmony";
import type { AestheticDesignContext, AestheticItemContext } from "./aesthetic-context";
import {
  aestheticFindingSchema,
  aestheticItemSchema,
  type AestheticEvaluationReport,
  type AestheticFinding,
  type AestheticRelationship,
} from "./aesthetic-contracts";
import { buildAestheticEvaluationReport } from "./aesthetic-report";

export const COLOR_HARMONY_EVALUATOR_ID = "color-harmony";
export const COLOR_HARMONY_EVALUATOR_VERSION = "1.0";
export const COLOR_PALETTE_RULE_ID = "normalized_color_against_customer_palette";
export const COLOR_PAIR_RULE_ID = "normalized_color_family_pair_harmony";

type PaletteRole = "primary" | "secondary" | "accent";
type PaletteColor = { role: PaletteRole; color: NormalizedDesignColor };
type RelationshipSource =
  | { kind: "E10A_GROUP"; groupId: string }
  | { kind: "SEMANTIC_RELATIONSHIP"; relationshipType: "GROUPED_WITH" };
type ColorPair = {
  relationshipId: string;
  relationshipType: "sofa_rug" | "furniture_coordination";
  itemIds: [string, string];
  first: AestheticItemContext;
  second: AestheticItemContext;
  sources: RelationshipSource[];
};
type ExplicitPairSource = { first: AestheticItemContext; second: AestheticItemContext; source: RelationshipSource };

const compareText = (first: string, second: string) => first < second ? -1 : first > second ? 1 : 0;
const pairSuffix = (itemIds: readonly [string, string]) => itemIds.map((itemId) => `${itemId.length}:${itemId}`).join(":");

function canonicalItemIds(first: string, second: string): [string, string] {
  return compareText(first, second) <= 0 ? [first, second] : [second, first];
}

function itemColor(item: AestheticItemContext): NormalizedDesignColor | null {
  return item.metadata.color.status === "KNOWN" ? item.metadata.color.value : null;
}

function itemColorSource(item: AestheticItemContext) {
  return item.metadata.color.status === "KNOWN" ? item.metadata.color.source : null;
}

function paletteInputs(context: AestheticDesignContext): { requested: boolean; colors: PaletteColor[] } {
  const preferences = context.preferences;
  if (!preferences) return { requested: false, colors: [] };
  const entries = (["primary", "secondary", "accent"] as const).map((role) => ({ role, preference: preferences.palette[role] }));
  return {
    requested: entries.some(({ preference }) => preference.status === "KNOWN" || preference.raw !== null),
    colors: entries.flatMap(({ role, preference }) => preference.status === "KNOWN" ? [{ role, color: preference.value }] : []),
  };
}

function matchedPaletteRole(reasons: readonly string[]): PaletteRole | null {
  for (const role of ["primary", "secondary", "accent"] as const) {
    if (reasons.some((reason) => reason.endsWith(`_${role}_color`) || reason.endsWith(`_${role}`))) return role;
  }
  return null;
}

function paletteRelationship(reasons: readonly string[]) {
  if (reasons.some((reason) => reason.startsWith("candidate_matches_"))) return "IDENTICAL" as const;
  if (reasons.some((reason) => reason.startsWith("candidate_same_family_as_"))) return "SIMILAR" as const;
  if (reasons.some((reason) => reason.startsWith("candidate_harmonizes_with_"))) return "COORDINATED" as const;
  return "UNKNOWN" as const;
}

function paletteFinding(
  preferences: NonNullable<AestheticDesignContext["preferences"]>,
  paletteColors: PaletteColor[],
  item: AestheticItemContext,
): AestheticFinding {
  const color = itemColor(item);
  const result = evaluateCandidateColorHarmony(preferences.intent, { normalizedColor: color?.value ?? null });
  const relationship = paletteRelationship(result.reasons);
  const insufficient = result.compatibility === "unknown";
  const unaligned = result.reasons.includes("candidate_color_valid_but_not_aligned");
  const impact = insufficient || unaligned ? "NEUTRAL" : "POSITIVE";
  const code = insufficient ? "color.palette.insufficient_evidence"
    : unaligned ? "color.palette.valid_but_not_aligned" : "color.palette.coordinated";
  const explanation = result.reasons.includes("candidate_color_missing")
    ? "The item has no normalized color evidence to compare with the supplied customer palette."
    : result.reasons.includes("candidate_color_unknown")
      ? "The item color is not recognized by RoomAI's existing normalized color vocabulary."
      : result.reasons.includes("design_color_intent_missing")
        ? "Palette color text is present but unsupported by RoomAI's existing normalized color vocabulary."
        : unaligned
          ? "This normalized item color is valid but not aligned with the supplied palette under RoomAI's existing rules; this is not an intrinsic color conflict."
          : "The normalized item color is identical, similar, or harmonized with a supplied customer palette color under RoomAI's existing rules.";
  const observation = {
    kind: "item_color_harmony" as const,
    itemId: item.itemId,
    color,
    colorSource: itemColorSource(item),
    paletteColors,
    matchedPaletteRole: matchedPaletteRole(result.reasons),
    relationship,
    compatibility: result.compatibility,
    reasons: result.reasons,
  };
  return aestheticFindingSchema.parse({
    findingId: `color.palette:${item.itemId}`,
    code,
    target: { kind: "dimension", dimension: "color_harmony" },
    subjects: [{ kind: "ITEM", id: item.itemId }],
    itemIds: [item.itemId],
    compatibility: result.compatibility,
    priority: "P3",
    impact,
    explanation,
    evaluator: { evaluatorId: COLOR_HARMONY_EVALUATOR_ID, ruleId: COLOR_PALETTE_RULE_ID, version: COLOR_HARMONY_EVALUATOR_VERSION },
    coverage: insufficient ? { status: "INSUFFICIENT_EVIDENCE", reason: explanation } : { status: "EVALUATED" },
    evidenceCompleteness: insufficient ? "partial" : "complete",
    supportingEvidence: [{
      evidenceId: `color-evidence.palette:${item.itemId}`,
      source: "normalized_attributes",
      dimension: "color_harmony",
      itemIds: [item.itemId],
      description: explanation,
      observation,
    }],
    missingInformation: insufficient ? [{
      code: "color.palette.evidence_unavailable",
      dimension: "color_harmony",
      itemIds: [item.itemId],
      description: explanation,
    }] : [],
    recommendationCategory: null,
  });
}

function explicitPairSources(context: AestheticDesignContext): ExplicitPairSource[] {
  const byId = new Map(context.items.map((item) => [item.itemId, item]));
  const sources: ExplicitPairSource[] = [];
  if (context.roomType === "living_room" || context.roomType === "family_room") {
    for (const group of context.groups) {
      const anchor = group.primaryAnchorItemId ? byId.get(group.primaryAnchorItemId) : undefined;
      if (!anchor || anchor.semanticRole !== "PRIMARY_SEATING") continue;
      for (const itemId of group.itemIds) {
        if (itemId === anchor.itemId) continue;
        const member = byId.get(itemId);
        if (member) sources.push({ first: anchor, second: member, source: { kind: "E10A_GROUP", groupId: group.id } });
      }
    }
  }
  for (const item of context.items) for (const relationship of item.placement.relationships) {
    if (relationship.type !== "GROUPED_WITH") continue;
    const target = byId.get(relationship.targetItemId);
    if (target) sources.push({ first: item, second: target, source: { kind: "SEMANTIC_RELATIONSHIP", relationshipType: "GROUPED_WITH" } });
  }
  return sources;
}

function colorPairType(first: AestheticItemContext, second: AestheticItemContext): ColorPair["relationshipType"] {
  const categories = [first.category.trim().toLowerCase().replace(/[\s-]+/g, "_"), second.category.trim().toLowerCase().replace(/[\s-]+/g, "_")];
  if ((first.semanticRole === "AREA_RUG" || second.semanticRole === "AREA_RUG")
    && (categories.some((category) => ["sofa", "loveseat", "sectional", "sectional_sofa", "sofa_with_chaise"].includes(category)))) {
    return "sofa_rug";
  }
  return "furniture_coordination";
}

function discoverPairs(context: AestheticDesignContext): ColorPair[] {
  const pairs = new Map<string, ColorPair>();
  for (const association of explicitPairSources(context)) {
    if (association.first.itemId === association.second.itemId) continue;
    const itemIds = canonicalItemIds(association.first.itemId, association.second.itemId);
    const relationshipType = colorPairType(association.first, association.second);
    if (relationshipType === "sofa_rug" && context.roomType !== "living_room" && context.roomType !== "family_room") continue;
    const relationshipId = `color_harmony:${relationshipType}:${pairSuffix(itemIds)}`;
    const key = JSON.stringify([relationshipType, ...itemIds]);
    const existing = pairs.get(key);
    if (existing) existing.sources.push(association.source);
    else {
      const byId = new Map([[association.first.itemId, association.first], [association.second.itemId, association.second]]);
      const first = byId.get(itemIds[0]);
      const second = byId.get(itemIds[1]);
      if (!first || !second) throw new Error("COLOR_PAIR_MEMBER_MISSING");
      pairs.set(key, { relationshipId, relationshipType, itemIds, first, second, sources: [association.source] });
    }
  }
  for (const pair of pairs.values()) {
    const sourceIds = new Set<string>();
    pair.sources = pair.sources.filter((source) => {
      const id = source.kind === "E10A_GROUP" ? `${source.kind}:${source.groupId}` : source.kind;
      if (sourceIds.has(id)) return false;
      sourceIds.add(id);
      return true;
    }).sort((first, second) => compareText(
      first.kind === "E10A_GROUP" ? `${first.kind}:${first.groupId}` : first.kind,
      second.kind === "E10A_GROUP" ? `${second.kind}:${second.groupId}` : second.kind,
    ));
  }
  return [...pairs.values()].sort((first, second) => compareText(first.relationshipId, second.relationshipId));
}

function pairFinding(pair: ColorPair): AestheticFinding {
  const first = itemColor(pair.first);
  const second = itemColor(pair.second);
  const result = evaluateColorPairHarmony(first?.value ?? null, second?.value ?? null);
  const insufficient = result.compatibility === "unknown";
  const unaligned = result.reasons.includes("relationship_colors_valid_but_not_aligned");
  const impact = insufficient || unaligned ? "NEUTRAL" : "POSITIVE";
  const code = insufficient ? "color.pair.insufficient_evidence"
    : unaligned ? "color.pair.valid_but_not_aligned" : "color.pair.coordinated";
  const explanation = insufficient
    ? "One or both explicitly associated items lack a supported normalized color."
    : unaligned
      ? "The explicitly related normalized colors are valid but not aligned under RoomAI's existing family rules; difference alone is not called conflict."
      : `The explicitly related colors are ${result.relationship.toLowerCase()} under RoomAI's existing family rules; exact sameness is not ranked above coordination.`;
  const pairItems = [pair.first, pair.second].sort((firstItem, secondItem) => compareText(firstItem.itemId, secondItem.itemId));
  const observation = {
    kind: "pair_color_harmony" as const,
    relationshipType: pair.relationshipType,
    pairItems: pairItems.map((item) => ({
      itemId: item.itemId, semanticRole: item.semanticRole, category: item.category, subtype: item.subtype,
      color: itemColor(item), colorSource: itemColorSource(item),
    })),
    relationshipSources: pair.sources,
    relationship: result.relationship,
    compatibility: result.compatibility,
    reasons: result.reasons,
  };
  const missingIds = pair.itemIds.filter((id) => {
    const member = id === pair.first.itemId ? pair.first : pair.second;
    return itemColor(member) === null;
  });
  return aestheticFindingSchema.parse({
    findingId: `color.pair:${pairSuffix(pair.itemIds)}`,
    code,
    target: { kind: "relationship", relationshipId: pair.relationshipId, relationshipType: pair.relationshipType, dimension: "color_harmony" },
    subjects: pair.itemIds.map((id) => ({ kind: "ITEM" as const, id })),
    itemIds: pair.itemIds,
    compatibility: result.compatibility,
    priority: "P3",
    impact,
    explanation,
    evaluator: { evaluatorId: COLOR_HARMONY_EVALUATOR_ID, ruleId: COLOR_PAIR_RULE_ID, version: COLOR_HARMONY_EVALUATOR_VERSION },
    coverage: insufficient ? { status: "INSUFFICIENT_EVIDENCE", reason: explanation } : { status: "EVALUATED" },
    evidenceCompleteness: insufficient ? "partial" : "complete",
    supportingEvidence: [{ evidenceId: `color-evidence.pair:${pairSuffix(pair.itemIds)}`, source: "normalized_attributes", dimension: "color_harmony", itemIds: pair.itemIds, description: explanation, observation }],
    missingInformation: insufficient ? [{ code: "color.pair.normalized_color_missing", dimension: "color_harmony", itemIds: missingIds, description: explanation }] : [],
    recommendationCategory: null,
  });
}

function toReportItem(item: AestheticItemContext) {
  const measurements = item.metadata.designMeasurements ?? item.metadata.catalogMeasurements;
  return aestheticItemSchema.parse({
    itemId: item.itemId, role: item.role,
    styleCode: item.metadata.style.status === "KNOWN" ? item.metadata.style.value : null,
    color: item.metadata.color.status === "KNOWN" ? item.metadata.color.value : null,
    materials: item.metadata.materials.status === "KNOWN" ? item.metadata.materials.values : null,
    furnitureAttributes: item.metadata.attributes, visualWeight: "UNKNOWN",
    measurements: { widthCm: measurements?.widthCm ?? null, depthCm: measurements?.depthCm ?? null, heightCm: measurements?.heightCm ?? null },
  });
}

/** Reuses existing normalized palette/pair rules; never creates arbitrary item pairs or intrinsic conflict findings. */
export function evaluateColorHarmony(context: AestheticDesignContext): AestheticEvaluationReport {
  const palettePreferences = context.preferences;
  const palette = paletteInputs(context);
  const paletteFindings = palette.requested && palettePreferences
    ? context.items.map((item) => paletteFinding(palettePreferences, palette.colors, item))
    : [];
  const pairs = discoverPairs(context);
  const pairFindings = pairs.map(pairFinding);
  const findings = [...paletteFindings, ...pairFindings];
  const relationships: AestheticRelationship[] = pairs.map((pair) => ({
    relationshipId: pair.relationshipId, type: pair.relationshipType, itemIds: pair.itemIds,
  }));
  const hasApplicableEvidence = paletteFindings.length > 0 || pairFindings.length > 0;
  const incomplete = findings.some((finding) => finding.coverage.status === "INSUFFICIENT_EVIDENCE");
  const itemIds = [...new Set([...paletteFindings.flatMap((finding) => finding.itemIds), ...pairs.flatMap((pair) => pair.itemIds)])].sort(compareText);
  const coverage = !hasApplicableEvidence
    ? { dimension: "color_harmony" as const, status: "NOT_APPLICABLE" as const, itemIds: [], reason: null }
    : incomplete
      ? { dimension: "color_harmony" as const, status: "INSUFFICIENT_EVIDENCE" as const, itemIds, reason: "One or more applicable color relationships lack supported normalized color evidence." }
      : { dimension: "color_harmony" as const, status: "EVALUATED" as const, itemIds, reason: null };
  return buildAestheticEvaluationReport({
    context,
    items: context.items.map(toReportItem),
    relationships,
    findings,
    coverage: [coverage],
  });
}
