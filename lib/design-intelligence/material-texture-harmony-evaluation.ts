import type { AestheticDesignContext, AestheticItemContext } from "./aesthetic-context";
import {
  aestheticFindingSchema,
  aestheticItemSchema,
  type AestheticEvaluationReport,
  type AestheticFinding,
  type AestheticRelationship,
} from "./aesthetic-contracts";
import { evaluateCandidateMaterialHarmony, normalizeDesignMaterial } from "./material-harmony";
import { evaluateFurnitureAttributeCompatibility } from "./furniture-attribute-compatibility";
import type { DesignCompatibility } from "./schema";
import { buildAestheticEvaluationReport } from "./aesthetic-report";

export const MATERIAL_TEXTURE_EVALUATOR_ID = "material-texture-harmony";
export const MATERIAL_TEXTURE_EVALUATOR_VERSION = "1.0";
export const MATERIAL_PREFERENCE_RULE_ID = "existing_candidate_material_preference";
export const MATERIAL_PAIR_RULE_ID = "existing_upholstery_attribute_compatibility";
export const TEXTURE_PAIR_RULE_ID = "existing_fabric_texture_attribute_compatibility";

type RelationshipSource =
  | { kind: "E10A_GROUP"; groupId: string }
  | { kind: "SEMANTIC_RELATIONSHIP"; relationshipType: "GROUPED_WITH" };
type MaterialPair = {
  relationshipId: string;
  relationshipType: "sofa_rug" | "furniture_coordination";
  itemIds: [string, string];
  first: AestheticItemContext;
  second: AestheticItemContext;
  sources: RelationshipSource[];
};
type PairAssociation = { first: AestheticItemContext; second: AestheticItemContext; source: RelationshipSource };

const compareText = (first: string, second: string) => first < second ? -1 : first > second ? 1 : 0;
const pairSuffix = (itemIds: readonly [string, string]) => itemIds.map((itemId) => `${itemId.length}:${itemId}`).join(":");

function canonicalItemIds(first: string, second: string): [string, string] {
  return compareText(first, second) <= 0 ? [first, second] : [second, first];
}

function itemMaterial(item: AestheticItemContext) {
  return item.metadata.materials.status === "KNOWN" ? item.metadata.materials.values[0] ?? null : null;
}

function itemMaterialSource(item: AestheticItemContext) {
  return item.metadata.materials.status === "KNOWN" ? item.metadata.materials.source : null;
}

function materialPreferenceRequested(context: AestheticDesignContext): boolean {
  const preferences = context.preferences;
  if (!preferences) return false;
  return [...preferences.preferredMaterials, ...preferences.avoidMaterials]
    .some((preference) => preference.status === "KNOWN" || preference.raw !== null);
}

