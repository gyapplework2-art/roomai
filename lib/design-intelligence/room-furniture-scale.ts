import { getGeometryBounds, getPolygonAreaCm2 } from "@/lib/geometry/dimensions";
import { validateRoomGeometryStructure } from "@/lib/geometry/validation";
import { compositionSelectionPolicy } from "@/lib/furniture-planning/composition-selector";
import type { RoomGeometry } from "@/lib/geometry/types";
import { evaluateCandidateFootprintScaleProportion } from "./scale-proportion";
import type { AestheticDesignContext, AestheticItemContext } from "./aesthetic-context";
import {
  aestheticFindingSchema,
  aestheticItemSchema,
  type AestheticEvaluationReport,
  type AestheticFinding,
} from "./aesthetic-contracts";
import { buildAestheticEvaluationReport } from "./aesthetic-report";

/** Categorical support comes from the explicit living-room templates and E.10-A group membership; area ratios are evidence only. */
export const ROOM_FURNITURE_SCALE_POLICY = {
  compactPrimaryCategory: "loveseat",
  mediumRoomDefaultCategory: "sofa",
  largeRoomCategories: ["sofa", "sectional", "modular_seating"],
} as const;

export const ROOM_SCALE_V1_ROLES = ["PRIMARY_SEATING"] as const;
export const ROOM_SCALE_V1_PRIMARY_CATEGORIES = ["sofa", "sectional", "loveseat", "modular_seating"] as const;
export const ROOM_SCALE_EVALUATOR_ID = "room-furniture-scale";
export const ROOM_SCALE_EVALUATOR_VERSION = "1.0";
export const ROOM_FURNITURE_SCALE_RULE_IDS = {
  roomClassComposition: "primary_seating_room_class_composition",
  largeCompactSolo: "primary_seating_large_compact_solo",
  groupContext: "primary_seating_group_context",
  noSupportedRule: "primary_seating_no_supported_room_scale_rule",
  dimensions: "primary_seating_dimensions_required",
  geometry: "primary_seating_room_geometry_required",
  spatialContext: "primary_seating_spatial_context_unreliable",
} as const;

export type LivingRoomScaleClass = "SMALL" | "MEDIUM" | "LARGE";

type RoomMetrics = {
  areaCm2: number;
  shortSideCm: number;
  longSideCm: number;
  scale: LivingRoomScaleClass;
};

type ItemDimensions = {
  widthCm: number;
  depthCm: number;
  heightCm: number | null;
};

function roomMetrics(geometry: RoomGeometry): RoomMetrics | null {
  if (!validateRoomGeometryStructure(geometry).valid) return null;
  const areaCm2 = getPolygonAreaCm2(geometry.vertices);
  const bounds = getGeometryBounds(geometry);
  const shortSideCm = Math.min(bounds.widthCm, bounds.lengthCm);
  const longSideCm = Math.max(bounds.widthCm, bounds.lengthCm);
  if (![areaCm2, shortSideCm, longSideCm].every((value) => Number.isFinite(value) && value > 0)) return null;

  const policy = compositionSelectionPolicy;
  const scale: LivingRoomScaleClass = areaCm2 < policy.smallMaximumAreaCm2
    || shortSideCm < policy.smallMaximumShortSideCm
    ? "SMALL"
    : areaCm2 >= policy.largeMinimumAreaCm2
      && shortSideCm >= policy.largeMinimumShortSideCm
      && longSideCm >= policy.largeMinimumLongSideCm
      ? "LARGE"
      : "MEDIUM";
  return { areaCm2, shortSideCm, longSideCm, scale };
}

export function classifyLivingRoomScale(geometry: RoomGeometry): LivingRoomScaleClass | null {
  return roomMetrics(geometry)?.scale ?? null;
}

function explicitDimensions(item: AestheticItemContext): ItemDimensions | null {
  for (const measurements of [item.metadata.designMeasurements, item.metadata.catalogMeasurements]) {
    if (measurements && Number.isFinite(measurements.widthCm) && measurements.widthCm !== null && measurements.widthCm > 0
      && Number.isFinite(measurements.depthCm) && measurements.depthCm !== null && measurements.depthCm > 0) {
      return { widthCm: measurements.widthCm, depthCm: measurements.depthCm, heightCm: measurements.heightCm };
    }
  }
  return null;
}

