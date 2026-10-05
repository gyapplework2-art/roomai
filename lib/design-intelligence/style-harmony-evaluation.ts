import type { AestheticDesignContext, AestheticItemContext } from "./aesthetic-context";
import {
  aestheticFindingSchema,
  aestheticItemSchema,
  type AestheticEvaluationReport,
  type AestheticFinding,
} from "./aesthetic-contracts";
import { buildAestheticEvaluationReport } from "./aesthetic-report";
import { evaluateCandidateStyleHarmony } from "./style-harmony";

export const STYLE_HARMONY_EVALUATOR_ID = "style-harmony";
export const STYLE_HARMONY_EVALUATOR_VERSION = "1.0";
export const STYLE_PREFERENCE_RULE_ID = "existing_candidate_style_adjacency";

const compareText = (first: string, second: string) => first < second ? -1 : first > second ? 1 : 0;

function stylePreferenceRequested(context: AestheticDesignContext): boolean {
  const preferences = context.preferences;
  if (!preferences) return false;
  return [preferences.primaryStyle, preferences.secondaryStyle]
    .some((preference) => preference.status === "KNOWN" || preference.raw !== null);
}

function stylePreferences(preferences: NonNullable<AestheticDesignContext["preferences"]>) {
  return ([
    ["primary", preferences.primaryStyle],
    ["secondary", preferences.secondaryStyle],
  ] as const).flatMap(([role, preference]) => preference.status === "KNOWN"
    ? [{ role, styleCode: preference.value }]
    : []);
}

function alignment(reasons: readonly string[]) {
  const reason = reasons[0];
  if (reason === "candidate_matches_primary_style") return { value: "MATCHES_PRIMARY" as const, role: "primary" as const };
  if (reason === "candidate_matches_secondary_style") return { value: "MATCHES_SECONDARY" as const, role: "secondary" as const };
  if (reason === "candidate_adjacent_to_primary_style") return { value: "ADJACENT_TO_PRIMARY" as const, role: "primary" as const };
  if (reason === "candidate_adjacent_to_secondary_style") return { value: "ADJACENT_TO_SECONDARY" as const, role: "secondary" as const };
  if (reason === "candidate_style_valid_but_not_aligned") return { value: "VALID_BUT_NOT_ALIGNED" as const, role: null };
  return { value: "UNKNOWN" as const, role: null };
}

function styleFinding(
  context: AestheticDesignContext,
  preferences: NonNullable<AestheticDesignContext["preferences"]>,
  item: AestheticItemContext,
): AestheticFinding {
  const styleCode = item.metadata.style.status === "KNOWN" ? item.metadata.style.value : null;
  const result = item.metadata.style.status === "UNKNOWN" && item.metadata.style.reason === "UNRECOGNIZED_VALUE"
    ? { compatibility: "unknown" as const, reasons: ["candidate_style_unknown"] }
    : evaluateCandidateStyleHarmony(preferences.intent, { normalizedStyle: styleCode });
  const mapped = alignment(result.reasons);
  const insufficient = result.compatibility === "unknown";
  const positive = result.compatibility === "compatible";
  const explanation = positive
    ? mapped.role === "primary"
      ? mapped.value === "MATCHES_PRIMARY"
        ? "The normalized item style matches the explicit primary customer style preference under RoomAI's existing style rules."
        : "The normalized item style is adjacent to the explicit primary customer style preference under RoomAI's existing style rules."
      : mapped.value === "MATCHES_SECONDARY"
        ? "The normalized item style matches the explicit secondary customer style preference under RoomAI's existing style rules."
        : "The normalized item style is adjacent to the explicit secondary customer style preference under RoomAI's existing style rules."
    : insufficient
      ? result.reasons.includes("candidate_style_unknown")
        ? "The supplied item style is not recognized by RoomAI's existing normalized style vocabulary."
        : result.reasons.includes("candidate_style_missing")
          ? "No normalized item style is available for comparison with the supplied customer style preferences."
          : "No supported customer style preference is available for comparison."
      : "This normalized style is valid but not aligned by RoomAI's existing style rules; that result is not a style conflict.";
  const observation = {
    kind: "item_style_harmony" as const,
    itemId: item.itemId,
    styleCode,
    styleSource: item.metadata.style.status === "KNOWN" ? item.metadata.style.source : null,
    stylePreferences: stylePreferences(preferences),
    matchedPreferenceRole: mapped.role,
    alignment: mapped.value,
    compatibility: result.compatibility,
    reasons: result.reasons,
  };
  return aestheticFindingSchema.parse({
    findingId: `style.preference:${item.itemId}`,
    code: positive ? "style.preference.aligned"
      : result.compatibility === "mixed" ? "style.preference.not_aligned" : "style.preference.insufficient_evidence",
    target: { kind: "dimension", dimension: "style_harmony" },
    subjects: [{ kind: "ITEM", id: item.itemId }],
    itemIds: [item.itemId],
    compatibility: result.compatibility,
    priority: "P3",
    impact: positive ? "POSITIVE" : "NEUTRAL",
    explanation,
    evaluator: { evaluatorId: STYLE_HARMONY_EVALUATOR_ID, ruleId: STYLE_PREFERENCE_RULE_ID, version: STYLE_HARMONY_EVALUATOR_VERSION },
    coverage: insufficient ? { status: "INSUFFICIENT_EVIDENCE", reason: explanation } : { status: "EVALUATED" },
    evidenceCompleteness: insufficient ? "partial" : "complete",
    supportingEvidence: [{
      evidenceId: `style-evidence.preference:${item.itemId}`,
      source: "normalized_attributes",
      dimension: "style_harmony",
      itemIds: [item.itemId],
      description: explanation,
      observation,
    }],
    missingInformation: insufficient ? [{
      code: "style.preference.evidence_unavailable",
      dimension: "style_harmony",
      itemIds: [item.itemId],
      description: explanation,
    }] : [],
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

/** Adapts only the existing candidate-to-customer-style rule into B.1; it adds no item-pair style theory. */
export function evaluateStyleHarmony(context: AestheticDesignContext): AestheticEvaluationReport {
  const preferences = context.preferences;
  const findings = preferences && stylePreferenceRequested(context)
    ? context.items.map((item) => styleFinding(context, preferences, item))
    : [];
  const itemIds = [...new Set(findings.flatMap((finding) => finding.itemIds))].sort(compareText);
  const incomplete = findings.some((finding) => finding.coverage.status === "INSUFFICIENT_EVIDENCE");
  const coverage = findings.length === 0
    ? { dimension: "style_harmony" as const, status: "NOT_APPLICABLE" as const, itemIds: [], reason: null }
    : incomplete
      ? { dimension: "style_harmony" as const, status: "INSUFFICIENT_EVIDENCE" as const, itemIds, reason: "One or more items lack supported normalized style evidence or a supported customer style preference." }
      : { dimension: "style_harmony" as const, status: "EVALUATED" as const, itemIds, reason: null };
  return buildAestheticEvaluationReport({
    context,
    items: context.items.map(reportItem),
    relationships: [],
    findings,
    coverage: [coverage],
  });
}