function materialPreferenceFinding(
  preferences: NonNullable<AestheticDesignContext["preferences"]>,
  item: AestheticItemContext,
): AestheticFinding {
  const material = itemMaterial(item);
  const evaluated = item.metadata.materials.status === "UNKNOWN" && item.metadata.materials.reason === "UNRECOGNIZED_VALUE"
    ? { compatibility: "unknown" as const, reasons: ["candidate_material_unknown"] }
    : evaluateCandidateMaterialHarmony(preferences.intent, { normalizedMaterial: material?.value ?? null });
  const avoided = evaluated.reasons.some((reason) => reason.startsWith("candidate_matches_avoided_material"));
  const preferred = evaluated.reasons.some((reason) => reason.startsWith("candidate_matches_preferred_material"));
  const relationship = evaluated.reasons.includes("candidate_matches_preferred_material") ? "IDENTICAL" as const
    : evaluated.reasons.includes("candidate_matches_preferred_material_family") ? "SIMILAR" as const
      : avoided ? "CONFLICTING" as const : "UNKNOWN" as const;
  const preferenceRole = avoided ? "AVOIDED" as const : preferred ? "PREFERRED" as const : null;
  const insufficient = evaluated.compatibility === "unknown";
  const impact = avoided ? "MINOR_ISSUE" as const : preferred ? "POSITIVE" as const : "NEUTRAL" as const;
  const code = avoided ? "material.preference.explicitly_avoided"
    : preferred ? "material.preference.aligned"
      : evaluated.compatibility === "mixed" ? "material.preference.not_aligned" : "material.preference.insufficient_evidence";
  const explanation = avoided
    ? "The normalized item material matches an explicit customer avoid-material preference under RoomAI's existing material rules."
    : preferred
      ? "The normalized item material matches an explicit preferred material or family under RoomAI's existing material rules."
      : evaluated.reasons.includes("candidate_material_missing")
        ? "No normalized material evidence is available for comparison with the supplied customer material preferences."
        : evaluated.reasons.includes("candidate_material_unknown")
          ? "The supplied item material is not recognized by RoomAI's existing normalized material vocabulary."
          : evaluated.reasons.includes("design_material_intent_missing")
            ? "No supported customer material preference was available for this item."
            : "This normalized material is valid but is not listed as preferred; that alone is not a material conflict.";
  const observation = {
    kind: "item_material_harmony" as const,
    itemId: item.itemId,
    material,
    materialSource: itemMaterialSource(item),
    preferenceRole,
    relationship,
    compatibility: evaluated.compatibility,
    reasons: evaluated.reasons,
  };
  return aestheticFindingSchema.parse({
    findingId: `material.preference:${item.itemId}`,
    code,
    target: { kind: "dimension", dimension: "material_harmony" },
    subjects: [{ kind: "ITEM", id: item.itemId }],
    itemIds: [item.itemId],
    compatibility: evaluated.compatibility,
    priority: "P3",
    impact,
    explanation,
    evaluator: { evaluatorId: MATERIAL_TEXTURE_EVALUATOR_ID, ruleId: MATERIAL_PREFERENCE_RULE_ID, version: MATERIAL_TEXTURE_EVALUATOR_VERSION },
    coverage: insufficient ? { status: "INSUFFICIENT_EVIDENCE", reason: explanation } : { status: "EVALUATED" },
    evidenceCompleteness: insufficient ? "partial" : "complete",
    supportingEvidence: [{
      evidenceId: `material-evidence.preference:${item.itemId}`,
      source: "normalized_attributes",
      dimension: "material_harmony",
      itemIds: [item.itemId],
      description: explanation,
      observation,
    }],
    missingInformation: insufficient ? [{
      code: "material.preference.evidence_unavailable",
      dimension: "material_harmony",
      itemIds: [item.itemId],
      description: explanation,
    }] : [],
    recommendationCategory: null,
  });
}

function pairAssociations(context: AestheticDesignContext): PairAssociation[] {
  const byId = new Map(context.items.map((item) => [item.itemId, item]));
  const associations: PairAssociation[] = [];
  if (context.roomType === "living_room" || context.roomType === "family_room") {
    for (const group of context.groups) {
      const anchor = group.primaryAnchorItemId ? byId.get(group.primaryAnchorItemId) : undefined;
      if (!anchor || anchor.semanticRole !== "PRIMARY_SEATING") continue;
      for (const itemId of group.itemIds) {
        if (itemId === anchor.itemId) continue;
        const member = byId.get(itemId);
        if (member) associations.push({ first: anchor, second: member, source: { kind: "E10A_GROUP", groupId: group.id } });
      }
    }
  }
  for (const item of context.items) for (const relationship of item.placement.relationships) {
    if (relationship.type !== "GROUPED_WITH") continue;
    const target = byId.get(relationship.targetItemId);
    if (target) associations.push({ first: item, second: target, source: { kind: "SEMANTIC_RELATIONSHIP", relationshipType: "GROUPED_WITH" } });
  }
  return associations;
}

function relationshipType(first: AestheticItemContext, second: AestheticItemContext): MaterialPair["relationshipType"] {
  const categories = [first.category.trim().toLowerCase().replace(/[\s-]+/g, "_"), second.category.trim().toLowerCase().replace(/[\s-]+/g, "_")];
  const seatingTypes = ["sofa", "loveseat", "sectional", "sectional_sofa", "sofa_with_chaise"];
  if ((first.semanticRole === "AREA_RUG" || second.semanticRole === "AREA_RUG") && categories.some((category) => seatingTypes.includes(category))) return "sofa_rug";
  return "furniture_coordination";
}

