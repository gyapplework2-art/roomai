import type { AestheticDesignContext } from "./aesthetic-context";
import {
  aestheticItemSchema,
  type AestheticEvaluationReport,
  type AestheticFinding,
  type AestheticRelationship,
} from "./aesthetic-contracts";
import { buildAestheticEvaluationReport } from "./aesthetic-report";
import { evaluateColorHarmony } from "./color-harmony-evaluation";
import { evaluateMaterialTextureHarmony } from "./material-texture-harmony-evaluation";

const compareText = (first: string, second: string) => first < second ? -1 : first > second ? 1 : 0;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([first], [second]) => compareText(first, second));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertSharedContext(context: AestheticDesignContext, colorReport: AestheticEvaluationReport, materialReport: AestheticEvaluationReport): void {
  const itemIds = context.items.map((item) => item.itemId).sort(compareText);
  const colorItemIds = colorReport.items.map((item) => item.itemId).sort(compareText);
  const materialItemIds = materialReport.items.map((item) => item.itemId).sort(compareText);
  if (canonicalJson(itemIds) !== canonicalJson(colorItemIds) || canonicalJson(itemIds) !== canonicalJson(materialItemIds)) {
    throw new Error("PALETTE_MATERIAL_COMPOSITION_ITEM_CONTEXT_MISMATCH");
  }
  const expectedSpatial = {
    status: context.spatialValidation.status,
    valid: context.spatialValidation.valid,
    physicallyValid: context.spatialValidation.physicallyValid,
    functionallyValid: context.spatialValidation.functionallyValid,
    circulationStatus: context.spatialValidation.circulationStatus,
  };
  if (canonicalJson(expectedSpatial) !== canonicalJson(colorReport.spatialStatus)
    || canonicalJson(expectedSpatial) !== canonicalJson(materialReport.spatialStatus)
    || canonicalJson(colorReport.intent) !== canonicalJson(materialReport.intent)) {
    throw new Error("PALETTE_MATERIAL_COMPOSITION_CONTEXT_MISMATCH");
  }
}

function mergeItems(colorReport: AestheticEvaluationReport, materialReport: AestheticEvaluationReport) {
  const colorItems = new Map(colorReport.items.map((item) => [item.itemId, item]));
  const materialItems = new Map(materialReport.items.map((item) => [item.itemId, item]));
  return [...colorItems.keys()].sort(compareText).map((itemId) => {
    const colorItem = colorItems.get(itemId);
    const materialItem = materialItems.get(itemId);
    if (!colorItem || !materialItem) throw new Error("PALETTE_MATERIAL_COMPOSITION_ITEM_MISSING");
    const { visualWeight: colorVisualWeight, ...colorFields } = colorItem;
    const { visualWeight: materialVisualWeight, ...materialFields } = materialItem;
    if (canonicalJson(colorFields) !== canonicalJson(materialFields)) throw new Error("PALETTE_MATERIAL_COMPOSITION_ITEM_CONFLICT");
    return aestheticItemSchema.parse({ ...colorItem, visualWeight: materialVisualWeight ?? colorVisualWeight });
  });
}

function mergeByStableId<T>(records: readonly T[], getId: (record: T) => string, errorCode: string): T[] {
  const byId = new Map<string, T>();
  for (const record of records) {
    const id = getId(record);
    const previous = byId.get(id);
    if (previous && canonicalJson(previous) !== canonicalJson(record)) throw new Error(errorCode);
    if (!previous) byId.set(id, record);
  }
  return [...byId.values()].sort((first, second) => compareText(getId(first), getId(second)));
}

function mergedCoverage(colorReport: AestheticEvaluationReport, materialReport: AestheticEvaluationReport) {
  const materialCoverage = new Map(materialReport.coverage.map((entry) => [entry.dimension, entry]));
  return colorReport.coverage.map((colorEntry) => {
    const materialEntry = materialCoverage.get(colorEntry.dimension);
    if (!materialEntry) throw new Error("PALETTE_MATERIAL_COMPOSITION_COVERAGE_MISSING");
    if (colorEntry.dimension === "color_harmony") return colorEntry;
    if (colorEntry.dimension === "material_harmony" || colorEntry.dimension === "texture_harmony") return materialEntry;
    if (canonicalJson(colorEntry) !== canonicalJson(materialEntry)) throw new Error("PALETTE_MATERIAL_COMPOSITION_COVERAGE_CONFLICT");
    return colorEntry;
  });
}

function mergeDiagnostics(colorReport: AestheticEvaluationReport, materialReport: AestheticEvaluationReport) {
  const diagnostics = [...colorReport.diagnostics, ...materialReport.diagnostics];
  const key = (diagnostic: AestheticEvaluationReport["diagnostics"][number]) => canonicalJson({
    code: diagnostic.code,
    description: diagnostic.description,
    itemIds: [...diagnostic.itemIds].sort(compareText),
  });
  return mergeByStableId(diagnostics, key, "PALETTE_MATERIAL_COMPOSITION_DIAGNOSTIC_CONFLICT");
}

/** Composes authoritative B.3.1/B.3.2 reports without adding a room-level quality judgment. */
export function evaluatePaletteMaterialComposition(context: AestheticDesignContext): AestheticEvaluationReport {
  const colorReport = evaluateColorHarmony(context);
  const materialReport = evaluateMaterialTextureHarmony(context);
  assertSharedContext(context, colorReport, materialReport);

  const findings: AestheticFinding[] = mergeByStableId(
    [...colorReport.findings, ...materialReport.findings],
    (finding) => finding.findingId,
    "PALETTE_MATERIAL_COMPOSITION_FINDING_CONFLICT",
  );
  const relationships: AestheticRelationship[] = mergeByStableId(
    [...colorReport.relationships, ...materialReport.relationships],
    (relationship) => relationship.relationshipId,
    "PALETTE_MATERIAL_COMPOSITION_RELATIONSHIP_CONFLICT",
  );

  return buildAestheticEvaluationReport({
    context,
    items: mergeItems(colorReport, materialReport),
    relationships,
    findings,
    coverage: mergedCoverage(colorReport, materialReport),
    diagnostics: mergeDiagnostics(colorReport, materialReport),
  });
}