function seatingGroupContext(context: AestheticDesignContext, item: AestheticItemContext) {
  const group = context.groups.find((candidate) => candidate.primaryAnchorItemId === item.itemId);
  const supportingItemIds = group?.itemIds.filter((itemId) =>
    !context.spatialValidation.violatingItemIds.includes(itemId)
      && context.items.some((member) => member.itemId === itemId && member.semanticRole === "SECONDARY_SEATING")) ?? [];
  return { groupId: supportingItemIds.length ? group?.id ?? null : null, supportingItemIds };
}

function missingFinding(context: AestheticDesignContext, item: AestheticItemContext, code: string, explanation: string, ruleId: string): AestheticFinding {
  return aestheticFindingSchema.parse({
    findingId: `room-scale.${item.itemId}`,
    code,
    target: { kind: "dimension", dimension: "scale_proportion" },
    subjects: [{ kind: "ROOM", id: context.projectId }, { kind: "ITEM", id: item.itemId }],
    itemIds: [item.itemId], compatibility: "unknown", priority: "P3", impact: "NEUTRAL", explanation,
    evaluator: { evaluatorId: ROOM_SCALE_EVALUATOR_ID, ruleId, version: ROOM_SCALE_EVALUATOR_VERSION },
    coverage: { status: "INSUFFICIENT_EVIDENCE", reason: explanation },
    evidenceCompleteness: "missing", supportingEvidence: [],
    missingInformation: [{ code: code.replaceAll(".", "_"), dimension: "scale_proportion", itemIds: [item.itemId], description: explanation }],
    recommendationCategory: null,
  });
}

