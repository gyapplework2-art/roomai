import type { AestheticDesignContext, AestheticItemContext } from "./aesthetic-context";
import {
  aestheticFindingSchema,
  aestheticItemSchema,
  type AestheticEvaluationReport,
  type AestheticFinding,
  type AestheticRelationship,
} from "./aesthetic-contracts";
import { evaluateBedNightstandFunctionalRelationship } from "./bed-nightstand-relationship";
import { evaluateDeskOfficeChairFunctionalRelationship } from "./desk-office-chair-relationship";
import { evaluateDiningTableChairFunctionalRelationship } from "./dining-table-chair-relationship";
import { buildAestheticEvaluationReport } from "./aesthetic-report";

export const FUNCTIONAL_RELATIONSHIP_EVALUATOR_ID = "functional-relationship-evidence";
export const FUNCTIONAL_RELATIONSHIP_EVALUATOR_VERSION = "1.0";

type RelationshipType = "dining_table_chair" | "bed_nightstand" | "desk_office_chair";
type RelationshipSource =
  | { kind: "E10A_GROUP"; groupId: string }
  | { kind: "SEMANTIC_RELATIONSHIP"; relationshipType: "GROUPED_WITH" };
type ExplicitAssociation = { first: AestheticItemContext; second: AestheticItemContext; source: RelationshipSource };
type FunctionalPair = {
  relationshipType: RelationshipType;
  relationshipId: string;
  itemIds: [string, string];
  first: AestheticItemContext;
  second: AestheticItemContext;
  sources: RelationshipSource[];
};

const compareText = (first: string, second: string) => first < second ? -1 : first > second ? 1 : 0;
const pairSuffix = (itemIds: readonly [string, string]) => itemIds.map((itemId) => `${itemId.length}:${itemId}`).join(":");

function canonicalIds(first: string, second: string): [string, string] {
  return compareText(first, second) < 0 ? [first, second] : [second, first];
}

function normalizedCategory(item: AestheticItemContext): string {
  return item.category.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function pairType(first: AestheticItemContext, second: AestheticItemContext): RelationshipType | null {
  const categories = [normalizedCategory(first), normalizedCategory(second)];
  if (categories.includes("dining_table") && categories.includes("dining_chair")) return "dining_table_chair";
  if ((categories.includes("bed") || categories.includes("bed_frame")) && categories.includes("nightstand")) return "bed_nightstand";
  if (categories.includes("desk") && categories.includes("office_chair")) return "desk_office_chair";
  return null;
}

function explicitAssociations(context: AestheticDesignContext): ExplicitAssociation[] {
  const byId = new Map(context.items.map((item) => [item.itemId, item]));
  const associations: ExplicitAssociation[] = [];
  for (const group of context.groups) {
    const members = group.itemIds.map((itemId) => byId.get(itemId)).filter((item): item is AestheticItemContext => item !== undefined);
    for (let firstIndex = 0; firstIndex < members.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < members.length; secondIndex += 1) {
        if (!pairType(members[firstIndex], members[secondIndex])) continue;
        associations.push({ first: members[firstIndex], second: members[secondIndex], source: { kind: "E10A_GROUP", groupId: group.id } });
      }
    }
  }
  for (const item of context.items) for (const relationship of item.placement.relationships) {
    if (relationship.type !== "GROUPED_WITH") continue;
    const target = byId.get(relationship.targetItemId);
    if (target && pairType(item, target)) {
      associations.push({ first: item, second: target, source: { kind: "SEMANTIC_RELATIONSHIP", relationshipType: "GROUPED_WITH" } });
    }
  }
  return associations;
}

