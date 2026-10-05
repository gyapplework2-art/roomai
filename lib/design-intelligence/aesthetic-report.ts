import type { AestheticDesignContext } from "./aesthetic-context";
import {
  aestheticDimensions,
  aestheticEvaluationReportSchema,
  type AestheticEvaluationReport,
  type AestheticFinding,
  type AestheticItem,
  type AestheticRelationship,
} from "./aesthetic-contracts";

const compareText = (first: string, second: string) => first < second ? -1 : first > second ? 1 : 0;
const impactOrder = { MAJOR_ISSUE: 0, MODERATE_ISSUE: 1, MINOR_ISSUE: 2, POSITIVE: 3, NEUTRAL: 4 } as const;
const priorityOrder = { P2: 0, P3: 1 } as const;
const dimensionOrder = new Map(aestheticDimensions.map((dimension, index) => [dimension, index]));

/** P2 precedes P3; stable semantic fields break ties without using array arrival order. */
export function compareAestheticFindings(first: AestheticFinding, second: AestheticFinding): number {
  return priorityOrder[first.priority] - priorityOrder[second.priority]
    || impactOrder[first.impact] - impactOrder[second.impact]
    || dimensionOrder.get(first.target.dimension)! - dimensionOrder.get(second.target.dimension)!
    || compareText(first.evaluator.ruleId, second.evaluator.ruleId)
    || compareText(first.findingId, second.findingId);
}

export function canonicalizeAestheticFindings(findings: readonly AestheticFinding[]): AestheticFinding[] {
  return [...findings].sort(compareAestheticFindings);
}

type ReportCoverage = AestheticEvaluationReport["coverage"][number];
type ReportDiagnostic = AestheticEvaluationReport["diagnostics"][number];

export type BuildAestheticEvaluationReportInput = {
  context: AestheticDesignContext;
  items: readonly AestheticItem[];
  relationships: readonly AestheticRelationship[];
  findings: readonly AestheticFinding[];
  coverage?: readonly ReportCoverage[];
  diagnostics?: readonly ReportDiagnostic[];
};

/** Canonical report assembly; consumes evaluator output but performs no aesthetic judgment. */
export function buildAestheticEvaluationReport(input: BuildAestheticEvaluationReportInput): AestheticEvaluationReport {
  const suppliedCoverage = input.coverage ?? [];
  const dimensions = new Map(suppliedCoverage.map((entry) => [entry.dimension, entry]));
  if (dimensions.size !== suppliedCoverage.length) throw new Error("AESTHETIC_COVERAGE_DIMENSION_DUPLICATE");
  const coverage = aestheticDimensions.map((dimension) => dimensions.get(dimension) ?? {
    dimension, status: "NOT_EVALUATED" as const, itemIds: [], reason: "No evaluator coverage was supplied for this dimension.",
  });
  const findings = canonicalizeAestheticFindings(input.findings);
  const evaluatedItemIds = [...new Set([
    ...coverage.filter((entry) => entry.status === "EVALUATED").flatMap((entry) => entry.itemIds),
    ...findings.filter((finding) => finding.coverage.status === "EVALUATED").flatMap((finding) => finding.itemIds),
  ])].sort(compareText);
  const diagnostics = [...(input.diagnostics ?? [])].map((entry) => ({ ...entry, itemIds: [...entry.itemIds].sort(compareText) }))
    .sort((first, second) => compareText(first.code, second.code) || compareText(first.itemIds.join("\0"), second.itemIds.join("\0")));
  const evaluated = coverage.some((entry) => entry.status === "EVALUATED") || findings.some((finding) => finding.coverage.status === "EVALUATED");
  const incomplete = coverage.some((entry) => entry.status === "INSUFFICIENT_EVIDENCE" || entry.status === "NOT_EVALUATED")
    || findings.some((finding) => finding.coverage.status === "INSUFFICIENT_EVIDENCE" || finding.coverage.status === "NOT_EVALUATED");
  return aestheticEvaluationReportSchema.parse({
    contractVersion: "1.0",
    intent: input.context.preferences?.intent ?? null,
    spatialStatus: {
      status: input.context.spatialValidation.status,
      valid: input.context.spatialValidation.valid,
      physicallyValid: input.context.spatialValidation.physicallyValid,
      functionallyValid: input.context.spatialValidation.functionallyValid,
      circulationStatus: input.context.spatialValidation.circulationStatus,
    },
    items: [...input.items].sort((first, second) => compareText(first.itemId, second.itemId)),
    relationships: [...input.relationships].sort((first, second) => compareText(first.relationshipId, second.relationshipId)),
    coverage,
    evaluatedItemIds,
    findings,
    status: !evaluated ? "NOT_EVALUATED" : incomplete ? "PARTIALLY_EVALUATED" : "EVALUATED",
    diagnostics,
    strengths: findings.filter((finding) => finding.impact === "POSITIVE").map((finding) => finding.findingId).sort(compareText),
    issues: findings.filter((finding) => ["MINOR_ISSUE", "MODERATE_ISSUE", "MAJOR_ISSUE"].includes(finding.impact)).map((finding) => finding.findingId).sort(compareText),
  });
}
