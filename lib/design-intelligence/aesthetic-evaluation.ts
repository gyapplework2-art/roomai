import type { AestheticDesignContext, AestheticItemContext } from "./aesthetic-context";
import {
  aestheticItemSchema,
  type AestheticEvaluationReport,
  type AestheticFinding,
  type AestheticItem,
  type AestheticRelationship,
} from "./aesthetic-contracts";
import { buildAestheticEvaluationReport } from "./aesthetic-report";
import { evaluateFurnitureProportions } from "./furniture-proportion";
import { evaluateFunctionalRelationships } from "./functional-relationship-evaluation";
import { evaluateFurnitureGroupComposition } from "./furniture-group-composition";
import { evaluateLightingIntelligence } from "./lighting-intelligence";
import { evaluatePaletteMaterialComposition } from "./palette-material-composition";
import { evaluateRoomFurnitureScale } from "./room-furniture-scale";
import { evaluateRugZoneIntelligence } from "./rug-zone-intelligence";
import { evaluateStyleHarmony } from "./style-harmony-evaluation";
import { evaluateVisualWeight } from "./visual-weight";

type ReportCoverage = AestheticEvaluationReport["coverage"][number];
type ReportDiagnostic = AestheticEvaluationReport["diagnostics"][number];

const compareText = (first: string, second: string) => first < second ? -1 : first > second ? 1 : 0;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([first], [second]) => compareText(first, second));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function projectItem(item: AestheticItemContext, visualWeightEvidence: AestheticItem["visualWeightEvidence"]): AestheticItem {
  const measurements = item.metadata.designMeasurements ?? item.metadata.catalogMeasurements;
  return aestheticItemSchema.parse({
    itemId: item.itemId,
    role: item.role,
    styleCode: item.metadata.style.status === "KNOWN" ? item.metadata.style.value : null,
    color: item.metadata.color.status === "KNOWN" ? item.metadata.color.value : null,
    colorTemperature: "unknown",
    materials: item.metadata.materials.status === "KNOWN" ? item.metadata.materials.values : null,
    furnitureAttributes: item.metadata.attributes,
    visualWeight: item.metadata.visualWeight,
    measurements: {
      widthCm: measurements?.widthCm ?? null,
      depthCm: measurements?.depthCm ?? null,
      heightCm: measurements?.heightCm ?? null,
    },
    visualWeightEvidence: item.metadata.visualWeight === "UNKNOWN" ? visualWeightEvidence : null,
  });
}

function ownedCoverage(report: AestheticEvaluationReport, dimension: ReportCoverage["dimension"]): ReportCoverage {
  const entries = report.coverage.filter((entry) => entry.dimension === dimension);
  if (entries.length !== 1) throw new Error("AESTHETIC_EVALUATION_OWNED_COVERAGE_MISSING");
  return entries[0];
}

/** @internal Exposed for direct testing of coverage combinations not emitted by current evaluator scopes. */
export function aggregateScaleProportionCoverage(owners: readonly ReportCoverage[]): ReportCoverage {
  const applicable = owners.filter((entry) => entry.status !== "NOT_APPLICABLE");
  const itemIds = [...new Set(applicable.flatMap((entry) => entry.itemIds))].sort(compareText);
  if (!applicable.length) return { dimension: "scale_proportion", status: "NOT_APPLICABLE", itemIds: [], reason: null };
  if (applicable.some((entry) => entry.status === "INSUFFICIENT_EVIDENCE")) {
    return { dimension: "scale_proportion", status: "INSUFFICIENT_EVIDENCE", itemIds, reason: "One or more applicable scale-proportion evaluators lack sufficient evidence." };
  }
  if (applicable.some((entry) => entry.status === "NOT_EVALUATED")) {
    return { dimension: "scale_proportion", status: "NOT_EVALUATED", itemIds, reason: "One or more applicable scale-proportion evaluators have no supported rule for this context." };
  }
  return { dimension: "scale_proportion", status: "EVALUATED", itemIds, reason: null };
}