function evaluatePrimaryItem(
  context: AestheticDesignContext,
  room: RoomMetrics,
  item: AestheticItemContext,
): AestheticFinding {
  const dimensions = explicitDimensions(item);
  if (!dimensions) return missingFinding(context, item, "scale.primary_seating_dimensions_unavailable", "Explicit positive item width and depth are required; no dimensions were inferred.", ROOM_FURNITURE_SCALE_RULE_IDS.dimensions);

  const footprintAreaCm2 = dimensions.widthCm * dimensions.depthCm;
  const itemToRoomAreaRatio = footprintAreaCm2 / room.areaCm2;
  if (!Number.isFinite(footprintAreaCm2) || footprintAreaCm2 <= 0 || !Number.isFinite(itemToRoomAreaRatio)) {
    return missingFinding(context, item, "scale.primary_seating_measurements_out_of_range", "The supplied item dimensions cannot produce a finite room-relative measurement.", ROOM_FURNITURE_SCALE_RULE_IDS.dimensions);
  }
  const group = seatingGroupContext(context, item);
  const roleEnvelope = evaluateCandidateFootprintScaleProportion({ sizeRange: item.sizeRange }, dimensions);
  const roleEnvelopeCompatible = roleEnvelope.compatibility === "compatible";
  const itemHasSpatialViolation = context.spatialValidation.violatingItemIds.includes(item.itemId);
  const category = item.category.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const recognizedCategory = (ROOM_SCALE_V1_PRIMARY_CATEGORIES as readonly string[]).includes(category);
  const hasSupportingSeats = group.supportingItemIds.length > 0;
  let outcome: "APPROPRIATE" | "UNDER_SUPPORTED_BY_COMPOSITION" | "NO_REPOSITORY_BACKED_DEVIATION" | "SPATIAL_CONTEXT_UNRELIABLE";
  let appliedRule: "ROOM_CLASS_COMPOSITION" | "LARGE_COMPACT_SOLO" | "GROUP_CONTEXT" | "NO_SUPPORTED_RULE";
  let ruleId: string;

  if (itemHasSpatialViolation) {
    outcome = "SPATIAL_CONTEXT_UNRELIABLE";
    appliedRule = "NO_SUPPORTED_RULE";
    ruleId = ROOM_FURNITURE_SCALE_RULE_IDS.spatialContext;
  } else {
    const largeCompactSolo = roleEnvelopeCompatible && room.scale === "LARGE" && category === ROOM_FURNITURE_SCALE_POLICY.compactPrimaryCategory && !hasSupportingSeats;
    const supportedSmall = roleEnvelopeCompatible && room.scale === "SMALL" && (category === "sofa" || category === "loveseat") && hasSupportingSeats;
    const supportedMedium = roleEnvelopeCompatible && room.scale === "MEDIUM" && category === ROOM_FURNITURE_SCALE_POLICY.mediumRoomDefaultCategory && hasSupportingSeats;
    const supportedLarge = roleEnvelopeCompatible && room.scale === "LARGE"
      && ((ROOM_FURNITURE_SCALE_POLICY.largeRoomCategories as readonly string[]).includes(category)
        && (category !== "sofa" || hasSupportingSeats)
        || (category === "loveseat" && hasSupportingSeats));
    if (largeCompactSolo) {
      outcome = "UNDER_SUPPORTED_BY_COMPOSITION";
      appliedRule = "LARGE_COMPACT_SOLO";
      ruleId = ROOM_FURNITURE_SCALE_RULE_IDS.largeCompactSolo;
    } else if (roleEnvelopeCompatible && recognizedCategory && hasSupportingSeats && category === "loveseat") {
      outcome = "APPROPRIATE";
      appliedRule = "GROUP_CONTEXT";
      ruleId = ROOM_FURNITURE_SCALE_RULE_IDS.groupContext;
    } else if (supportedSmall || supportedMedium || supportedLarge) {
      outcome = "APPROPRIATE";
      appliedRule = "ROOM_CLASS_COMPOSITION";
      ruleId = ROOM_FURNITURE_SCALE_RULE_IDS.roomClassComposition;
    } else {
      outcome = "NO_REPOSITORY_BACKED_DEVIATION";
      appliedRule = "NO_SUPPORTED_RULE";
      ruleId = ROOM_FURNITURE_SCALE_RULE_IDS.noSupportedRule;
    }
  }

  const insufficient = outcome === "SPATIAL_CONTEXT_UNRELIABLE";
  const underSupported = outcome === "UNDER_SUPPORTED_BY_COMPOSITION";
  const appropriate = outcome === "APPROPRIATE";
  const compatibility = insufficient || !appropriate && !underSupported ? "unknown" : underSupported ? "mixed" : "compatible";
  const impact = insufficient || !appropriate && !underSupported ? "NEUTRAL" : underSupported ? "MODERATE_ISSUE" : "POSITIVE";
  const priority = underSupported ? "P2" : "P3";
  const code = insufficient ? "scale.primary_seating_spatial_context_unreliable"
    : underSupported ? "scale.primary_seating_underscaled_for_room"
      : appropriate ? "scale.primary_seating_scale_appropriate_for_room"
        : "scale.primary_seating_room_scale_not_established";
  const explanation = insufficient
    ? "This primary item has an authoritative E.10-A spatial violation; the room-relative scale judgment is withheld to avoid restating a physical failure."
    : underSupported
      ? "E.10-A defines the loveseat as a smaller primary-seating category than its sofa and sectional alternatives, and its large-room loveseat composition includes secondary seating; no supporting seating item is present in this group."
      : appropriate && appliedRule === "GROUP_CONTEXT"
        ? `The compact primary item is supported by ${group.supportingItemIds.length} secondary seating item(s) in its E.10-A primary seating group.`
        : appropriate
          ? `The ${room.scale.toLowerCase()}-room primary category is represented by RoomAI's living-room composition policy; explicit width and depth are retained as evidence, not compared against an unsupported aesthetic ratio.`
          : !roleEnvelopeCompatible
            ? `The measured width/depth do not match this E.10-A role envelope under the existing candidate-vs-role policy; B.2.1 makes no room-relative aesthetic claim.`
            : `RoomAI has no room-relative scale rule for ${category || "this primary category"} in a ${room.scale.toLowerCase()} room; the measured proportion is reported without an aesthetic pass/fail claim.`;
  const observation = {
    kind: "room_furniture_scale" as const,
    roomId: context.projectId,
    roomAreaCm2: room.areaCm2,
    roomShortSideCm: room.shortSideCm,
    roomLongSideCm: room.longSideCm,
    roomScale: room.scale,
    itemId: item.itemId,
    itemRole: "PRIMARY_SEATING",
    itemCategory: item.category,
    itemSubtype: item.subtype,
    itemWidthCm: dimensions.widthCm,
    itemDepthCm: dimensions.depthCm,
    itemFootprintAreaCm2: footprintAreaCm2,
    itemToRoomAreaRatio,
    roleEnvelopeCompatibility: roleEnvelope.compatibility,
    roleEnvelopeReasons: roleEnvelope.reasons,
    plannedWidthRangeCm: { minimum: item.sizeRange.widthMinCm, maximum: item.sizeRange.widthMaxCm },
    plannedDepthRangeCm: { minimum: item.sizeRange.depthMinCm, maximum: item.sizeRange.depthMaxCm },
    appliedRule,
    groupId: group.groupId,
    supportingItemIds: group.supportingItemIds,
    outcome,
  };

  return aestheticFindingSchema.parse({
    findingId: `room-scale.${item.itemId}`,
    code,
    target: { kind: "dimension", dimension: "scale_proportion" },
    subjects: [{ kind: "ROOM", id: context.projectId }, { kind: "ITEM", id: item.itemId }],
    itemIds: [item.itemId], compatibility, priority, impact, explanation,
    evaluator: { evaluatorId: ROOM_SCALE_EVALUATOR_ID, ruleId, version: ROOM_SCALE_EVALUATOR_VERSION },
    coverage: insufficient ? { status: "INSUFFICIENT_EVIDENCE", reason: explanation } : { status: "EVALUATED" },
    evidenceCompleteness: insufficient ? "partial" : "complete",
    supportingEvidence: [{
      evidenceId: `room-scale-evidence.${item.itemId}`,
      source: "measured_dimensions",
      dimension: "scale_proportion",
      itemIds: [item.itemId],
      description: explanation,
      observation,
    }],
    missingInformation: insufficient ? [{ code: "scale.spatial_context_unreliable", dimension: "scale_proportion", itemIds: [item.itemId], description: explanation }] : [],
    recommendationCategory: null,
  });
}

