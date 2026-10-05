import { z } from "zod";

import { DESIGN_COLOR_FAMILIES, normalizeDesignColor } from "./color-harmony";
import { DESIGN_MATERIAL_FAMILIES, normalizeDesignMaterial } from "./material-harmony";
import { DESIGN_STYLE_CODES } from "./style-harmony";
import { normalizeFurnitureAttributes, type FurnitureDesignAttributes } from "./furniture-attributes";
import { evaluateFurnitureAttributeCompatibility } from "./furniture-attribute-compatibility";
import { designCompatibilitySchema, designIntentSchema, designRoleSchema } from "./schema";
import { furnitureRoleSchema } from "@/lib/furniture-planning/semantic-schema";

const identifier = z.string().trim().min(1).max(160);
const relationshipIdentifier = z.string().trim().min(1).max(400);
const findingIdentifier = z.string().trim().min(1).max(400);
const evidenceIdentifier = z.string().trim().min(1).max(400);
const explanation = z.string().trim().min(1).max(2000);
const stableCode = z.string().regex(/^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/).max(160);
const distinctItemIds = z.array(identifier).refine((ids) => new Set(ids).size === ids.length, "Item references must be distinct.");
const unknownAttributes = normalizeFurnitureAttributes({ seatingCapacity: null });

type TextAttribute = "silhouette" | "armStyle" | "backStyle" | "cushionStyle" | "upholsteryType" | "upholsteryMaterial" | "fabricTexture" | "legBaseStyle" | "heightProfile";

function existingAttributeValue(attribute: TextAttribute) {
  return z.string().trim().min(1).max(160).refine((value) => {
    const attributes = { ...unknownAttributes, [attribute]: value };
    return evaluateFurnitureAttributeCompatibility(attributes, attributes).attributes[attribute].compatibility !== "unknown";
  }, "Use an existing normalized furniture-attribute value.").nullable().default(null);
}

/** Reuses the existing normalized attribute contract and its controlled-value validation. Null means unknown. */
export const aestheticFurnitureAttributesSchema = z.object({
  seatingCapacity: z.number().int().positive().nullable().default(null),
  silhouette: existingAttributeValue("silhouette"),
  armStyle: existingAttributeValue("armStyle"),
  backStyle: existingAttributeValue("backStyle"),
  cushionStyle: existingAttributeValue("cushionStyle"),
  upholsteryType: z.enum(["fabric", "leather"]).nullable().default(null),
  upholsteryMaterial: existingAttributeValue("upholsteryMaterial"),
  fabricTexture: existingAttributeValue("fabricTexture"),
  tufting: z.boolean().nullable().default(null),
  legBaseStyle: existingAttributeValue("legBaseStyle"),
  exposedWood: z.boolean().nullable().default(null),
  exposedMetal: z.boolean().nullable().default(null),
  heightProfile: existingAttributeValue("heightProfile"),
  seatDepthCm: z.number().finite().positive().nullable().default(null),
}).strict() satisfies z.ZodType<FurnitureDesignAttributes>;

export const aestheticStyleCodeSchema = z.enum(DESIGN_STYLE_CODES);
export const aestheticColorFamilySchema = z.enum(DESIGN_COLOR_FAMILIES);
export const aestheticMaterialFamilySchema = z.enum(DESIGN_MATERIAL_FAMILIES);
export const aestheticColorSchema = z.object({ value: identifier, family: aestheticColorFamilySchema }).strict().refine((color) =>
  normalizeDesignColor(color.value)?.family === color.family, "Color value and family must agree with existing normalization.");
export const aestheticMaterialSchema = z.object({ value: identifier, family: aestheticMaterialFamilySchema }).strict().refine((material) =>
  normalizeDesignMaterial(material.value)?.family === material.family, "Material value and family must agree with existing normalization.");

export const colorTemperatureSchema = z.enum(["warm", "cool", "neutral", "unknown"]);
export const visualWeightSchema = z.enum(["VERY_LIGHT", "LIGHT", "MEDIUM", "HEAVY", "VERY_HEAVY", "UNKNOWN"]);
export const visualWeightClassificationSchema = z.enum(["LIGHT", "MEDIUM", "HEAVY", "UNKNOWN"]);
export const variationIntentSchema = z.enum(["coordinated", "intentional_variation", "unknown"]);
export const aestheticHarmonyRelationshipSchema = z.enum([
  "IDENTICAL", "SIMILAR", "COORDINATED", "COMPLEMENTARY", "INTENTIONAL_CONTRAST", "NEUTRAL", "CONFLICTING", "UNKNOWN",
]);
export const aestheticAttributeCategorySchema = z.enum([
  "COLOR", "MATERIAL", "TEXTURE", "STYLE", "SCALE", "PROPORTION", "VISUAL_WEIGHT", "SHAPE", "HEIGHT", "PATTERN", "FINISH",
]);
export const aestheticRoleSchema = z.enum(["DOMINANT", "PRIMARY", "SUPPORTING", "ACCENT", "BACKGROUND", "ANCHOR", "CONNECTOR", "UNKNOWN"]);
export const aestheticImpactSchema = z.enum(["POSITIVE", "NEUTRAL", "MINOR_ISSUE", "MODERATE_ISSUE", "MAJOR_ISSUE"]);
export const aestheticRecommendationCategorySchema = z.enum(["KEEP", "REPOSITION", "RESCALE", "REPLACE_ITEM", "CHANGE_COLOR", "CHANGE_MATERIAL", "CHANGE_LIGHTING", "CHANGE_DECOR", "REVIEW"]);
/** Stable future evaluator dimensions; existing style_harmony and composition concepts retain their identifiers. */
export const aestheticDimensions = [
  "scale_proportion", "visual_weight", "color_harmony", "material_harmony", "texture_harmony", "style_harmony", "functional_relationship",
  "composition", "visual_balance", "rhythm_repetition", "contrast", "rug_zone_coherence", "lighting_composition",
  "vertical_composition", "room_specific_coherence",
] as const;
export const aestheticSubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("DESIGN"), id: identifier }).strict(),
  z.object({ kind: z.literal("ROOM"), id: identifier }).strict(),
  z.object({ kind: z.literal("ITEM"), id: identifier }).strict(),
  z.object({ kind: z.literal("GROUP"), id: identifier }).strict(),
  z.object({ kind: z.literal("ZONE"), id: identifier }).strict(),
  z.object({ kind: z.literal("WALL"), id: identifier }).strict(),
  z.object({ kind: z.literal("OPENING"), id: identifier }).strict(),
]);

/** Harmony is not exact sameness; this declares intent, not evaluation thresholds or pass/fail rules. */
export const aestheticIntentSchema = designIntentSchema.pick({
  roomType: true, primaryStyle: true, secondaryStyle: true, colorMood: true, colors: true,
  preferredMaterials: true, avoidMaterials: true,
}).extend({
  primaryStyle: aestheticStyleCodeSchema.nullable(),
  secondaryStyle: aestheticStyleCodeSchema.nullable(),
  colorTemperature: colorTemperatureSchema.default("unknown"),
  heightVariation: variationIntentSchema.default("unknown"),
  formVariation: variationIntentSchema.default("unknown"),
}).strict();

const visualWeightSupportingEvidenceSchema = z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("DIMENSIONS"), source: z.enum(["catalog", "design_object"]),
      widthCm: z.number().finite().positive().nullable(), depthCm: z.number().finite().positive().nullable(),
      heightCm: z.number().finite().positive().nullable(), decisive: z.literal(false),
    }).strict().refine((evidence) => evidence.widthCm !== null || evidence.depthCm !== null || evidence.heightCm !== null),
    z.object({ kind: z.literal("MATERIAL"), source: z.enum(["catalog", "design_object", "normalized_attributes"]), values: z.array(aestheticMaterialSchema).min(1), decisive: z.literal(false) }).strict(),
    z.object({ kind: z.literal("COLOR"), source: z.enum(["catalog", "design_object", "normalized_attributes"]), value: aestheticColorSchema, decisive: z.literal(false) }).strict(),
    z.object({ kind: z.literal("NORMALIZED_FURNITURE_ATTRIBUTES"), source: z.literal("normalized_attributes"), values: aestheticFurnitureAttributesSchema, decisive: z.literal(false) })
      .strict().refine((evidence) => Object.entries(evidence.values).some(([key, value]) => key !== "seatingCapacity" && value !== null)),
  ]);

export const aestheticVisualWeightObservationSchema = z.object({
    itemId: identifier,
    itemRole: designRoleSchema.nullable(),
    itemCategory: identifier,
    itemSubtype: identifier.nullable(),
    classification: z.literal("UNKNOWN"),
    evidenceStatus: z.literal("INSUFFICIENT_EVIDENCE"),
    evaluator: z.object({ evaluatorId: identifier, ruleId: identifier, version: identifier }).strict(),
    directFormEvidence: z.array(z.object({
      attribute: z.enum([
        "silhouette", "armStyle", "backStyle", "cushionStyle", "upholsteryType", "upholsteryMaterial",
        "fabricTexture", "tufting", "legBaseStyle", "exposedWood", "exposedMetal", "heightProfile",
      ]),
      value: z.union([identifier, z.boolean()]),
      source: z.literal("normalized_attributes"),
    }).strict()),
    supportingEvidence: z.array(visualWeightSupportingEvidenceSchema),
    unavailableEvidence: z.array(z.enum([
      "TRANSPARENCY", "BASE_OPENNESS", "FRAME_OPENNESS", "LEG_EXPOSURE", "SILHOUETTE_DENSITY",
      "UPHOLSTERY_COVERAGE", "SOLID_OR_OPEN_CONSTRUCTION", "VISUAL_MASS_CLASS", "VISUAL_WEIGHT_CLASS",
    ])),
  }).strict();