function mergeById<T>(
  records: readonly T[],
  getId: (record: T) => string,
  conflictCode: string,
): T[] {
  const byId = new Map<string, T>();
  for (const record of records) {
    const id = getId(record);
    const previous = byId.get(id);
    if (previous && canonicalJson(previous) !== canonicalJson(record)) throw new Error(conflictCode);
    if (!previous) byId.set(id, record);
  }
  return [...byId.values()];
}

function mergeDiagnostics(diagnostics: readonly ReportDiagnostic[]): ReportDiagnostic[] {
  const byKey = new Map<string, ReportDiagnostic>();
  for (const diagnostic of diagnostics) {
    const itemIds = [...diagnostic.itemIds].sort(compareText);
    const key = canonicalJson({ code: diagnostic.code, description: diagnostic.description, itemIds });
    if (!byKey.has(key)) byKey.set(key, { ...diagnostic, itemIds });
  }
  return [...byKey.values()];
}

/** Runs the existing deterministic evaluators and assembles their owned evidence into one report. */
export function evaluateAestheticDesign(context: AestheticDesignContext): AestheticEvaluationReport {
  const roomScaleReport = evaluateRoomFurnitureScale(context);
  const proportionReport = evaluateFurnitureProportions(context);
  const paletteMaterialReport = evaluatePaletteMaterialComposition(context);
  const visualWeightReport = evaluateVisualWeight(context);
  const groupReport = evaluateFurnitureGroupComposition(context);
  const rugZoneReport = evaluateRugZoneIntelligence(context);
  const lightingReport = evaluateLightingIntelligence(context);
  const styleReport = evaluateStyleHarmony(context);
  const functionalReport = evaluateFunctionalRelationships(context);

  const visualWeightByItemId = new Map(visualWeightReport.items.map((item) => [item.itemId, item.visualWeightEvidence]));
  const items = context.items.map((item) => {
    const evidence = visualWeightByItemId.get(item.itemId);
    if (item.metadata.visualWeight === "UNKNOWN" && evidence === undefined) {
      throw new Error("AESTHETIC_EVALUATION_VISUAL_WEIGHT_EVIDENCE_MISSING");
    }
    return projectItem(item, evidence ?? null);
  });

  const reports = [roomScaleReport, proportionReport, paletteMaterialReport, visualWeightReport, groupReport,
    rugZoneReport, lightingReport, styleReport, functionalReport];
  const relationships = mergeById(
    reports.flatMap((report) => report.relationships),
    (relationship: AestheticRelationship) => relationship.relationshipId,
    "AESTHETIC_EVALUATION_RELATIONSHIP_CONFLICT",
  );
  const findings = mergeById(
    reports.flatMap((report) => report.findings),
    (finding: AestheticFinding) => finding.findingId,
    "AESTHETIC_EVALUATION_FINDING_CONFLICT",
  );
  const coverage: ReportCoverage[] = [
    aggregateScaleProportionCoverage([
      ownedCoverage(roomScaleReport, "scale_proportion"),
      ownedCoverage(proportionReport, "scale_proportion"),
    ]),
    ownedCoverage(visualWeightReport, "visual_weight"),
    ownedCoverage(paletteMaterialReport, "color_harmony"),
    ownedCoverage(paletteMaterialReport, "material_harmony"),
    ownedCoverage(paletteMaterialReport, "texture_harmony"),
    ownedCoverage(groupReport, "composition"),
    ownedCoverage(rugZoneReport, "rug_zone_coherence"),
    ownedCoverage(lightingReport, "lighting_composition"),
    ownedCoverage(styleReport, "style_harmony"),
    ownedCoverage(functionalReport, "functional_relationship"),
  ];
  const diagnostics = mergeDiagnostics(reports.flatMap((report) => report.diagnostics));

  return buildAestheticEvaluationReport({
    context,
    items,
    relationships,
    findings,
    coverage,
    diagnostics,
  });
}