function discoverPairs(context: AestheticDesignContext): FunctionalPair[] {
  const pairs = new Map<string, FunctionalPair>();
  for (const association of explicitAssociations(context)) {
    const relationshipType = pairType(association.first, association.second);
    if (!relationshipType || association.first.itemId === association.second.itemId) continue;
    const itemIds = canonicalIds(association.first.itemId, association.second.itemId);
    const key = JSON.stringify([relationshipType, ...itemIds]);
    const previous = pairs.get(key);
    if (previous) previous.sources.push(association.source);
    else {
      const members = new Map([[association.first.itemId, association.first], [association.second.itemId, association.second]]);
      const first = members.get(itemIds[0]);
      const second = members.get(itemIds[1]);
      if (!first || !second) throw new Error("FUNCTIONAL_RELATIONSHIP_MEMBER_MISSING");
      pairs.set(key, {
        relationshipType,
        relationshipId: `functional_relationship:${relationshipType}:${pairSuffix(itemIds)}`,
        itemIds, first, second, sources: [association.source],
      });
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

function positiveMeasurement(item: AestheticItemContext, key: "heightCm"): { value: number | null; source: "catalog" | "design_object" | null } {
  for (const [source, measurements] of [["design_object", item.metadata.designMeasurements], ["catalog", item.metadata.catalogMeasurements]] as const) {
    const value = measurements?.[key];
    if (value !== null && value !== undefined && Number.isFinite(value) && value > 0) return { value, source };
  }
  return { value: null, source: null };
}

function evaluatePair(pair: FunctionalPair) {
  if (pair.relationshipType === "dining_table_chair") {
    const table = [pair.first, pair.second].find((item) => normalizedCategory(item) === "dining_table");
    if (!table) throw new Error("FUNCTIONAL_DINING_TABLE_MEMBER_MISSING");
    const result = evaluateDiningTableChairFunctionalRelationship({ seatingCapacity: table.metadata.attributes.seatingCapacity });
    return { sourceEvaluatorId: "dining-table-chair-relationship" as const, compatibility: result.compatibility, reasons: result.reasons };
  }
  if (pair.relationshipType === "bed_nightstand") {
    const nightstand = [pair.first, pair.second].find((item) => normalizedCategory(item) === "nightstand");
    if (!nightstand) throw new Error("FUNCTIONAL_NIGHTSTAND_MEMBER_MISSING");
    const height = positiveMeasurement(nightstand, "heightCm");
    const result = evaluateBedNightstandFunctionalRelationship(height.value);
    return { sourceEvaluatorId: "bed-nightstand-relationship" as const, compatibility: result.compatibility, reasons: result.reasons, nightstandHeight: height };
  }
  const result = evaluateDeskOfficeChairFunctionalRelationship();
  return { sourceEvaluatorId: "desk-office-chair-relationship" as const, compatibility: result.compatibility, reasons: result.reasons };
}

function pairFinding(pair: FunctionalPair): AestheticFinding {
  const result = evaluatePair(pair);
  if (result.compatibility !== "unknown") throw new Error("FUNCTIONAL_SOURCE_RESULT_SEMANTICS_CHANGED");
  const pairItems = [pair.first, pair.second].map((item) => {
    const height = pair.relationshipType === "bed_nightstand" && normalizedCategory(item) === "nightstand"
      ? ("nightstandHeight" in result && result.nightstandHeight ? result.nightstandHeight : positiveMeasurement(item, "heightCm"))
      : { value: null, source: null };
    return {
      itemId: item.itemId,
      semanticRole: item.semanticRole,
      category: normalizedCategory(item),
      subtype: item.subtype,
      heightCm: height.value,
      heightSource: height.source,
      seatingCapacity: pair.relationshipType === "dining_table_chair" && normalizedCategory(item) === "dining_table"
        ? item.metadata.attributes.seatingCapacity : null,
    };
  });
  const explanation = `The existing ${pair.relationshipType} evaluator reports functional relationship evidence as unknown; B.8 preserves its reasons without claiming fit or inferring missing requirements.`;
  return aestheticFindingSchema.parse({
    findingId: `functional.relationship:${pairSuffix(pair.itemIds)}`,
    code: `functional_relationship.${pair.relationshipType}.not_evaluated`,
    target: { kind: "relationship", relationshipId: pair.relationshipId, relationshipType: pair.relationshipType, dimension: "functional_relationship" },
    subjects: pair.itemIds.map((id) => ({ kind: "ITEM" as const, id })),
    itemIds: pair.itemIds,
    compatibility: "unknown",
    priority: "P3",
    impact: "NEUTRAL",
    explanation,
    evaluator: { evaluatorId: FUNCTIONAL_RELATIONSHIP_EVALUATOR_ID, ruleId: `existing_${pair.relationshipType}_functional_evidence`, version: FUNCTIONAL_RELATIONSHIP_EVALUATOR_VERSION },
    coverage: { status: "NOT_EVALUATED", reason: explanation },
    evidenceCompleteness: "partial",
    supportingEvidence: [{
      evidenceId: `functional-relationship-evidence:${pairSuffix(pair.itemIds)}`,
      source: "e10a_plan",
      dimension: "functional_relationship",
      itemIds: pair.itemIds,
      description: explanation,
      observation: {
        kind: "functional_relationship_observation",
        relationshipType: pair.relationshipType,
        pairItems,
        relationshipSources: pair.sources,
        sourceEvaluatorId: result.sourceEvaluatorId,
        compatibility: result.compatibility,
        reasons: result.reasons,
      },
    }],
    missingInformation: [{
      code: "functional_relationship.required_evidence_unavailable",
      dimension: "functional_relationship",
      itemIds: pair.itemIds,
      description: "The functional evidence required to determine relationship fit is unavailable in the existing source evaluator inputs.",
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
    measurements: { widthCm: measurements?.widthCm ?? null, depthCm: measurements?.depthCm ?? null, heightCm: measurements?.heightCm ?? null },
  });
}

/** Integrates only the existing functional-relationship evidence outputs; their current unknown status stays unevaluated. */
export function evaluateFunctionalRelationships(context: AestheticDesignContext): AestheticEvaluationReport {
  const pairs = discoverPairs(context);
  const findings = pairs.map(pairFinding);
  const relationships: AestheticRelationship[] = pairs.map((pair) => ({
    relationshipId: pair.relationshipId, type: pair.relationshipType, itemIds: pair.itemIds,
  }));
  const itemIds = [...new Set(pairs.flatMap((pair) => pair.itemIds))].sort(compareText);
  const coverage = pairs.length === 0
    ? { dimension: "functional_relationship" as const, status: "NOT_APPLICABLE" as const, itemIds: [], reason: null }
    : { dimension: "functional_relationship" as const, status: "NOT_EVALUATED" as const, itemIds, reason: "Existing functional relationship modules report unavailable required function evidence; no functional compatibility rule can currently conclude fit." };
  const diagnostics = pairs.length === 0 ? [] : [{
    code: "functional_relationship.performance_evidence_unavailable",
    description: "Explicit supported relationship pairs are recorded, but current dining, bedside, and desk-chair functional modules return unknown for their functional dimension.",
    itemIds,
  }];
  return buildAestheticEvaluationReport({
    context,
    items: context.items.map(reportItem),
    relationships,
    findings,
    coverage: [coverage],
    diagnostics,
  });
}