/** Appearance must be supplied explicitly; no vendor/name/title/price-derived inference. */
export const aestheticItemSchema = z.object({
  itemId: identifier,
  role: designRoleSchema.nullable().default(null),
  styleCode: aestheticStyleCodeSchema.nullable().default(null),
  color: aestheticColorSchema.nullable().default(null),
  colorTemperature: colorTemperatureSchema.default("unknown"),
  materials: z.array(aestheticMaterialSchema).nullable().default(null),
  furnitureAttributes: aestheticFurnitureAttributesSchema.default(unknownAttributes),
  visualWeight: visualWeightSchema.default("UNKNOWN"),
  measurements: z.object({
    widthCm: z.number().finite().positive().nullable().default(null),
    depthCm: z.number().finite().positive().nullable().default(null),
    heightCm: z.number().finite().positive().nullable().default(null),
  }).strict().default({ widthCm: null, depthCm: null, heightCm: null }),
  visualWeightEvidence: aestheticVisualWeightObservationSchema.nullable().default(null),
}).strict().superRefine((item, context) => {
  if (item.visualWeightEvidence && (item.visualWeightEvidence.itemId !== item.itemId
    || item.visualWeight !== item.visualWeightEvidence.classification)) {
    context.addIssue({ code: "custom", path: ["visualWeightEvidence"], message: "Visual-weight observation must match the item identity and classification." });
  }
});

/** Existing pair concepts keep their identifiers; future coordination is distinct from spatial relationships. */
export const aestheticRelationshipTypeSchema = z.enum([
  "sofa_rug", "dining_table_chair", "bed_nightstand", "desk_office_chair",
  "furniture_coordination", "rug_furniture_harmony", "rug_zoning", "curtain_furniture_coordination",
  "wall_art_composition", "dining_table_lighting_art_coordination",
  "bedroom_bedding_curtain_art_plant_coordination", "intentional_height_variation", "intentional_form_variation",
]);

/** Declaring any of these relationships does not declare its evaluator implemented. */
export const aestheticRelationshipSchema = z.object({
  relationshipId: relationshipIdentifier,
  type: aestheticRelationshipTypeSchema,
  itemIds: distinctItemIds.refine((ids) => ids.length >= 2, "An aesthetic relationship requires at least two items."),
}).strict();

export const aestheticDimensionSchema = z.enum(aestheticDimensions);
export const aestheticPrioritySchema = z.enum(["P2", "P3"]);
export const aestheticCoverageStatusSchema = z.enum(["EVALUATED", "INSUFFICIENT_EVIDENCE", "NOT_APPLICABLE", "NOT_EVALUATED"]);
export const aestheticReportStatusSchema = z.enum(["EVALUATED", "PARTIALLY_EVALUATED", "NOT_EVALUATED"]);

const evidenceValueSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
export const aestheticEvidenceObservationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("design_intent"), preference: z.enum(["STYLE", "COLOR", "MATERIAL", "TEXTURE", "HEIGHT_VARIATION", "FORM_VARIATION"]), values: z.array(evidenceValueSchema).min(1) }).strict(),
  z.object({
    kind: z.literal("furniture_group_composition"),
    groupId: identifier,
    groupType: identifier,
    primaryAnchorItemId: identifier.nullable(),
    secondaryAnchorItemIds: z.array(identifier),
    dependentItemIds: z.array(identifier),
    members: z.array(z.object({
      itemId: identifier,
      semanticRole: furnitureRoleSchema.nullable(),
      category: identifier,
      subtype: identifier.nullable(),
      groupRoles: z.array(z.enum(["PRIMARY_ANCHOR", "SECONDARY_ANCHOR", "DEPENDENT"])),
      relationships: z.array(z.object({ type: identifier, targetItemId: identifier }).strict()),
    }).strict()),
    structuralStatus: z.enum(["EXPLICIT_HIERARCHY", "PARTIAL_HIERARCHY"]),
    templateConformance: z.literal("NOT_EVALUATED"),
    visualQuality: z.literal("NOT_EVALUATED"),
    unavailableAssessments: z.array(z.enum(["TEMPLATE_CONFORMANCE", "VISUAL_BALANCE", "SYMMETRY", "DOMINANCE", "COMPOSITION_QUALITY"])),
  }).strict().superRefine((observation, context) => {
    const memberIds = observation.members.map((member) => member.itemId);
    if (new Set(memberIds).size !== memberIds.length || memberIds.some((id, index) => index > 0 && memberIds[index - 1] > id)) {
      context.addIssue({ code: "custom", path: ["members"], message: "Group members must be unique and canonically ordered." });
    }
    const memberIdSet = new Set(memberIds);
    for (const [index, member] of observation.members.entries()) {
      if (member.groupRoles.some((role, roleIndex) => roleIndex > 0 && member.groupRoles[roleIndex - 1] > role)) {
        context.addIssue({ code: "custom", path: ["members", index, "groupRoles"], message: "Member hierarchy roles must use canonical ordering." });
      }
      if (member.relationships.some((relationship, relationshipIndex) => relationshipIndex > 0
        && `${member.relationships[relationshipIndex - 1].type}:${member.relationships[relationshipIndex - 1].targetItemId}` > `${relationship.type}:${relationship.targetItemId}`)) {
        context.addIssue({ code: "custom", path: ["members", index, "relationships"], message: "Member relationships must use canonical ordering." });
      }
    }
    const hierarchyReferences = [observation.primaryAnchorItemId, ...observation.secondaryAnchorItemIds, ...observation.dependentItemIds]
      .filter((id): id is string => id !== null);
    const complete = observation.primaryAnchorItemId !== null && memberIdSet.has(observation.primaryAnchorItemId)
      && new Set(observation.secondaryAnchorItemIds).size === observation.secondaryAnchorItemIds.length
      && new Set(observation.dependentItemIds).size === observation.dependentItemIds.length
      && hierarchyReferences.every((id) => memberIdSet.has(id))
      && observation.members.every((member) => member.groupRoles.length === 1);
    if ((observation.structuralStatus === "EXPLICIT_HIERARCHY") !== complete) context.addIssue({ code: "custom", path: ["structuralStatus"], message: "Structural status must reflect explicit E.10-A hierarchy coverage." });
  }),
  z.object({
    kind: z.literal("rug_zone_structure"),
    rugItemId: identifier,
    groupId: identifier,
    groupType: identifier,
    rugGroupRoles: z.array(z.enum(["PRIMARY_ANCHOR", "SECONDARY_ANCHOR", "DEPENDENT"])),
    groupZoneId: identifier.nullable(),
    rugZoneId: identifier.nullable(),
    groupZone: z.object({
      zoneId: identifier,
      type: identifier,
      polygon: z.array(z.object({ id: identifier, xCm: z.number().finite(), yCm: z.number().finite() }).strict()).min(3),
      center: z.object({ xCm: z.number().finite(), yCm: z.number().finite() }).strict(),
      orientationDegrees: z.number().finite().nullable(),
      polygonRelationToRoom: z.enum(["SAME_POLYGON", "DIFFERENT_POLYGON"]),
    }).strict().nullable(),
    rugZone: z.object({
      zoneId: identifier,
      type: identifier,
      polygon: z.array(z.object({ id: identifier, xCm: z.number().finite(), yCm: z.number().finite() }).strict()).min(3),
      center: z.object({ xCm: z.number().finite(), yCm: z.number().finite() }).strict(),
      orientationDegrees: z.number().finite().nullable(),
      polygonRelationToRoom: z.enum(["SAME_POLYGON", "DIFFERENT_POLYGON"]),
    }).strict().nullable(),
    zoneReferenceStatus: z.enum([
      "MATCHED_ZONE", "DIFFERENT_ZONES", "GROUP_ZONE_MISSING", "RUG_ZONE_MISSING", "GROUP_ZONE_UNRESOLVED", "RUG_ZONE_UNRESOLVED",
    ]),
    placement: z.object({
      mode: identifier.nullable(),
      approximatePosition: z.object({ xCm: z.number().finite(), yCm: z.number().finite() }).nullable(),
      preferredOrientationDegrees: z.number().finite().nullable(),
    }).strict(),
    dimensions: z.object({
      planningRangeCm: z.object({
        widthMin: z.number().finite().positive(), widthMax: z.number().finite().positive(),
        depthMin: z.number().finite().positive(), depthMax: z.number().finite().positive(),
      }).strict(),
      catalogMeasurementsCm: z.object({ width: z.number().finite().positive().nullable(), depth: z.number().finite().positive().nullable() }).strict().nullable(),
      designMeasurementsCm: z.object({ width: z.number().finite().positive().nullable(), depth: z.number().finite().positive().nullable() }).strict().nullable(),
    }).strict(),
    assessmentStatus: z.enum(["STRUCTURE_RECORDED", "INSUFFICIENT_EVIDENCE"]),
    unavailableAssessments: z.array(z.enum([
      "TRUE_ZONE_DEFINITION", "ZONE_QUALITY", "LIGHTNESS_RELATIONSHIP", "VISUAL_DOMINANCE",
      "LEG_PLACEMENT", "PATTERN_INTENSITY", "RUG_FURNITURE_INTERSECTION_QUALITY", "FOOTPRINT_COVERAGE_JUDGMENT",
    ])),
  }).strict().superRefine((observation, context) => {
    const { groupZone, rugZone, zoneReferenceStatus } = observation;
    const expectedZoneStatus = observation.groupZoneId === null ? "GROUP_ZONE_MISSING"
      : observation.rugZoneId === null ? "RUG_ZONE_MISSING"
        : !groupZone ? "GROUP_ZONE_UNRESOLVED"
          : !rugZone ? "RUG_ZONE_UNRESOLVED"
            : observation.groupZoneId !== observation.rugZoneId ? "DIFFERENT_ZONES" : "MATCHED_ZONE";
    if (zoneReferenceStatus !== expectedZoneStatus) context.addIssue({ code: "custom", path: ["zoneReferenceStatus"], message: "Zone association status must reflect E.10-A group/rug zone references." });
    if ((groupZone !== null && observation.groupZoneId === null)
      || (rugZone !== null && observation.rugZoneId === null)
      || (groupZone && groupZone.zoneId !== observation.groupZoneId)
      || (rugZone && rugZone.zoneId !== observation.rugZoneId)) {
      context.addIssue({ code: "custom", path: ["groupZone"], message: "Resolved zone evidence must match its authoritative zone ID." });
    }
    const expectedAssessment = groupZone && rugZone ? "STRUCTURE_RECORDED" : "INSUFFICIENT_EVIDENCE";
    if (observation.assessmentStatus !== expectedAssessment) context.addIssue({ code: "custom", path: ["assessmentStatus"], message: "Missing group or rug zone evidence must remain insufficient." });
    if (observation.dimensions.planningRangeCm.widthMax < observation.dimensions.planningRangeCm.widthMin
      || observation.dimensions.planningRangeCm.depthMax < observation.dimensions.planningRangeCm.depthMin) {
      context.addIssue({ code: "custom", path: ["dimensions", "planningRangeCm"], message: "Planning dimension ranges must be ordered." });
    }
    if (observation.rugGroupRoles.some((role, index) => index > 0 && observation.rugGroupRoles[index - 1] > role)) {
      context.addIssue({ code: "custom", path: ["rugGroupRoles"], message: "Rug group roles must be canonically ordered." });
    }
    if (new Set(observation.unavailableAssessments).size !== observation.unavailableAssessments.length) {
      context.addIssue({ code: "custom", path: ["unavailableAssessments"], message: "Unavailable assessments must be unique." });
    }
  }),
  z.object({
    kind: z.literal("lighting_composition_structure"),
    lightingItemId: identifier,
    semanticRole: z.enum(["TASK_LIGHTING", "AMBIENT_LIGHTING"]),
    planCategory: identifier,
    planSubtype: identifier.nullable(),
    groupMemberships: z.array(z.object({
      groupId: identifier,
      groupType: identifier,
      groupZoneId: identifier.nullable(),
      hierarchyRoles: z.array(z.enum(["PRIMARY_ANCHOR", "SECONDARY_ANCHOR", "DEPENDENT"])),
    }).strict()),
    zoneId: identifier.nullable(),
    zoneResolutionStatus: z.enum(["NO_ZONE_REFERENCE", "RESOLVED", "UNRESOLVED", "AMBIGUOUS"]),
    zone: z.object({
      zoneId: identifier,
      type: identifier,
      polygon: z.array(z.object({ id: identifier, xCm: z.number().finite(), yCm: z.number().finite() }).strict()).min(3),
      center: z.object({ xCm: z.number().finite(), yCm: z.number().finite() }).strict(),
      orientationDegrees: z.number().finite().nullable(),
    }).strict().nullable(),
    placement: z.object({
      mode: identifier.nullable(),
      approximatePosition: z.object({ xCm: z.number().finite(), yCm: z.number().finite() }).nullable(),
      preferredOrientationDegrees: z.number().finite().nullable(),
    }).strict(),
    explicitRelationships: z.array(z.object({
      direction: z.enum(["OUTGOING", "INCOMING"]),
      sourceItemId: identifier,
      relationshipType: identifier,
      targetItemId: identifier,
    }).strict()),
    assessmentStatus: z.literal("EVIDENCE_RECORDED"),
    unavailableAssessments: z.array(z.enum([
      "FIXTURE_TYPE_CLASSIFICATION", "FIXTURE_MOUNTING_TYPE", "PHOTOMETRIC_ADEQUACY", "BRIGHTNESS_LEVEL",
      "COLOR_TEMPERATURE", "CRI_QUALITY", "DIMMABILITY", "LIGHT_DIRECTION", "BEAM_COVERAGE", "SHADE_DIFFUSION",
      "VERTICAL_RELATIONSHIP", "TASK_PERFORMANCE", "AMBIENT_COVERAGE", "ACCENT_LIGHTING_CLASSIFICATION", "FIXTURE_SCALE_RELATIONSHIP",
    ])),
  }).strict().superRefine((observation, context) => {
    const expectedZoneStatus = observation.zoneId === null ? "NO_ZONE_REFERENCE"
      : observation.zone !== null ? "RESOLVED"
        : observation.zoneResolutionStatus === "AMBIGUOUS" ? "AMBIGUOUS" : "UNRESOLVED";
    if (observation.zoneResolutionStatus !== expectedZoneStatus
      || (observation.zone !== null && observation.zone.zoneId !== observation.zoneId)) {
      context.addIssue({ code: "custom", path: ["zoneResolutionStatus"], message: "Zone resolution must match the explicit item zone reference." });
    }
    if (observation.groupMemberships.some((membership, index) => index > 0 && observation.groupMemberships[index - 1].groupId >= membership.groupId)) {
      context.addIssue({ code: "custom", path: ["groupMemberships"], message: "Lighting group memberships must be unique and ordered by group ID." });
    }
    if (observation.groupMemberships.some((membership) => membership.hierarchyRoles.some((role, index) => index > 0 && membership.hierarchyRoles[index - 1] > role))) {
      context.addIssue({ code: "custom", path: ["groupMemberships"], message: "Group hierarchy roles must be canonically ordered." });
    }
    const relationKey = (relationship: typeof observation.explicitRelationships[number]) => `${relationship.direction}:${relationship.sourceItemId}:${relationship.relationshipType}:${relationship.targetItemId}`;
    if (observation.explicitRelationships.some((relationship, index) => index > 0 && relationKey(observation.explicitRelationships[index - 1]) >= relationKey(relationship))) {
      context.addIssue({ code: "custom", path: ["explicitRelationships"], message: "Explicit lighting relationships must be unique and canonically ordered." });
    }
    if (observation.explicitRelationships.some((relationship) => relationship.direction === "OUTGOING"
      ? relationship.sourceItemId !== observation.lightingItemId : relationship.targetItemId !== observation.lightingItemId)) {
      context.addIssue({ code: "custom", path: ["explicitRelationships"], message: "Recorded relationship direction must reference the evaluated lighting item." });
    }
  }),
  z.object({
    kind: z.literal("item_color_harmony"),
    itemId: identifier,
    color: aestheticColorSchema.nullable(),
    colorSource: z.enum(["catalog", "design_object", "normalized_attributes"]).nullable(),
    paletteColors: z.array(z.object({ role: z.enum(["primary", "secondary", "accent"]), color: aestheticColorSchema }).strict()),
    matchedPaletteRole: z.enum(["primary", "secondary", "accent"]).nullable(),
    relationship: z.enum(["IDENTICAL", "SIMILAR", "COORDINATED", "UNKNOWN"]),
    compatibility: designCompatibilitySchema,
    reasons: z.array(z.enum([
      "candidate_color_missing", "candidate_color_unknown", "design_color_intent_missing",
      "candidate_matches_primary_color", "candidate_matches_secondary_color", "candidate_matches_accent_color",
      "candidate_same_family_as_primary", "candidate_same_family_as_secondary", "candidate_same_family_as_accent",
      "candidate_harmonizes_with_primary", "candidate_harmonizes_with_secondary", "candidate_harmonizes_with_accent",
      "candidate_color_valid_but_not_aligned",
    ])).min(1),
  }).strict().superRefine((observation, context) => {
    if ((observation.color === null) !== (observation.colorSource === null)) context.addIssue({ code: "custom", path: ["colorSource"], message: "Item color provenance must match color availability." });
    const expectedRelationship = observation.reasons.some((reason) => reason.startsWith("candidate_matches_")) ? "IDENTICAL"
      : observation.reasons.some((reason) => reason.startsWith("candidate_same_family_as_")) ? "SIMILAR"
        : observation.reasons.some((reason) => reason.startsWith("candidate_harmonizes_with_")) ? "COORDINATED" : "UNKNOWN";
    if (observation.relationship !== expectedRelationship) context.addIssue({ code: "custom", path: ["relationship"], message: "Palette relationship must preserve existing color evaluator semantics." });
    if (expectedRelationship !== "UNKNOWN" && observation.compatibility !== "compatible") context.addIssue({ code: "custom", path: ["compatibility"], message: "Matched, similar, and harmonized palette colors are compatible." });
    if (observation.reasons.includes("candidate_color_valid_but_not_aligned") && observation.compatibility !== "mixed") context.addIssue({ code: "custom", path: ["compatibility"], message: "Valid but unaligned palette color remains mixed, not conflict." });
    if ((observation.reasons.includes("candidate_color_missing") || observation.reasons.includes("candidate_color_unknown") || observation.reasons.includes("design_color_intent_missing"))
      && observation.compatibility !== "unknown") context.addIssue({ code: "custom", path: ["compatibility"], message: "Missing or unsupported colors remain unknown." });
  }),
  z.object({
    kind: z.literal("pair_color_harmony"),
    relationshipType: aestheticRelationshipTypeSchema,
    pairItems: z.array(z.object({
      itemId: identifier,
      semanticRole: furnitureRoleSchema.nullable(),
      category: identifier,
      subtype: identifier.nullable(),
      color: aestheticColorSchema.nullable(),
      colorSource: z.enum(["catalog", "design_object", "normalized_attributes"]).nullable(),
    }).strict()).length(2),
    relationshipSources: z.array(z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("E10A_GROUP"), groupId: identifier }).strict(),
      z.object({ kind: z.literal("SEMANTIC_RELATIONSHIP"), relationshipType: z.literal("GROUPED_WITH") }).strict(),
    ])).min(1),
    relationship: z.enum(["IDENTICAL", "SIMILAR", "COORDINATED", "UNKNOWN"]),
    compatibility: designCompatibilitySchema,
    reasons: z.array(z.enum([
      "relationship_color_missing", "relationship_color_unknown", "relationship_colors_match",
      "relationship_colors_share_family", "relationship_colors_harmonize", "relationship_colors_valid_but_not_aligned",
    ])).min(1),
  }).strict().superRefine((observation, context) => {
    const itemIds = observation.pairItems.map((item) => item.itemId);
    if (new Set(itemIds).size !== itemIds.length || itemIds[0] > itemIds[1]) context.addIssue({ code: "custom", path: ["pairItems"], message: "Color pair members must be distinct and canonically ordered." });
    if (observation.pairItems.some((item) => (item.color === null) !== (item.colorSource === null))) context.addIssue({ code: "custom", path: ["pairItems"], message: "Pair color provenance must match color availability." });
    const expectedRelationship = observation.reasons.includes("relationship_colors_match") ? "IDENTICAL"
      : observation.reasons.includes("relationship_colors_share_family") ? "SIMILAR"
        : observation.reasons.includes("relationship_colors_harmonize") ? "COORDINATED" : "UNKNOWN";
    if (observation.relationship !== expectedRelationship) context.addIssue({ code: "custom", path: ["relationship"], message: "Pair relationship must preserve existing color-rule semantics." });
    if (expectedRelationship !== "UNKNOWN" && observation.compatibility !== "compatible") context.addIssue({ code: "custom", path: ["compatibility"], message: "Harmonious pair classifications must be compatible." });
    if (observation.reasons.includes("relationship_colors_valid_but_not_aligned") && observation.compatibility !== "mixed") context.addIssue({ code: "custom", path: ["compatibility"], message: "Valid but unaligned colors remain mixed, not conflict." });
    if ((observation.reasons.includes("relationship_color_missing") || observation.reasons.includes("relationship_color_unknown")) && observation.compatibility !== "unknown") context.addIssue({ code: "custom", path: ["compatibility"], message: "Missing or unsupported colors remain unknown." });
  }),
  z.object({
    kind: z.literal("item_material_harmony"),
    itemId: identifier,
    material: aestheticMaterialSchema.nullable(),
    materialSource: z.enum(["catalog", "design_object", "normalized_attributes"]).nullable(),
    preferenceRole: z.enum(["PREFERRED", "AVOIDED"]).nullable(),
    relationship: z.enum(["IDENTICAL", "SIMILAR", "CONFLICTING", "UNKNOWN"]),
    compatibility: designCompatibilitySchema,
    reasons: z.array(z.enum([
      "candidate_material_missing", "candidate_material_unknown", "design_material_intent_missing",
      "candidate_matches_preferred_material", "candidate_matches_preferred_material_family",
      "candidate_matches_avoided_material", "candidate_matches_avoided_material_family",
      "candidate_material_valid_but_not_preferred",
    ])).length(1),
  }).strict().superRefine((observation, context) => {
    if ((observation.material === null) !== (observation.materialSource === null)) context.addIssue({ code: "custom", path: ["materialSource"], message: "Material provenance must match material availability." });
    const preferred = observation.reasons.some((reason) => reason.startsWith("candidate_matches_preferred_material"));
    const avoided = observation.reasons.some((reason) => reason.startsWith("candidate_matches_avoided_material"));
    const expectedRole = preferred ? "PREFERRED" : avoided ? "AVOIDED" : null;
    const expectedRelationship = observation.reasons.includes("candidate_matches_preferred_material") ? "IDENTICAL"
      : observation.reasons.includes("candidate_matches_preferred_material_family") ? "SIMILAR"
        : avoided ? "CONFLICTING" : "UNKNOWN";
    const expectedCompatibility = preferred ? "compatible" : avoided ? "incompatible"
      : observation.reasons.includes("candidate_material_valid_but_not_preferred") ? "mixed" : "unknown";
    if (observation.preferenceRole !== expectedRole || observation.relationship !== expectedRelationship) context.addIssue({ code: "custom", path: ["relationship"], message: "Material preference classification must preserve the existing evaluator result." });
    if (observation.compatibility !== expectedCompatibility) context.addIssue({ code: "custom", path: ["compatibility"], message: "Material preference compatibility must preserve the existing evaluator result." });
  }),
  z.object({
    kind: z.literal("pair_material_harmony"),
    relationshipType: aestheticRelationshipTypeSchema,
    pairItems: z.array(z.object({
      itemId: identifier,
      semanticRole: furnitureRoleSchema.nullable(),
      material: aestheticMaterialSchema.nullable(),
      materialSource: z.enum(["catalog", "design_object", "normalized_attributes"]).nullable(),
      upholsteryType: z.enum(["fabric", "leather"]).nullable(),
      upholsteryMaterial: aestheticMaterialSchema.refine((material) => material.family === "textile" || material.family === "leather", "Upholstery material must use an existing upholstery family.").nullable(),
    }).strict()).length(2),
    relationshipSources: z.array(z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("E10A_GROUP"), groupId: identifier }).strict(),
      z.object({ kind: z.literal("SEMANTIC_RELATIONSHIP"), relationshipType: z.literal("GROUPED_WITH") }).strict(),
    ])).min(1),
    relationship: z.enum(["IDENTICAL", "SIMILAR", "UNKNOWN"]),
    compatibility: designCompatibilitySchema,
    reasons: z.array(z.enum([
      "upholsteryType_match", "upholsteryType_different", "upholsteryType_unknown",
      "upholsteryMaterial_match", "upholsteryMaterial_shared_material_family", "upholsteryMaterial_different", "upholsteryMaterial_unknown",
      "material_pair_rule_unavailable",
    ])).min(1),
  }).strict().superRefine((observation, context) => {
    const itemIds = observation.pairItems.map((item) => item.itemId);
    if (new Set(itemIds).size !== itemIds.length || itemIds[0] > itemIds[1]) context.addIssue({ code: "custom", path: ["pairItems"], message: "Material pair members must be distinct and canonically ordered." });
    if (observation.pairItems.some((item) => (item.material === null) !== (item.materialSource === null))) context.addIssue({ code: "custom", path: ["pairItems"], message: "Material provenance must match material availability." });
    const sourceKeys = observation.relationshipSources.map((source) => source.kind === "E10A_GROUP" ? `${source.kind}:${source.groupId}` : source.kind);
    if (new Set(sourceKeys).size !== sourceKeys.length || sourceKeys.some((key, index) => index > 0 && sourceKeys[index - 1] > key)) context.addIssue({ code: "custom", path: ["relationshipSources"], message: "Material relationship sources must be unique and canonically ordered." });
    const expectedRelationship = observation.reasons.includes("upholsteryMaterial_match") ? "IDENTICAL"
      : observation.reasons.includes("upholsteryMaterial_shared_material_family") ? "SIMILAR" : "UNKNOWN";
    const expectedCompatibility = observation.reasons.includes("material_pair_rule_unavailable") ? "unknown"
      : observation.reasons.some((reason) => reason.endsWith("_different")) ? "mixed"
        : observation.reasons.some((reason) => reason.endsWith("_match") || reason === "upholsteryMaterial_shared_material_family") ? "compatible" : "unknown";
    if (observation.relationship !== expectedRelationship || observation.compatibility !== expectedCompatibility) context.addIssue({ code: "custom", path: ["relationship"], message: "Pair material result must preserve the existing furniture-attribute comparison." });
  }),
  z.object({
    kind: z.literal("pair_texture_harmony"),
    relationshipType: aestheticRelationshipTypeSchema,
    pairItems: z.array(z.object({
      itemId: identifier,
      semanticRole: furnitureRoleSchema.nullable(),
      texture: z.string().trim().min(1).max(160).nullable(),
      textureSource: z.literal("normalized_attributes").nullable(),
    }).strict()).length(2),
    relationshipSources: z.array(z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("E10A_GROUP"), groupId: identifier }).strict(),
      z.object({ kind: z.literal("SEMANTIC_RELATIONSHIP"), relationshipType: z.literal("GROUPED_WITH") }).strict(),
    ])).min(1),
    relationship: z.enum(["IDENTICAL", "UNKNOWN"]),
    compatibility: designCompatibilitySchema,
    reasons: z.array(z.enum(["fabricTexture_match", "fabricTexture_different", "fabricTexture_unknown"])).length(1),
  }).strict().superRefine((observation, context) => {
    const itemIds = observation.pairItems.map((item) => item.itemId);
    if (new Set(itemIds).size !== itemIds.length || itemIds[0] > itemIds[1]) context.addIssue({ code: "custom", path: ["pairItems"], message: "Texture pair members must be distinct and canonically ordered." });
    if (observation.pairItems.some((item) => (item.texture === null) !== (item.textureSource === null))) context.addIssue({ code: "custom", path: ["pairItems"], message: "Texture provenance must match texture availability." });
    for (const [index, item] of observation.pairItems.entries()) {
      if (item.texture !== null) {
        const first = { ...unknownAttributes, fabricTexture: item.texture };
        if (evaluateFurnitureAttributeCompatibility(first, first).attributes.fabricTexture.compatibility === "unknown") {
          context.addIssue({ code: "custom", path: ["pairItems", index, "texture"], message: "Texture must use the existing normalized fabric-texture vocabulary." });
        }
      }
    }
    const expectedRelationship = observation.reasons.includes("fabricTexture_match") ? "IDENTICAL" : "UNKNOWN";
    const expectedCompatibility = observation.reasons.includes("fabricTexture_match") ? "compatible"
      : observation.reasons.includes("fabricTexture_different") ? "mixed" : "unknown";
    const sourceKeys = observation.relationshipSources.map((source) => source.kind === "E10A_GROUP" ? `${source.kind}:${source.groupId}` : source.kind);
    if (observation.relationship !== expectedRelationship || observation.compatibility !== expectedCompatibility) context.addIssue({ code: "custom", path: ["relationship"], message: "Texture result must preserve the existing furniture-attribute comparison." });
    if (new Set(sourceKeys).size !== sourceKeys.length || sourceKeys.some((key, index) => index > 0 && sourceKeys[index - 1] > key)) context.addIssue({ code: "custom", path: ["relationshipSources"], message: "Texture relationship sources must be unique and canonically ordered." });
  }),
  z.object({
    kind: z.literal("room_furniture_scale"),
    roomId: identifier,
    roomAreaCm2: z.number().finite().positive(),
    roomShortSideCm: z.number().finite().positive(),
    roomLongSideCm: z.number().finite().positive(),
    roomScale: z.enum(["SMALL", "MEDIUM", "LARGE"]),
    itemId: identifier,
    itemRole: furnitureRoleSchema,
    itemCategory: identifier,
    itemSubtype: identifier.nullable(),
    itemWidthCm: z.number().finite().positive(),
    itemDepthCm: z.number().finite().positive(),
    itemFootprintAreaCm2: z.number().finite().positive(),
    itemToRoomAreaRatio: z.number().finite().nonnegative(),
    roleEnvelopeCompatibility: designCompatibilitySchema,
    roleEnvelopeReasons: z.array(identifier),
    plannedWidthRangeCm: z.object({ minimum: z.number().finite().positive(), maximum: z.number().finite().positive() }).strict(),
    plannedDepthRangeCm: z.object({ minimum: z.number().finite().positive(), maximum: z.number().finite().positive() }).strict(),
    appliedRule: z.enum(["ROOM_CLASS_COMPOSITION", "LARGE_COMPACT_SOLO", "GROUP_CONTEXT", "NO_SUPPORTED_RULE"]),
    groupId: identifier.nullable(),
    supportingItemIds: distinctItemIds,
    outcome: z.enum(["APPROPRIATE", "UNDER_SUPPORTED_BY_COMPOSITION", "NO_REPOSITORY_BACKED_DEVIATION", "INSUFFICIENT_EVIDENCE", "SPATIAL_CONTEXT_UNRELIABLE"]),
  }).strict().superRefine((observation, context) => {
    const expectedArea = observation.itemWidthCm * observation.itemDepthCm;
    const expectedRatio = expectedArea / observation.roomAreaCm2;
    if (Math.abs(expectedArea - observation.itemFootprintAreaCm2) > 1e-6) context.addIssue({ code: "custom", path: ["itemFootprintAreaCm2"], message: "Footprint area must match item width × depth." });
    if (Math.abs(expectedRatio - observation.itemToRoomAreaRatio) > 1e-9) context.addIssue({ code: "custom", path: ["itemToRoomAreaRatio"], message: "Footprint ratio must match item area / polygon room area." });
    if (observation.plannedWidthRangeCm.maximum < observation.plannedWidthRangeCm.minimum
      || observation.plannedDepthRangeCm.maximum < observation.plannedDepthRangeCm.minimum) {
      context.addIssue({ code: "custom", path: ["plannedWidthRangeCm"], message: "Planned dimension ranges must be ordered." });
    }
    if ((observation.groupId === null) !== (observation.supportingItemIds.length === 0)) context.addIssue({ code: "custom", path: ["supportingItemIds"], message: "Group evidence must identify its supporting items." });
  }),
  z.object({
    kind: z.literal("furniture_proportion"),
    relationshipType: z.literal("sofa_rug"),
    pairItems: z.array(z.object({
      itemId: identifier,
      semanticRole: furnitureRoleSchema.nullable(),
      category: identifier,
      subtype: identifier.nullable(),
    }).strict()).length(2),
    relationshipSources: z.array(z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("E10A_GROUP"), groupId: identifier }).strict(),
      z.object({ kind: z.literal("SEMANTIC_RELATIONSHIP"), relationshipType: z.literal("GROUPED_WITH") }).strict(),
    ])).min(1),
    measurements: z.object({
      seatingWidthCm: z.number().finite().positive().nullable(),
      seatingWidthSource: z.enum(["catalog", "design_object"]).nullable(),
      rugWidthCm: z.number().finite().positive().nullable(),
      rugWidthSource: z.enum(["catalog", "design_object"]).nullable(),
      rugToSeatingWidthRatio: z.number().finite().nonnegative().nullable(),
    }).strict(),
    rule: z.object({
      evaluatorId: identifier,
      ruleId: identifier,
      version: identifier,
      compatibleAtOrAbove: z.literal(0.75),
      mixedAtOrAbove: z.literal(0.6),
      ratioMeaning: z.literal("rug_width_over_seating_width"),
    }).strict(),
    ruleResult: designCompatibilitySchema,
    assessmentStatus: z.enum(["EVALUATED", "INSUFFICIENT_EVIDENCE"]),
    assessmentReason: z.enum(["MISSING_REQUIRED_WIDTH", "PAIR_MEMBER_SPATIAL_VIOLATION"]).nullable(),
    reasons: z.array(z.enum([
      "relationship_dimensions_missing_or_invalid",
      "rug_width_proportionate_to_seating",
      "rug_width_somewhat_small_for_seating",
      "rug_width_too_small_for_seating",
    ])),
  }).strict().superRefine((observation, context) => {
    const itemIds = observation.pairItems.map((item) => item.itemId);
    if (new Set(itemIds).size !== itemIds.length) context.addIssue({ code: "custom", path: ["pairItems"], message: "Proportion pair item IDs must be distinct." });
    if (itemIds[0] > itemIds[1]) context.addIssue({ code: "custom", path: ["pairItems"], message: "Proportion pair items must use canonical item-ID order." });
    const sourceKeys = observation.relationshipSources.map((source) => source.kind === "E10A_GROUP" ? `${source.kind}:${source.groupId}` : source.kind);
    if (new Set(sourceKeys).size !== sourceKeys.length || sourceKeys.some((key, index) => index > 0 && sourceKeys[index - 1] > key)) {
      context.addIssue({ code: "custom", path: ["relationshipSources"], message: "Relationship sources must be unique and canonically ordered." });
    }
    const { seatingWidthCm, rugWidthCm, rugToSeatingWidthRatio } = observation.measurements;
    if ((seatingWidthCm === null) !== (observation.measurements.seatingWidthSource === null)
      || (rugWidthCm === null) !== (observation.measurements.rugWidthSource === null)) {
      context.addIssue({ code: "custom", path: ["measurements"], message: "Width provenance must be present exactly when the measurement is present." });
    }
    if (seatingWidthCm === null || rugWidthCm === null) {
      if (rugToSeatingWidthRatio !== null || observation.ruleResult !== "unknown"
        || observation.assessmentStatus !== "INSUFFICIENT_EVIDENCE" || observation.assessmentReason !== "MISSING_REQUIRED_WIDTH") {
        context.addIssue({ code: "custom", path: ["measurements"], message: "Missing widths require an unknown ratio and explicit insufficient-evidence status." });
      }
    } else {
      const ratio = rugWidthCm / seatingWidthCm;
      const expected = ratio >= 0.75 ? "compatible" : ratio >= 0.6 ? "mixed" : "incompatible";
      if (rugToSeatingWidthRatio === null || Math.abs(ratio - rugToSeatingWidthRatio) > 1e-9) context.addIssue({ code: "custom", path: ["measurements", "rugToSeatingWidthRatio"], message: "Rug/seating ratio must match the measured widths." });
      if (observation.ruleResult !== expected) context.addIssue({ code: "custom", path: ["ruleResult"], message: "Rule result must match the existing sofa/rug width thresholds." });
      if (observation.assessmentStatus === "INSUFFICIENT_EVIDENCE" && observation.assessmentReason !== "PAIR_MEMBER_SPATIAL_VIOLATION") context.addIssue({ code: "custom", path: ["assessmentReason"], message: "Complete dimensions can only be insufficient when a pair member has a spatial violation." });
    }
    if ((observation.assessmentStatus === "EVALUATED") !== (observation.assessmentReason === null)) context.addIssue({ code: "custom", path: ["assessmentReason"], message: "Evaluation status and reason must agree." });
  }),
  z.object({ kind: z.literal("attribute_comparison"), attribute: aestheticAttributeCategorySchema,
    subjectIds: z.array(identifier).min(2), values: z.array(evidenceValueSchema).min(2), relationship: aestheticHarmonyRelationshipSchema }).strict(),
  z.object({ kind: z.literal("measurement"), attribute: aestheticAttributeCategorySchema, subjectId: identifier,
    actualValue: z.number().finite(), unit: z.enum(["cm", "ratio", "count"]),
    expectedRange: z.object({ minimum: z.number().finite(), maximum: z.number().finite() }).strict().nullable() }).strict()
    .refine((measurement) => measurement.expectedRange === null || measurement.expectedRange.maximum >= measurement.expectedRange.minimum),
  z.object({ kind: z.literal("normalized_attribute"), attribute: aestheticAttributeCategorySchema, subjectId: identifier,
    value: evidenceValueSchema }).strict(),
  z.object({ kind: z.literal("relationship_observation"), relationship: aestheticHarmonyRelationshipSchema,
    subjectIds: z.array(identifier).min(2) }).strict(),
]);