function toReportItem(item: AestheticItemContext) {
  const dimensions = explicitDimensions(item);
  return aestheticItemSchema.parse({
    itemId: item.itemId,
    role: item.role,
    styleCode: item.metadata.style.status === "KNOWN" ? item.metadata.style.value : null,
    color: item.metadata.color.status === "KNOWN" ? item.metadata.color.value : null,
    materials: item.metadata.materials.status === "KNOWN" ? item.metadata.materials.values : null,
    furnitureAttributes: item.metadata.attributes,
    visualWeight: item.metadata.visualWeight,
    measurements: {
      widthCm: dimensions?.widthCm ?? null,
      depthCm: dimensions?.depthCm ?? null,
      heightCm: dimensions?.heightCm ?? null,
    },
  });
}

/** Evaluates only living-room PRIMARY_SEATING against the authoritative room polygon. */
export function evaluateRoomFurnitureScale(context: AestheticDesignContext): AestheticEvaluationReport {
  const primaryItems = context.items.filter((item) => ROOM_SCALE_V1_ROLES.some((role) => item.semanticRole === role));
  const applicable = context.roomType === "living_room" && primaryItems.length > 0;
  const room = context.roomType === "living_room" ? roomMetrics(context.geometry) : null;
  const findings = context.roomType === "living_room"
    ? primaryItems.map((item) => room
      ? evaluatePrimaryItem(context, room, item)
      : missingFinding(context, item, "scale.primary_seating_room_geometry_unavailable", "A valid authoritative room polygon is required for room-relative scale.", ROOM_FURNITURE_SCALE_RULE_IDS.geometry))
    : [];
  if (context.roomType === "living_room" && !primaryItems.length) {
    return buildAestheticEvaluationReport({
      context, items: context.items.map(toReportItem), relationships: [], findings: [],
      coverage: [{ dimension: "scale_proportion", status: "NOT_APPLICABLE", itemIds: [], reason: null }],
      diagnostics: [{ code: "scale.primary_seating_not_present", description: "No E.10-A PRIMARY_SEATING item is present in this design context.", itemIds: [] }],
    });
  }

  const hasIncomplete = findings.some((finding) => finding.coverage.status !== "EVALUATED");
  const evaluatedItemIds = findings.filter((finding) => finding.coverage.status === "EVALUATED").flatMap((finding) => finding.itemIds).sort();
  const scaleCoverage = !applicable
    ? { dimension: "scale_proportion" as const, status: "NOT_APPLICABLE" as const, itemIds: [], reason: null }
    : hasIncomplete
      ? { dimension: "scale_proportion" as const, status: "INSUFFICIENT_EVIDENCE" as const, itemIds: findings.flatMap((finding) => finding.itemIds).sort(), reason: "One or more primary-seating scale rules lack reliable evidence." }
      : { dimension: "scale_proportion" as const, status: "EVALUATED" as const, itemIds: evaluatedItemIds, reason: null };
  const diagnostics = context.roomType !== "living_room"
    ? [{ code: "scale.room_type_not_supported", description: "Room-relative major-furniture scale rules are currently calibrated only for living rooms.", itemIds: [] }]
    : !room
      ? [{ code: "scale.room_geometry_unavailable", description: "A valid authoritative polygon and reliable room spans are required.", itemIds: primaryItems.map((item) => item.itemId).sort() }]
      : [];
  return buildAestheticEvaluationReport({
    context,
    items: context.items.map(toReportItem),
    relationships: [],
    findings,
    coverage: [scaleCoverage],
    diagnostics,
  });
}