function discoverPairs(context: AestheticDesignContext): MaterialPair[] {
  const pairs = new Map<string, MaterialPair>();
  for (const association of pairAssociations(context)) {
    if (association.first.itemId === association.second.itemId) continue;
    const itemIds = canonicalItemIds(association.first.itemId, association.second.itemId);
    const pairType = relationshipType(association.first, association.second);
    const relationshipId = `material_texture:${pairType}:${pairSuffix(itemIds)}`;
    const key = JSON.stringify([pairType, ...itemIds]);
    const existing = pairs.get(key);
    if (existing) existing.sources.push(association.source);
    else {
      const members = new Map([[association.first.itemId, association.first], [association.second.itemId, association.second]]);
      const first = members.get(itemIds[0]);
      const second = members.get(itemIds[1]);
      if (!first || !second) throw new Error("MATERIAL_PAIR_MEMBER_MISSING");
      pairs.set(key, { relationshipId, relationshipType: pairType, itemIds, first, second, sources: [association.source] });
    }
  }
  for (const pair of pairs.values()) {
    const seen = new Set<string>();
    pair.sources = pair.sources.filter((source) => {
      const key = source.kind === "E10A_GROUP" ? `${source.kind}:${source.groupId}` : source.kind;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((first, second) => compareText(
      first.kind === "E10A_GROUP" ? `${first.kind}:${first.groupId}` : first.kind,
      second.kind === "E10A_GROUP" ? `${second.kind}:${second.groupId}` : second.kind,
    ));
  }
  return [...pairs.values()].sort((first, second) => compareText(first.relationshipId, second.relationshipId));
}

function pairItemMaterial(item: AestheticItemContext) {
  return normalizeDesignMaterial(item.metadata.attributes.upholsteryMaterial);
}

function pairItemTexture(item: AestheticItemContext) {
  return item.metadata.texture.status === "KNOWN" ? item.metadata.texture.value : null;
}

function pairMaterialFinding(pair: MaterialPair): AestheticFinding {
  const firstAttributes = pair.first.metadata.attributes;
  const secondAttributes = pair.second.metadata.attributes;
  const comparison = evaluateFurnitureAttributeCompatibility(firstAttributes, secondAttributes).attributes;
  const typeResult = comparison.upholsteryType;
  const materialResult = comparison.upholsteryMaterial;
  const hasUpholsteryEvidence = firstAttributes.upholsteryType !== null || secondAttributes.upholsteryType !== null
    || firstAttributes.upholsteryMaterial !== null || secondAttributes.upholsteryMaterial !== null;
  const hasGeneralMaterial = pair.first.metadata.materials.status === "KNOWN" || pair.second.metadata.materials.status === "KNOWN";
  const ruleUnavailable = !hasUpholsteryEvidence && hasGeneralMaterial;
  const reasons = ruleUnavailable
    ? ["material_pair_rule_unavailable"]
    : [...typeResult.reasons, ...materialResult.reasons];
  const compatibility: DesignCompatibility = ruleUnavailable ? "unknown"
    : [typeResult.compatibility, materialResult.compatibility].includes("mixed") ? "mixed"
      : [typeResult.compatibility, materialResult.compatibility].includes("compatible") ? "compatible" : "unknown";
  const relationship = materialResult.reasons.includes("upholsteryMaterial_match") ? "IDENTICAL" as const
    : materialResult.reasons.includes("upholsteryMaterial_shared_material_family") ? "SIMILAR" as const : "UNKNOWN" as const;
  const pairItems = [pair.first, pair.second].map((item) => ({
    itemId: item.itemId,
    semanticRole: item.semanticRole,
    material: itemMaterial(item),
    materialSource: itemMaterialSource(item),
    upholsteryType: item.metadata.attributes.upholsteryType,
    upholsteryMaterial: pairItemMaterial(item),
  }));
  const missingIds = pair.itemIds.filter((id) => {
    const item = id === pair.first.itemId ? pair.first : pair.second;
    return item.metadata.attributes.upholsteryType === null && item.metadata.attributes.upholsteryMaterial === null;
  });
  const insufficient = !ruleUnavailable && compatibility === "unknown";
  const explanation = ruleUnavailable
    ? "The pair has general normalized materials, but RoomAI has no repository-backed rule for comparing those material combinations."
    : insufficient
      ? "The explicitly associated items lack sufficient structured upholstery evidence for RoomAI's existing pair comparison."
      : compatibility === "mixed"
        ? "RoomAI's existing upholstery comparison reports a difference; this does not establish a material conflict."
        : "The explicit upholstery attributes are compatible under RoomAI's existing comparison; exact sameness is not ranked above shared-family compatibility.";
  const coverage = ruleUnavailable ? { status: "NOT_EVALUATED" as const, reason: explanation }
    : insufficient ? { status: "INSUFFICIENT_EVIDENCE" as const, reason: explanation }
      : { status: "EVALUATED" as const };
  return aestheticFindingSchema.parse({
    findingId: `material.pair:${pairSuffix(pair.itemIds)}`,
    code: ruleUnavailable ? "material.pair.rule_unavailable" : insufficient ? "material.pair.insufficient_evidence"
      : compatibility === "mixed" ? "material.pair.different_upholstery" : "material.pair.upholstery_compatible",
    target: { kind: "relationship", relationshipId: `material_harmony:${pair.relationshipType}:${pairSuffix(pair.itemIds)}`, relationshipType: pair.relationshipType, dimension: "material_harmony" },
    subjects: pair.itemIds.map((id) => ({ kind: "ITEM" as const, id })),
    itemIds: pair.itemIds,
    compatibility,
    priority: "P3",
    impact: "NEUTRAL",
    explanation,
    evaluator: { evaluatorId: MATERIAL_TEXTURE_EVALUATOR_ID, ruleId: MATERIAL_PAIR_RULE_ID, version: MATERIAL_TEXTURE_EVALUATOR_VERSION },
    coverage,
    evidenceCompleteness: coverage.status === "EVALUATED" ? "complete" : "partial",
    supportingEvidence: [{
      evidenceId: `material-evidence.pair:${pairSuffix(pair.itemIds)}`,
      source: "normalized_attributes",
      dimension: "material_harmony",
      itemIds: pair.itemIds,
      description: explanation,
      observation: {
        kind: "pair_material_harmony",
        relationshipType: pair.relationshipType,
        pairItems,
        relationshipSources: pair.sources,
        relationship,
        compatibility,
        reasons,
      },
    }],
    missingInformation: coverage.status === "EVALUATED" ? [] : [{
      code: ruleUnavailable ? "material.pair.relationship_rule_unavailable" : "material.pair.upholstery_evidence_unavailable",
      dimension: "material_harmony",
      itemIds: ruleUnavailable ? pair.itemIds : missingIds,
      description: explanation,
    }],
    recommendationCategory: null,
  });
}

function pairTextureFinding(pair: MaterialPair): AestheticFinding {
  const comparison = evaluateFurnitureAttributeCompatibility(pair.first.metadata.attributes, pair.second.metadata.attributes).attributes.fabricTexture;
  const relationship = comparison.reasons.includes("fabricTexture_match") ? "IDENTICAL" as const : "UNKNOWN" as const;
  const insufficient = comparison.compatibility === "unknown";
  const explanation = insufficient
    ? "One or both explicitly associated items lack a supported normalized fabric-texture attribute."
    : comparison.compatibility === "mixed"
      ? "RoomAI's existing fabric-texture comparison reports a difference; that difference alone is not a conflict."
      : "The explicit fabric-texture attributes match under RoomAI's existing attribute comparison; matching textures are not ranked as inherently superior.";
  const pairItems = [pair.first, pair.second].map((item) => ({
    itemId: item.itemId,
    semanticRole: item.semanticRole,
    texture: pairItemTexture(item),
    textureSource: item.metadata.texture.status === "KNOWN" ? item.metadata.texture.source : null,
  }));
  const missingIds = pairItems.filter((item) => item.texture === null).map((item) => item.itemId);
  return aestheticFindingSchema.parse({
    findingId: `texture.pair:${pairSuffix(pair.itemIds)}`,
    code: insufficient ? "texture.pair.insufficient_evidence"
      : comparison.compatibility === "mixed" ? "texture.pair.different_fabric_texture" : "texture.pair.matching_fabric_texture",
    target: { kind: "relationship", relationshipId: `texture_harmony:${pair.relationshipType}:${pairSuffix(pair.itemIds)}`, relationshipType: pair.relationshipType, dimension: "texture_harmony" },
    subjects: pair.itemIds.map((id) => ({ kind: "ITEM" as const, id })),
    itemIds: pair.itemIds,
    compatibility: comparison.compatibility,
    priority: "P3",
    impact: "NEUTRAL",
    explanation,
    evaluator: { evaluatorId: MATERIAL_TEXTURE_EVALUATOR_ID, ruleId: TEXTURE_PAIR_RULE_ID, version: MATERIAL_TEXTURE_EVALUATOR_VERSION },
    coverage: insufficient ? { status: "INSUFFICIENT_EVIDENCE", reason: explanation } : { status: "EVALUATED" },
    evidenceCompleteness: insufficient ? "partial" : "complete",
    supportingEvidence: [{
      evidenceId: `texture-evidence.pair:${pairSuffix(pair.itemIds)}`,
      source: "normalized_attributes",
      dimension: "texture_harmony",
      itemIds: pair.itemIds,
      description: explanation,
      observation: {
        kind: "pair_texture_harmony",
        relationshipType: pair.relationshipType,
        pairItems,
        relationshipSources: pair.sources,
        relationship,
        compatibility: comparison.compatibility,
        reasons: comparison.reasons,
      },
    }],
    missingInformation: insufficient ? [{
      code: "texture.pair.fabric_texture_unavailable",
      dimension: "texture_harmony",
      itemIds: missingIds,
      description: explanation,
    }] : [],
    recommendationCategory: null,
  });
}

function dimensionCoverage(
  dimension: "material_harmony" | "texture_harmony",
  findings: readonly AestheticFinding[],
  itemIds: readonly string[],
  deferredReason?: string,
) {
  const ids = [...new Set(itemIds)].sort(compareText);
  if (!findings.length) {
    return deferredReason
      ? { dimension, status: "NOT_EVALUATED" as const, itemIds: ids, reason: deferredReason }
      : { dimension, status: "NOT_APPLICABLE" as const, itemIds: [], reason: null };
  }
  const statuses = findings.map((finding) => finding.coverage.status);
  const status = statuses.includes("INSUFFICIENT_EVIDENCE") || statuses.includes("NOT_EVALUATED") && statuses.includes("EVALUATED")
    ? "INSUFFICIENT_EVIDENCE" as const
    : statuses.includes("NOT_EVALUATED") ? "NOT_EVALUATED" as const : "EVALUATED" as const;
  return {
    dimension,
    status,
    itemIds: ids,
    reason: status === "EVALUATED" ? null : status === "NOT_EVALUATED"
      ? "No repository-backed rule evaluates every applicable item relationship for this dimension."
      : "One or more applicable material or texture comparisons lack sufficient supported evidence.",
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
    measurements: { widthCm: measurements?.widthCm ?? null, depthCm: measurements?.depthCm ?? null, heightCm: measurements?.heightCm ?? null },
  });
}

/** Adapts only existing material-preference and normalized upholstery/texture rules into B.1. */
export function evaluateMaterialTextureHarmony(context: AestheticDesignContext): AestheticEvaluationReport {
  const pairs = discoverPairs(context);
  const preferences = context.preferences;
  const preferenceFindings = preferences && materialPreferenceRequested(context)
    ? context.items.map((item) => materialPreferenceFinding(preferences, item))
    : [];
  const materialPairFindings = pairs.map(pairMaterialFinding);
  const textureFindings = pairs.map(pairTextureFinding);
  const materialFindings = [...preferenceFindings, ...materialPairFindings];
  const materialItemIds = [...new Set(materialFindings.flatMap((finding) => finding.itemIds))].sort(compareText);
  const textureItemIds = [...new Set(textureFindings.flatMap((finding) => finding.itemIds))].sort(compareText);
  const knownTextureIds = context.items.filter((item) => item.metadata.texture.status === "KNOWN").map((item) => item.itemId);
  const unsupportedMaterialPairs = materialPairFindings.some((finding) => finding.coverage.status === "NOT_EVALUATED");
  const materialCoverage = dimensionCoverage("material_harmony", materialFindings, materialItemIds);
  const textureCoverage = dimensionCoverage("texture_harmony", textureFindings, textureItemIds,
    !pairs.length && knownTextureIds.length ? "Normalized texture attributes are available, but no standalone or customer-preference texture rule exists." : undefined);
  const relationships: AestheticRelationship[] = pairs.flatMap((pair) => [
    { relationshipId: `material_harmony:${pair.relationshipType}:${pairSuffix(pair.itemIds)}`, type: pair.relationshipType, itemIds: pair.itemIds },
    { relationshipId: `texture_harmony:${pair.relationshipType}:${pairSuffix(pair.itemIds)}`, type: pair.relationshipType, itemIds: pair.itemIds },
  ]);
  const diagnostics = [
    ...(unsupportedMaterialPairs ? [{
      code: "material.pair.general_material_rule_unavailable",
      description: "RoomAI has no repository-backed pair rule for general structural-material combinations; those relationships remain not evaluated.",
      itemIds: [...new Set(materialPairFindings.filter((finding) => finding.coverage.status === "NOT_EVALUATED").flatMap((finding) => finding.itemIds))].sort(compareText),
    }] : []),
    ...(!pairs.length && knownTextureIds.length ? [{
      code: "texture.preference_rule_unavailable",
      description: "Controlled texture attributes are retained as evidence, but RoomAI has no standalone or customer-texture-preference rule.",
      itemIds: [...knownTextureIds].sort(compareText),
    }] : []),
  ];
  return buildAestheticEvaluationReport({
    context,
    items: context.items.map(reportItem),
    relationships,
    findings: [...materialFindings, ...textureFindings],
    coverage: [materialCoverage, textureCoverage],
    diagnostics,
  });
}