const evidenceSchema = z.object({
  evidenceId: evidenceIdentifier,
  source: z.enum(["design_intent", "normalized_attributes", "measured_dimensions", "explicit_visual_observation", "e10a_plan"]),
  dimension: aestheticDimensionSchema,
  itemIds: distinctItemIds,
  description: explanation,
  observation: aestheticEvidenceObservationSchema,
}).strict().refine((evidence) => evidence.source === "design_intent" || evidence.source === "e10a_plan" || evidence.itemIds.length > 0, {
  path: ["itemIds"], message: "Observed or measured evidence must identify affected items.",
}).superRefine((evidence, context) => {
  if ((evidence.source === "design_intent") !== (evidence.observation.kind === "design_intent")) {
    context.addIssue({ code: "custom", path: ["observation"], message: "Design-intent sources require a design-intent observation, and vice versa." });
  }
  if ((evidence.source === "e10a_plan") !== (evidence.observation.kind === "furniture_group_composition" || evidence.observation.kind === "rug_zone_structure" || evidence.observation.kind === "lighting_composition_structure")) {
    context.addIssue({ code: "custom", path: ["observation"], message: "E.10-A plan sources require a group or rug-zone structure observation, and vice versa." });
  }
  if ((evidence.source === "measured_dimensions") !== (evidence.observation.kind === "measurement" || evidence.observation.kind === "room_furniture_scale" || evidence.observation.kind === "furniture_proportion")) {
    context.addIssue({ code: "custom", path: ["observation"], message: "Measured-dimension sources require a measurement observation, and vice versa." });
  }
  if ((evidence.observation.kind === "item_color_harmony" || evidence.observation.kind === "pair_color_harmony")
    && evidence.source !== "normalized_attributes") {
    context.addIssue({ code: "custom", path: ["source"], message: "Normalized color evidence must use its normalized-attribute source." });
  }
  if ((evidence.observation.kind === "item_material_harmony" || evidence.observation.kind === "pair_material_harmony" || evidence.observation.kind === "pair_texture_harmony")
    && evidence.source !== "normalized_attributes") {
    context.addIssue({ code: "custom", path: ["source"], message: "Material and texture observations must use their normalized-attribute evidence source." });
  }
});

