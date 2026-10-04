import type { AestheticDesignContext, AestheticItemContext } from "./aesthetic-context";
import {
  aestheticItemSchema,
  aestheticVisualWeightObservationSchema,
  type AestheticEvaluationReport,
  type AestheticVisualWeightObservation,
} from "./aesthetic-contracts";
import { buildAestheticEvaluationReport } from "./aesthetic-report";

export const VISUAL_WEIGHT_EVALUATOR_ID = "item-visual-weight";
export const VISUAL_WEIGHT_EVALUATOR_VERSION = "1.0";
export const VISUAL_WEIGHT_RULE_ID = "direct-normalized-form-evidence-required";

export const VISUAL_WEIGHT_UNAVAILABLE_ATTRIBUTES = [
  "TRANSPARENCY",
  "BASE_OPENNESS",
  "FRAME_OPENNESS",
  "LEG_EXPOSURE",
  "SILHOUETTE_DENSITY",
  "UPHOLSTERY_COVERAGE",
  "SOLID_OR_OPEN_CONSTRUCTION",
  "VISUAL_MASS_CLASS",
] as const;

function hasNormalizedFurnitureForm(attributes: AestheticItemContext["metadata"]["attributes"]): boolean {
  return Object.entries(attributes).some(([key, value]) => key !== "seatingCapacity" && value !== null);
}

function directNormalizedFormEvidence(item: AestheticItemContext): AestheticVisualWeightObservation["directFormEvidence"] {
  const attributeKeys = [
    "silhouette", "armStyle", "backStyle", "cushionStyle", "upholsteryType", "upholsteryMaterial",
    "fabricTexture", "tufting", "legBaseStyle", "exposedWood", "exposedMetal", "heightProfile",
  ] as const;
  return attributeKeys.flatMap((attribute) => {
    const value = item.metadata.attributes[attribute];
    return value === null ? [] : [{ attribute, value, source: "normalized_attributes" as const }];
  });
}

function visualWeightSupportingEvidence(item: AestheticItemContext): AestheticVisualWeightObservation["supportingEvidence"] {
  const evidence: AestheticVisualWeightObservation["supportingEvidence"] = [];
  for (const [source, measurements] of [["design_object", item.metadata.designMeasurements], ["catalog", item.metadata.catalogMeasurements]] as const) {
    if (!measurements || [measurements.widthCm, measurements.depthCm, measurements.heightCm].every((value) => value === null)) continue;
    evidence.push({
      kind: "DIMENSIONS",
      source,
      widthCm: measurements.widthCm,
      depthCm: measurements.depthCm,
      heightCm: measurements.heightCm,
      decisive: false,
    });
  }
  if (item.metadata.materials.status === "KNOWN") {
    evidence.push({
      kind: "MATERIAL",
      source: item.metadata.materials.source,
      values: item.metadata.materials.values,
      decisive: false,
    });
  }
  if (item.metadata.color.status === "KNOWN") {
    evidence.push({ kind: "COLOR", source: item.metadata.color.source, value: item.metadata.color.value, decisive: false });
  }
  if (hasNormalizedFurnitureForm(item.metadata.attributes)) {
    evidence.push({
      kind: "NORMALIZED_FURNITURE_ATTRIBUTES",
      source: "normalized_attributes",
      values: item.metadata.attributes,
      decisive: false,
    });
  }
  return evidence;
}

/** Produces structured observations only; current RoomAI data has no direct visual-mass descriptor. */
export function evaluateItemVisualWeight(item: AestheticItemContext): AestheticVisualWeightObservation {
  return aestheticVisualWeightObservationSchema.parse({
    itemId: item.itemId,
    itemRole: item.role,
    itemCategory: item.category,
    itemSubtype: item.subtype,
    classification: "UNKNOWN",
    evidenceStatus: "INSUFFICIENT_EVIDENCE",
    evaluator: {
      evaluatorId: VISUAL_WEIGHT_EVALUATOR_ID,
      ruleId: VISUAL_WEIGHT_RULE_ID,
      version: VISUAL_WEIGHT_EVALUATOR_VERSION,
    },
    directFormEvidence: directNormalizedFormEvidence(item),
    supportingEvidence: visualWeightSupportingEvidence(item),
    unavailableEvidence: [...VISUAL_WEIGHT_UNAVAILABLE_ATTRIBUTES],
  });
}

function reportItem(item: AestheticItemContext, visualWeightEvidence: AestheticVisualWeightObservation) {
  const measurements = item.metadata.designMeasurements ?? item.metadata.catalogMeasurements;
  return aestheticItemSchema.parse({
    itemId: item.itemId,
    role: item.role,
    styleCode: item.metadata.style.status === "KNOWN" ? item.metadata.style.value : null,
    color: item.metadata.color.status === "KNOWN" ? item.metadata.color.value : null,
    materials: item.metadata.materials.status === "KNOWN" ? item.metadata.materials.values : null,
    furnitureAttributes: item.metadata.attributes,
    visualWeight: "UNKNOWN",
    visualWeightEvidence,
    measurements: {
      widthCm: measurements?.widthCm ?? null,
      depthCm: measurements?.depthCm ?? null,
      heightCm: measurements?.heightCm ?? null,
    },
  });
}

/** Evaluates item evidence only; no contextual good/bad weight judgment or group-balance rule is applied. */
export function evaluateVisualWeight(context: AestheticDesignContext): AestheticEvaluationReport {
  const observations = context.items.map(evaluateItemVisualWeight).sort((first, second) => first.itemId < second.itemId ? -1 : first.itemId > second.itemId ? 1 : 0);
  const observationByItemId = new Map(observations.map((observation) => [observation.itemId, observation]));
  const coverage = observations.length === 0
    ? { dimension: "visual_weight" as const, status: "NOT_APPLICABLE" as const, itemIds: [], reason: null }
    : { dimension: "visual_weight" as const, status: "INSUFFICIENT_EVIDENCE" as const, itemIds: observations.map((observation) => observation.itemId), reason: "No direct normalized visual-weight attribute is available in the current catalog/design context." };
  const diagnostics = observations.length === 0 ? [] : [{
    code: "visual_weight.direct_form_attributes_unavailable",
    description: "Current RoomAI inputs provide no trusted transparency, frame/base openness, leg exposure, silhouette-density, upholstery-coverage, or visual-mass classification attribute.",
    itemIds: observations.map((observation) => observation.itemId),
  }];
  const items = context.items.map((item) => {
    const observation = observationByItemId.get(item.itemId);
    if (!observation) throw new Error("VISUAL_WEIGHT_OBSERVATION_MISSING");
    return reportItem(item, observation);
  });
  return buildAestheticEvaluationReport({
    context,
    items,
    relationships: [],
    findings: [],
    coverage: [coverage],
    diagnostics,
  });
}