const missingInformationSchema = z.object({
  code: stableCode,
  dimension: aestheticDimensionSchema,
  itemIds: distinctItemIds,
  description: explanation,
}).strict();

export const aestheticFindingSchema = z.object({
  findingId: findingIdentifier,
  code: stableCode,
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("dimension"), dimension: aestheticDimensionSchema }).strict(),
    z.object({ kind: z.literal("relationship"), relationshipId: relationshipIdentifier, relationshipType: aestheticRelationshipTypeSchema, dimension: aestheticDimensionSchema }).strict(),
  ]),
  subjects: z.array(aestheticSubjectSchema).min(1),
  itemIds: distinctItemIds,
  compatibility: designCompatibilitySchema,
  priority: aestheticPrioritySchema,
  impact: aestheticImpactSchema,
  explanation,
  evaluator: z.object({ evaluatorId: identifier, ruleId: identifier, version: identifier }).strict(),
  coverage: z.discriminatedUnion("status", [
    z.object({ status: z.literal("EVALUATED") }).strict(),
    z.object({ status: z.literal("INSUFFICIENT_EVIDENCE"), reason: explanation }).strict(),
    z.object({ status: z.literal("NOT_APPLICABLE"), reason: explanation }).strict(),
    z.object({ status: z.literal("NOT_EVALUATED"), reason: explanation }).strict(),
  ]),
  evidenceCompleteness: z.enum(["complete", "partial", "missing"]),
  supportingEvidence: z.array(evidenceSchema),
  missingInformation: z.array(missingInformationSchema),
  recommendationCategory: aestheticRecommendationCategorySchema.nullable().default(null),
}).strict().superRefine((finding, context) => {
  const issue = (path: string[], message: string) => context.addIssue({ code: "custom", path, message });
  const subjectItemIds = finding.subjects.filter((subject) => subject.kind === "ITEM").map((subject) => subject.id).sort();
  if (new Set(finding.subjects.map((subject) => `${subject.kind}:${subject.id}`)).size !== finding.subjects.length) issue(["subjects"], "Subject references must be distinct.");
  if (JSON.stringify(subjectItemIds) !== JSON.stringify([...finding.itemIds].sort())) issue(["itemIds"], "Affected item IDs must exactly match ITEM subjects.");
  if (finding.target.kind === "relationship" && finding.itemIds.length < 2) issue(["subjects"], "Relationship findings require at least two affected items.");
  if (finding.coverage.status !== "EVALUATED" && finding.compatibility !== "unknown") issue(["compatibility"], "Unevaluated or insufficient findings must have unknown compatibility.");
  if (finding.coverage.status === "INSUFFICIENT_EVIDENCE" && finding.evidenceCompleteness === "complete") issue(["evidenceCompleteness"], "Insufficient evidence cannot be declared complete.");
  if (finding.evidenceCompleteness === "missing" && finding.compatibility !== "unknown") issue(["compatibility"], "Missing evidence cannot support a known compatibility.");
  if (finding.compatibility !== "unknown" && finding.supportingEvidence.length === 0) issue(["supportingEvidence"], "Known compatibility requires supporting evidence.");
  if (finding.evidenceCompleteness === "complete" && (finding.supportingEvidence.length === 0 || finding.missingInformation.length > 0)) issue(["evidenceCompleteness"], "Complete evidence requires support and no missing information.");
  if (finding.evidenceCompleteness === "partial" && (finding.supportingEvidence.length === 0 || finding.missingInformation.length === 0)) issue(["evidenceCompleteness"], "Partial evidence requires support and explicit missing information.");
  if (finding.evidenceCompleteness === "missing" && (finding.supportingEvidence.length > 0 || finding.missingInformation.length === 0)) issue(["evidenceCompleteness"], "Missing evidence requires no support and explicit missing information.");
  if (new Set(finding.supportingEvidence.map((entry) => entry.evidenceId)).size !== finding.supportingEvidence.length) issue(["supportingEvidence"], "Evidence identifiers must be distinct.");
  for (const entry of [...finding.supportingEvidence, ...finding.missingInformation]) {
    if (entry.itemIds.some((id) => !finding.itemIds.includes(id))) issue(["itemIds"], "Evidence references must belong to the finding's affected items.");
  }
  for (const evidence of finding.supportingEvidence) {
    const evidenceItems = evidence.observation.kind === "design_intent" ? []
      : evidence.observation.kind === "furniture_group_composition" ? evidence.observation.members.map((member) => member.itemId)
      : evidence.observation.kind === "rug_zone_structure" ? [evidence.observation.rugItemId]
      : evidence.observation.kind === "lighting_composition_structure" ? [evidence.observation.lightingItemId]
      : evidence.observation.kind === "item_color_harmony" ? [evidence.observation.itemId]
      : evidence.observation.kind === "pair_color_harmony" ? evidence.observation.pairItems.map((item) => item.itemId)
      : evidence.observation.kind === "item_material_harmony" ? [evidence.observation.itemId]
      : evidence.observation.kind === "pair_material_harmony" || evidence.observation.kind === "pair_texture_harmony" ? evidence.observation.pairItems.map((item) => item.itemId)
      : evidence.observation.kind === "room_furniture_scale" ? [evidence.observation.itemId]
      : evidence.observation.kind === "furniture_proportion" ? evidence.observation.pairItems.map((item) => item.itemId)
      : evidence.observation.kind === "measurement" || evidence.observation.kind === "normalized_attribute"
      ? [evidence.observation.subjectId]
      : evidence.observation.subjectIds;
    if (evidenceItems.some((id) => !finding.itemIds.includes(id))) issue(["supportingEvidence"], "Structured evidence subjects must be affected item IDs.");
    const observation = evidence.observation;
    if (observation.kind === "furniture_group_composition") {
      const memberIds = observation.members.map((member) => member.itemId);
      if (finding.target.kind !== "dimension" || finding.target.dimension !== "composition"
        || JSON.stringify(memberIds) !== JSON.stringify([...finding.itemIds].sort())
        || !finding.subjects.some((subject) => subject.kind === "GROUP" && subject.id === observation.groupId)) {
        issue(["supportingEvidence"], "Group-composition evidence must match its group and all member items.");
      }
      if (finding.coverage.status !== "EVALUATED" || finding.compatibility !== "unknown" || finding.impact !== "NEUTRAL"
        || finding.recommendationCategory !== null) {
        issue(["coverage"], "Structural group inventory is neutral evidence, not a visual-quality judgment or recommendation.");
      }
      if (evidence.itemIds.length !== memberIds.length || memberIds.some((id) => !evidence.itemIds.includes(id))) {
        issue(["supportingEvidence"], "Group-composition evidence must identify exactly the group members.");
      }
    }
    if (observation.kind === "rug_zone_structure") {
      if (finding.target.kind !== "dimension" || finding.target.dimension !== "rug_zone_coherence"
        || finding.itemIds.length !== 1 || finding.itemIds[0] !== observation.rugItemId
        || !finding.subjects.some((subject) => subject.kind === "GROUP" && subject.id === observation.groupId)
        || finding.compatibility !== "unknown" || finding.impact !== "NEUTRAL" || finding.recommendationCategory !== null) {
        issue(["supportingEvidence"], "Rug-zone structure evidence must remain a neutral, non-recommendation inventory for its rug and E.10-A group.");
      }
      const expectedCoverage = observation.assessmentStatus === "STRUCTURE_RECORDED" ? "NOT_EVALUATED" : "INSUFFICIENT_EVIDENCE";
      if (finding.coverage.status !== expectedCoverage) issue(["coverage"], "Rug-zone structural evidence must not claim aesthetic quality evaluation.");
      if (evidence.itemIds.length !== 1 || evidence.itemIds[0] !== observation.rugItemId) {
        issue(["supportingEvidence"], "Rug-zone evidence must identify exactly the evaluated rug item.");
      }
    }
    if (observation.kind === "lighting_composition_structure") {
      const groupIds = observation.groupMemberships.map((membership) => membership.groupId);
      if (finding.target.kind !== "dimension" || finding.target.dimension !== "lighting_composition"
        || finding.itemIds.length !== 1 || finding.itemIds[0] !== observation.lightingItemId
        || finding.subjects.some((subject) => subject.kind === "GROUP" && !groupIds.includes(subject.id))
        || groupIds.some((groupId) => !finding.subjects.some((subject) => subject.kind === "GROUP" && subject.id === groupId))) {
        issue(["supportingEvidence"], "Lighting structure evidence must match its lighting item and explicit group subjects.");
      }
      if (finding.coverage.status !== "NOT_EVALUATED" || finding.compatibility !== "unknown" || finding.impact !== "NEUTRAL"
        || finding.priority !== "P3" || finding.recommendationCategory !== null) {
        issue(["coverage"], "Lighting role/placement evidence is not a performance or quality judgment and cannot create a recommendation.");
      }
      if (evidence.itemIds.length !== 1 || evidence.itemIds[0] !== observation.lightingItemId) {
        issue(["supportingEvidence"], "Lighting structure evidence must identify exactly the evaluated lighting item.");
      }
    }
    if (observation.kind === "room_furniture_scale") {
      const hasRoomSubject = finding.subjects.some((subject) => subject.kind === "ROOM" && subject.id === observation.roomId);
      if (finding.target.dimension !== "scale_proportion" || !finding.itemIds.includes(observation.itemId) || !hasRoomSubject) {
        issue(["supportingEvidence"], "Room-scale evidence must match its room and item finding subjects.");
      }
      if (evidence.itemIds.length !== 1 || evidence.itemIds[0] !== observation.itemId) {
        issue(["supportingEvidence"], "Room-scale evidence item references must identify the evaluated primary item.");
      }
    }
    if (observation.kind === "furniture_proportion") {
      const pairItemIds = observation.pairItems.map((item) => item.itemId).sort();
      if (finding.target.kind !== "relationship" || finding.target.relationshipType !== observation.relationshipType
        || finding.target.dimension !== "scale_proportion" || JSON.stringify(pairItemIds) !== JSON.stringify([...finding.itemIds].sort())) {
        issue(["supportingEvidence"], "Furniture-proportion evidence must match the finding relationship and both pair members.");
      }
      if (evidence.itemIds.length !== pairItemIds.length || pairItemIds.some((id) => !evidence.itemIds.includes(id))) {
        issue(["supportingEvidence"], "Furniture-proportion evidence must identify exactly both pair members.");
      }
      if (observation.assessmentStatus === "EVALUATED"
        && (finding.coverage.status !== "EVALUATED" || finding.compatibility !== observation.ruleResult)) {
        issue(["coverage"], "Evaluated furniture-proportion findings must preserve the existing rule result.");
      }
      if (observation.assessmentStatus === "INSUFFICIENT_EVIDENCE"
        && (finding.coverage.status !== "INSUFFICIENT_EVIDENCE" || finding.compatibility !== "unknown")) {
        issue(["coverage"], "Incomplete furniture-proportion findings must remain unknown and insufficient.");
      }
    }
    if (observation.kind === "item_color_harmony") {
      if (finding.target.kind !== "dimension" || finding.target.dimension !== "color_harmony"
        || finding.itemIds.length !== 1 || finding.itemIds[0] !== observation.itemId) {
        issue(["supportingEvidence"], "Item/palette color evidence must match a single-item color-harmony finding.");
      }
      const exact = observation.reasons.some((reason) => reason.startsWith("candidate_matches_"));
      const sameFamily = observation.reasons.some((reason) => reason.startsWith("candidate_same_family_as_"));
      const harmonizes = observation.reasons.some((reason) => reason.startsWith("candidate_harmonizes_with_"));
      const unaligned = observation.reasons.includes("candidate_color_valid_but_not_aligned");
      if ((exact && observation.relationship !== "IDENTICAL") || (sameFamily && observation.relationship !== "SIMILAR")
        || (harmonizes && observation.relationship !== "COORDINATED") || (unaligned && observation.relationship !== "UNKNOWN")) {
        issue(["supportingEvidence"], "Palette relationship must preserve the existing color evaluator result.");
      }
      if ((exact || sameFamily || harmonizes) && observation.compatibility !== "compatible") issue(["supportingEvidence"], "Matched/similar/harmonized palette colors must remain compatible.");
      if (unaligned && observation.compatibility !== "mixed") issue(["supportingEvidence"], "Valid but unaligned palette colors remain mixed, not conflict.");
      if ((observation.reasons.includes("candidate_color_missing") || observation.reasons.includes("candidate_color_unknown") || observation.reasons.includes("design_color_intent_missing"))
        && observation.compatibility !== "unknown") issue(["supportingEvidence"], "Missing or unsupported item/palette colors remain unknown.");
    }
    if (observation.kind === "pair_color_harmony") {
      const pairItemIds = observation.pairItems.map((item) => item.itemId);
      if (finding.target.kind !== "relationship" || finding.target.relationshipType !== observation.relationshipType
        || finding.target.dimension !== "color_harmony" || JSON.stringify(pairItemIds) !== JSON.stringify([...finding.itemIds].sort())) {
        issue(["supportingEvidence"], "Pair color evidence must match the finding relationship and both members.");
      }
      if (evidence.itemIds.length !== pairItemIds.length || pairItemIds.some((id) => !evidence.itemIds.includes(id))) {
        issue(["supportingEvidence"], "Pair color evidence must reference exactly both members.");
      }
    }
    if (observation.kind === "item_material_harmony") {
      if (finding.target.kind !== "dimension" || finding.target.dimension !== "material_harmony"
        || finding.itemIds.length !== 1 || finding.itemIds[0] !== observation.itemId
        || finding.compatibility !== observation.compatibility) {
        issue(["supportingEvidence"], "Item material evidence must match a single-item material-harmony finding and preserve compatibility.");
      }
      const avoided = observation.preferenceRole === "AVOIDED";
      const preferred = observation.preferenceRole === "PREFERRED";
      if ((avoided && finding.impact !== "MINOR_ISSUE") || (preferred && finding.impact !== "POSITIVE")
        || (!avoided && !preferred && finding.impact !== "NEUTRAL")) {
        issue(["impact"], "Only explicit material preference alignment or avoidance can affect finding impact.");
      }
      if ((finding.compatibility === "unknown") !== (finding.coverage.status === "INSUFFICIENT_EVIDENCE")) {
        issue(["coverage"], "Unknown item material results require insufficient-evidence coverage.");
      }
    }
    if (observation.kind === "pair_material_harmony" || observation.kind === "pair_texture_harmony") {
      const dimension = observation.kind === "pair_material_harmony" ? "material_harmony" : "texture_harmony";
      const pairItemIds = observation.pairItems.map((item) => item.itemId);
      if (finding.target.kind !== "relationship" || finding.target.relationshipType !== observation.relationshipType
        || finding.target.dimension !== dimension || finding.compatibility !== observation.compatibility
        || JSON.stringify(pairItemIds) !== JSON.stringify([...finding.itemIds].sort())) {
        issue(["supportingEvidence"], "Pair material/texture evidence must match its relationship finding and preserve compatibility.");
      }
      if (evidence.itemIds.length !== pairItemIds.length || pairItemIds.some((id) => !evidence.itemIds.includes(id))) {
        issue(["supportingEvidence"], "Pair material/texture evidence must reference exactly both members.");
      }
      if (finding.impact !== "NEUTRAL") issue(["impact"], "Pairwise attribute agreement alone does not establish a stronger design or a conflict.");
      if (observation.kind === "pair_material_harmony" && observation.reasons.includes("material_pair_rule_unavailable")
        && finding.coverage.status !== "NOT_EVALUATED") {
        issue(["coverage"], "Unsupported general-material pairings must remain not evaluated.");
      }
      if (observation.kind === "pair_material_harmony" && !observation.reasons.includes("material_pair_rule_unavailable")
        && finding.compatibility === "unknown" && finding.coverage.status !== "INSUFFICIENT_EVIDENCE") {
        issue(["coverage"], "Missing upholstery evidence requires insufficient-evidence coverage.");
      }
      if (observation.kind === "pair_texture_harmony" && finding.compatibility === "unknown" && finding.coverage.status !== "INSUFFICIENT_EVIDENCE") {
        issue(["coverage"], "Missing texture evidence requires insufficient-evidence coverage.");
      }
    }
  }
});

/** No aggregate compatibility/score: coverage, completeness and priority do not imply harmony. */
export const aestheticEvaluationReportSchema = z.object({
  contractVersion: z.literal("1.0"),
  intent: aestheticIntentSchema.nullable(),
  spatialStatus: z.object({
    status: z.enum(["VALID", "INVALID", "NOT_FULLY_EVALUATED"]),
    valid: z.boolean(), physicallyValid: z.boolean(), functionallyValid: z.boolean(),
    circulationStatus: z.enum(["PASS", "BLOCKED", "NOT_EVALUATED"]),
  }).strict(),
  items: z.array(aestheticItemSchema),
  relationships: z.array(aestheticRelationshipSchema),
  coverage: z.array(z.object({ dimension: aestheticDimensionSchema, status: aestheticCoverageStatusSchema,
    itemIds: distinctItemIds, reason: explanation.nullable() }).strict()).min(1),
  evaluatedItemIds: distinctItemIds,
  findings: z.array(aestheticFindingSchema),
  status: aestheticReportStatusSchema,
  diagnostics: z.array(z.object({ code: stableCode, description: explanation, itemIds: distinctItemIds }).strict()),
  strengths: distinctItemIds,
  issues: distinctItemIds,
}).strict().superRefine((report, context) => {
  const issue = (path: Array<string | number>, message: string) => context.addIssue({ code: "custom", path, message });
  const itemIds = new Set(report.items.map((item) => item.itemId));
  const relationshipIds = new Set(report.relationships.map((relationship) => relationship.relationshipId));
  const findingIds = new Set(report.findings.map((finding) => finding.findingId));
  if (itemIds.size !== report.items.length) issue(["items"], "Item identifiers must be unique.");
  if (relationshipIds.size !== report.relationships.length) issue(["relationships"], "Relationship identifiers must be unique.");
  if (findingIds.size !== report.findings.length) issue(["findings"], "Finding identifiers must be unique.");
  if (new Set(report.coverage.map((entry) => entry.dimension)).size !== report.coverage.length
    || report.coverage.length !== aestheticDimensions.length
    || aestheticDimensions.some((dimension) => !report.coverage.some((entry) => entry.dimension === dimension))) {
    issue(["coverage"], "Reports must include every aesthetic dimension exactly once.");
  }
  if (new Set(report.evaluatedItemIds).size !== report.evaluatedItemIds.length) issue(["evaluatedItemIds"], "Evaluated item IDs must be unique.");
  const evaluated = report.coverage.some((entry) => entry.status === "EVALUATED")
    || report.findings.some((finding) => finding.coverage.status === "EVALUATED");
  const incomplete = report.coverage.some((entry) => entry.status === "INSUFFICIENT_EVIDENCE" || entry.status === "NOT_EVALUATED")
    || report.findings.some((finding) => finding.coverage.status === "INSUFFICIENT_EVIDENCE" || finding.coverage.status === "NOT_EVALUATED");
  const expectedStatus = !evaluated ? "NOT_EVALUATED" : incomplete ? "PARTIALLY_EVALUATED" : "EVALUATED";
  if (report.status !== expectedStatus) issue(["status"], `Report status must be ${expectedStatus} for its coverage.`);
  const expectedEvaluatedItems = [...new Set([
    ...report.coverage.filter((entry) => entry.status === "EVALUATED").flatMap((entry) => entry.itemIds),
    ...report.findings.filter((finding) => finding.coverage.status === "EVALUATED").flatMap((finding) => finding.itemIds),
  ])].sort();
  if (JSON.stringify(report.evaluatedItemIds) !== JSON.stringify(expectedEvaluatedItems)) issue(["evaluatedItemIds"], "Evaluated item IDs must match evaluated coverage.");
  const dimensionOrder = new Map(aestheticDimensions.map((dimension, index) => [dimension, index]));
  const orderedCoverage = [...report.coverage].sort((first, second) => dimensionOrder.get(first.dimension)! - dimensionOrder.get(second.dimension)!);
  if (report.coverage.some((entry, index) => entry.dimension !== orderedCoverage[index].dimension)) issue(["coverage"], "Coverage must use canonical dimension order.");
  const impactOrder = { MAJOR_ISSUE: 0, MODERATE_ISSUE: 1, MINOR_ISSUE: 2, POSITIVE: 3, NEUTRAL: 4 } as const;
  const priorityOrder = { P2: 0, P3: 1 } as const;
  for (let index = 1; index < report.findings.length; index += 1) {
    const previous = report.findings[index - 1];
    const current = report.findings[index];
    const previousKey = [priorityOrder[previous.priority], impactOrder[previous.impact], dimensionOrder.get(previous.target.dimension)!, previous.evaluator.ruleId, previous.findingId];
    const currentKey = [priorityOrder[current.priority], impactOrder[current.impact], dimensionOrder.get(current.target.dimension)!, current.evaluator.ruleId, current.findingId];
    const comparison = previousKey.findIndex((value, key) => value !== currentKey[key]);
    if (comparison >= 0 && previousKey[comparison] > currentKey[comparison]) issue(["findings", index], "Findings must use canonical priority, impact, dimension, rule, and identifier order.");
  }
  for (const [index, coverage] of report.coverage.entries()) {
    if ((coverage.status === "EVALUATED" || coverage.status === "NOT_APPLICABLE") !== (coverage.reason === null)) {
      issue(["coverage", index, "reason"], "Evaluated/not-applicable coverage has no reason; incomplete coverage requires an explicit reason.");
    }
  }
  const expectedStrengths = report.findings.filter((finding) => finding.impact === "POSITIVE").map((finding) => finding.findingId).sort();
  const expectedIssues = report.findings.filter((finding) => ["MINOR_ISSUE", "MODERATE_ISSUE", "MAJOR_ISSUE"].includes(finding.impact)).map((finding) => finding.findingId).sort();
  if (JSON.stringify(report.strengths) !== JSON.stringify(expectedStrengths)) issue(["strengths"], "Strength finding IDs must match positive findings.");
  if (JSON.stringify(report.issues) !== JSON.stringify(expectedIssues)) issue(["issues"], "Issue finding IDs must match issue findings.");
  report.relationships.forEach((relationship, index) => {
    if (relationship.itemIds.some((id) => !itemIds.has(id))) issue(["relationships", index, "itemIds"], "Relationship references must identify report items.");
  });
  report.findings.forEach((finding, index) => {
    if (finding.itemIds.some((id) => !itemIds.has(id))) issue(["findings", index, "itemIds"], "Finding references must identify report items.");
    const dimensionCoverage = report.coverage.find((entry) => entry.dimension === finding.target.dimension);
    if (dimensionCoverage?.status === "NOT_APPLICABLE" && finding.coverage.status === "EVALUATED") {
      issue(["findings", index, "coverage"], "An evaluated finding cannot target a not-applicable report dimension.");
    }
    for (const subject of finding.subjects) if (subject.kind === "ITEM" && !itemIds.has(subject.id)) issue(["findings", index, "subjects"], "Item subjects must identify report items.");
    for (const evidence of finding.supportingEvidence) if (evidence.observation.kind === "room_furniture_scale"
      && evidence.observation.supportingItemIds.some((id) => !itemIds.has(id))) {
      issue(["findings", index, "supportingEvidence"], "Composition-context item references must identify report items.");
    }
    if (finding.target.kind !== "relationship") return;
    const target = finding.target;
    const relationship = report.relationships.find((entry) => entry.relationshipId === target.relationshipId);
    if (!relationship || relationship.type !== target.relationshipType) {
      issue(["findings", index, "target"], "Finding must identify a declared relationship of the same type.");
      return;
    }
    if (relationship.itemIds.length !== finding.itemIds.length || relationship.itemIds.some((id) => !finding.itemIds.includes(id))) issue(["findings", index, "itemIds"], "Relationship finding must reference exactly the declared participants.");
  });
});

export type AestheticIntent = z.infer<typeof aestheticIntentSchema>;
export type AestheticItem = z.infer<typeof aestheticItemSchema>;
export type AestheticRelationship = z.infer<typeof aestheticRelationshipSchema>;
export type AestheticFinding = z.infer<typeof aestheticFindingSchema>;
export type AestheticVisualWeightObservation = z.infer<typeof aestheticVisualWeightObservationSchema>;
export type AestheticEvaluationReport = z.infer<typeof aestheticEvaluationReportSchema>;