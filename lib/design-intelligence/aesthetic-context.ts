import { z } from "zod";

import type { CatalogCandidate } from "@/lib/catalog/schema";
import { ROOM_TYPES } from "@/lib/projects/validation";
import { roomGeometrySchema, roomOpeningSchema } from "@/lib/geometry/schema";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";
import { normalizeFurnitureAttributes, type FurnitureDesignAttributes } from "./furniture-attributes";
import { aestheticColorSchema, aestheticDimensions, aestheticFurnitureAttributesSchema, aestheticIntentSchema, aestheticMaterialSchema, aestheticRoleSchema, aestheticStyleCodeSchema } from "./aesthetic-contracts";
import { normalizeDesignColor } from "./color-harmony";
import { normalizeDesignMaterial } from "./material-harmony";
import { normalizeDesignStyle } from "./style-harmony";
import type { FurniturePlanV11 } from "@/lib/furniture-planning/types";
import { furniturePlanV11Schema } from "@/lib/furniture-planning/semantic-schema";
import { furnitureRoleSchema } from "@/lib/furniture-planning/semantic-schema";
import type { PrimarySeatingGroup } from "@/lib/furniture-planning/role-plan";
import { functionalZoneSchema, type FunctionalZone } from "@/lib/furniture-planning/zones";
import type { WholeRoomValidationReport } from "@/lib/furniture-planning/spatial-validation-report";
import type { Tables } from "@/types/database.types";

const text = z.string().trim().min(1).max(240);
const identifier = z.string().trim().min(1).max(160);
const stringList = z.array(text);
const knownPreferenceSchema = <T extends z.ZodTypeAny>(value: T) => z.discriminatedUnion("status", [
  z.object({ status: z.literal("KNOWN"), raw: text, value }).strict(),
  z.object({ status: z.literal("UNKNOWN"), raw: text.nullable(), reason: z.enum(["NOT_SUPPLIED", "UNRECOGNIZED_VALUE"]) }).strict(),
]);
const knownMetadataValueSchema = <T extends z.ZodTypeAny>(value: T) => z.discriminatedUnion("status", [
  z.object({ status: z.literal("KNOWN"), value, source: z.enum(["catalog", "design_object", "normalized_attributes"]) }).strict(),
  z.object({ status: z.literal("UNKNOWN"), reason: z.enum(["NOT_SUPPLIED", "UNRECOGNIZED_VALUE"]) }).strict(),
]);

export const aestheticPreferencesSchema = z.object({
  intent: aestheticIntentSchema,
  primaryStyle: knownPreferenceSchema(aestheticStyleCodeSchema),
  secondaryStyle: knownPreferenceSchema(aestheticStyleCodeSchema),
  palette: z.object({
    primary: knownPreferenceSchema(aestheticColorSchema), secondary: knownPreferenceSchema(aestheticColorSchema),
    accent: knownPreferenceSchema(aestheticColorSchema), metal: knownPreferenceSchema(aestheticColorSchema),
  }).strict(),
  preferredMaterials: z.array(knownPreferenceSchema(aestheticMaterialSchema)),
  avoidMaterials: z.array(knownPreferenceSchema(aestheticMaterialSchema)),
  functionalRequirements: z.object({
    roomFunctions: stringList,
    householdSize: text.nullable(),
    mustHaveItems: stringList,
    niceToHaveItems: stringList,
    specialRequirements: stringList,
  }).strict(),
  priority: text.nullable(),
  additionalNotes: text.nullable(),
}).strict();

export const aestheticGroupReferenceSchema = z.object({
  id: identifier,
  type: identifier,
  itemIds: z.array(identifier),
  zoneId: identifier.nullable(),
  primaryAnchorItemId: identifier.nullable(),
  secondaryAnchorItemIds: z.array(identifier),
  dependentItemIds: z.array(identifier),
}).strict().refine((group) => new Set(group.itemIds).size === group.itemIds.length);

export const aestheticSpatialItemSchema = z.object({
  itemId: identifier,
  category: text,
  subtype: text.nullable(),
  role: aestheticRoleSchema.nullable(),
  semanticRole: furnitureRoleSchema.nullable(),
  placement: z.object({
    approximatePosition: z.object({ xCm: z.number().finite(), yCm: z.number().finite() }).nullable(),
    preferredOrientationDegrees: z.number().finite().nullable(),
    anchorWallId: identifier.nullable(),
    mode: identifier.nullable(),
    zoneId: identifier.nullable(),
    relationships: z.array(z.object({ type: identifier, targetItemId: identifier }).strict()),
  }).strict(),
  sizeRange: z.object({
    widthMinCm: z.number().finite().positive(), widthMaxCm: z.number().finite().positive(),
    depthMinCm: z.number().finite().positive(), depthMaxCm: z.number().finite().positive(),
    heightMinCm: z.number().finite().positive(), heightMaxCm: z.number().finite().positive(),
  }).strict(),
  catalogReference: z.object({ productId: identifier.nullable(), variantId: identifier.nullable() }).strict().nullable(),
  designObjectReference: identifier.nullable(),
  metadata: z.object({
    style: knownMetadataValueSchema(aestheticStyleCodeSchema),
    color: knownMetadataValueSchema(aestheticColorSchema),
    materials: z.discriminatedUnion("status", [
      z.object({ status: z.literal("KNOWN"), values: z.array(aestheticMaterialSchema).min(1), source: z.enum(["catalog", "design_object", "normalized_attributes"]) }),
      z.object({ status: z.literal("UNKNOWN"), reason: z.enum(["NOT_SUPPLIED", "UNRECOGNIZED_VALUE"]) }),
    ]),
    attributes: aestheticFurnitureAttributesSchema,
    texture: knownMetadataValueSchema(text),
    finish: knownMetadataValueSchema(text),
    visualWeight: z.enum(["VERY_LIGHT", "LIGHT", "MEDIUM", "HEAVY", "VERY_HEAVY", "UNKNOWN"]),
    catalogMeasurements: z.object({ widthCm: z.number().finite().positive().nullable(), depthCm: z.number().finite().positive().nullable(), heightCm: z.number().finite().positive().nullable() }).strict().nullable(),
    designMeasurements: z.object({ widthCm: z.number().finite().positive().nullable(), depthCm: z.number().finite().positive().nullable(), heightCm: z.number().finite().positive().nullable() }).strict().nullable(),
  }).strict(),
}).strict().superRefine((item, context) => {
  for (const relationship of item.placement.relationships) {
    if (relationship.targetItemId === item.itemId) context.addIssue({ code: "custom", path: ["placement", "relationships"], message: "An item cannot reference itself." });
  }
});

const metadataCoverageStatusSchema = z.enum(["AVAILABLE", "PARTIAL", "UNAVAILABLE", "NOT_APPLICABLE"]);
export const aestheticMetadataCoverageSchema = z.object({
  dimension: z.enum(aestheticDimensions),
  status: metadataCoverageStatusSchema,
  applicableItemIds: z.array(identifier),
  knownItemIds: z.array(identifier),
  unavailableItemIds: z.array(identifier),
}).strict().superRefine((coverage, context) => {
  const applicable = new Set(coverage.applicableItemIds);
  const known = new Set(coverage.knownItemIds);
  const unavailable = new Set(coverage.unavailableItemIds);
  if (applicable.size !== coverage.applicableItemIds.length || known.size !== coverage.knownItemIds.length || unavailable.size !== coverage.unavailableItemIds.length) context.addIssue({ code: "custom", message: "Coverage item IDs must be distinct." });
  if (coverage.knownItemIds.some((id) => !applicable.has(id)) || coverage.unavailableItemIds.some((id) => !applicable.has(id))
    || coverage.knownItemIds.some((id) => unavailable.has(id)) || known.size + unavailable.size !== applicable.size) {
    context.addIssue({ code: "custom", message: "Known and unavailable IDs must partition applicable items." });
  }
  if ((coverage.status === "NOT_APPLICABLE") !== (coverage.applicableItemIds.length === 0)) context.addIssue({ code: "custom", message: "Applicability must agree with coverage status." });
  if (coverage.status === "AVAILABLE" && coverage.unavailableItemIds.length) context.addIssue({ code: "custom", message: "Available coverage cannot list unavailable items." });
  if (coverage.status === "AVAILABLE" && coverage.knownItemIds.length !== coverage.applicableItemIds.length) context.addIssue({ code: "custom", message: "Available coverage must cover every applicable item." });
  if (coverage.status === "PARTIAL" && (!coverage.knownItemIds.length || !coverage.unavailableItemIds.length)) context.addIssue({ code: "custom", message: "Partial coverage requires known and unavailable items." });
  if (coverage.status === "UNAVAILABLE" && coverage.knownItemIds.length) context.addIssue({ code: "custom", message: "Unavailable coverage cannot list known items." });
  if (coverage.status === "UNAVAILABLE" && !coverage.applicableItemIds.length) context.addIssue({ code: "custom", message: "Unavailable coverage requires applicable items." });
});

export const aestheticDesignContextSchema = z.object({
  schemaVersion: z.literal("1.0"),
  designId: identifier.nullable(),
  projectId: identifier,
  roomType: z.enum(ROOM_TYPES),
  preferences: aestheticPreferencesSchema.nullable(),
  preferenceAvailability: z.enum(["PROVIDED", "NOT_SUPPLIED"]),
  planReference: z.object({ schemaVersion: z.literal("1.1"), itemIds: z.array(identifier) }).strict(),
  geometry: roomGeometrySchema,
  openings: z.array(roomOpeningSchema),
  zones: z.array(functionalZoneSchema),
  groups: z.array(aestheticGroupReferenceSchema),
  items: z.array(aestheticSpatialItemSchema),
  spatialValidation: z.object({
    status: z.enum(["VALID", "INVALID", "NOT_FULLY_EVALUATED"]),
    valid: z.boolean(), physicallyValid: z.boolean(), functionallyValid: z.boolean(),
    violationIds: z.array(identifier), violatingItemIds: z.array(identifier), circulationStatus: z.enum(["PASS", "BLOCKED", "NOT_EVALUATED"]),
  }).strict(),
  metadataCoverage: z.array(aestheticMetadataCoverageSchema),
}).strict().superRefine((context, validation) => {
  const planIds = new Set(context.planReference.itemIds);
  const itemIds = context.items.map((item) => item.itemId);
  if (planIds.size !== context.planReference.itemIds.length || new Set(itemIds).size !== itemIds.length) validation.addIssue({ code: "custom", path: ["items"], message: "Plan and context item IDs must be unique." });
  if (itemIds.length !== planIds.size || itemIds.some((id) => !planIds.has(id))) validation.addIssue({ code: "custom", path: ["planReference"], message: "Context items must exactly reference the E.10-A plan items." });
  for (const item of context.items) for (const relationship of item.placement.relationships) {
    if (!planIds.has(relationship.targetItemId)) validation.addIssue({ code: "custom", path: ["items"], message: "Spatial relationship target must reference a plan item ID." });
  }
  for (const group of context.groups) if (group.itemIds.some((id) => !planIds.has(id))) validation.addIssue({ code: "custom", path: ["groups"], message: "Group members must reference plan item IDs." });
  for (const coverage of context.metadataCoverage) {
    const partition = [...coverage.knownItemIds, ...coverage.unavailableItemIds];
    if (partition.length !== coverage.applicableItemIds.length
      || [...partition].sort().some((id, index) => id !== [...coverage.applicableItemIds].sort()[index])
      || coverage.applicableItemIds.some((id) => !planIds.has(id))) {
      validation.addIssue({ code: "custom", path: ["metadataCoverage"], message: "Coverage must partition only applicable plan items." });
    }
  }
  if ((context.preferences === null) !== (context.preferenceAvailability === "NOT_SUPPLIED")) validation.addIssue({ code: "custom", path: ["preferenceAvailability"], message: "Preference availability must match the supplied preferences." });
});

export type AestheticPreferences = z.infer<typeof aestheticPreferencesSchema>;
export type AestheticItemContext = z.infer<typeof aestheticSpatialItemSchema>;
export type AestheticGroupReference = z.infer<typeof aestheticGroupReferenceSchema>;
export type AestheticMetadataCoverage = z.infer<typeof aestheticMetadataCoverageSchema>;
export type AestheticDesignContext = z.infer<typeof aestheticDesignContextSchema>;

type ProjectPreferences = Pick<Tables<"room_preferences">,
  "primary_style" | "secondary_style" | "color_mood" | "primary_color" | "secondary_color" | "accent_color" | "metal_color"
  | "preferred_materials" | "avoid_materials" | "room_functions" | "must_have_items" | "nice_to_have_items"
  | "household_size" | "special_requirements" | "additional_notes" | "priority">;
export type CatalogAestheticMetadata = Pick<CatalogCandidate,
  "productId" | "variantId" | "normalizedStyle" | "normalizedColor" | "normalizedMaterial" | "seatingCapacity" | "widthCm" | "depthCm" | "heightCm">;
export type DesignObjectAestheticMetadata = Pick<Tables<"design_objects">,
  "id" | "catalog_product_id" | "catalog_product_variant_id" | "material" | "primary_color" | "width_cm" | "depth_cm" | "height_cm">;
export type AestheticItemMetadataInput = {
  catalog?: CatalogAestheticMetadata | null;
  designObject?: DesignObjectAestheticMetadata | null;
  furnitureAttributes?: FurnitureDesignAttributes | null;
  visualWeight?: Exclude<z.infer<typeof aestheticSpatialItemSchema>["metadata"]["visualWeight"], "UNKNOWN"> | null;
};
export type AestheticDesignContextInput = {
  designId?: string | null;
  project: Pick<Tables<"projects">, "id" | "room_type">;
  preferences: ProjectPreferences | null;
  plan: FurniturePlanV11;
  geometry: RoomGeometry;
  openings: readonly RoomOpening[];
  zones: readonly FunctionalZone[];
  groups?: readonly PrimarySeatingGroup[];
  spatialReport: WholeRoomValidationReport;
  itemMetadataByPlanId?: Readonly<Record<string, AestheticItemMetadataInput>>;
};

type ValueSource = "catalog" | "design_object" | "normalized_attributes";
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && !!entry.trim()).map((entry) => entry.trim()))].sort();
}
function preferenceValue<T>(raw: string | null | undefined, normalized: T | null, recognized: boolean) {
  if (!raw?.trim()) return { status: "UNKNOWN" as const, raw: null, reason: "NOT_SUPPLIED" as const };
  if (!recognized || normalized === null) return { status: "UNKNOWN" as const, raw: raw.trim(), reason: "UNRECOGNIZED_VALUE" as const };
  return { status: "KNOWN" as const, raw: raw.trim(), value: normalized };
}
function knownValue<T>(raw: string | null | undefined, normalized: T | null, source: ValueSource, attempted: boolean) {
  if (!attempted || !raw?.trim()) return { status: "UNKNOWN" as const, reason: "NOT_SUPPLIED" as const };
  if (normalized === null) return { status: "UNKNOWN" as const, reason: "UNRECOGNIZED_VALUE" as const };
  return { status: "KNOWN" as const, value: normalized, source };
}

function validMeasurement(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function normalizeAestheticPreferences(roomType: string, preferences: ProjectPreferences | null): AestheticPreferences | null {
  if (!preferences) return null;
  const styleValue = (raw: string | null) => raw ? normalizeDesignStyle(raw) : null;
  const intent = aestheticIntentSchema.parse({
    roomType,
    primaryStyle: styleValue(preferences.primary_style), secondaryStyle: styleValue(preferences.secondary_style), colorMood: preferences.color_mood,
    colors: { primary: preferences.primary_color, secondary: preferences.secondary_color, accent: preferences.accent_color, metal: preferences.metal_color },
    preferredMaterials: strings(preferences.preferred_materials), avoidMaterials: strings(preferences.avoid_materials),
    colorTemperature: "unknown", heightVariation: "unknown", formVariation: "unknown",
  });
  const style = (raw: string | null) => preferenceValue(raw, raw ? normalizeDesignStyle(raw) : null, !!raw && normalizeDesignStyle(raw) !== null);
  const color = (raw: string | null) => preferenceValue(raw, raw ? normalizeDesignColor(raw) : null, !!raw && normalizeDesignColor(raw) !== null);
  const material = (raw: string) => preferenceValue(raw, normalizeDesignMaterial(raw), normalizeDesignMaterial(raw) !== null);
  return aestheticPreferencesSchema.parse({
    intent,
    primaryStyle: style(preferences.primary_style), secondaryStyle: style(preferences.secondary_style),
    palette: { primary: color(preferences.primary_color), secondary: color(preferences.secondary_color), accent: color(preferences.accent_color), metal: color(preferences.metal_color) },
    preferredMaterials: strings(preferences.preferred_materials).map(material), avoidMaterials: strings(preferences.avoid_materials).map(material),
    functionalRequirements: {
      roomFunctions: strings(preferences.room_functions), householdSize: preferences.household_size,
      mustHaveItems: strings(preferences.must_have_items), niceToHaveItems: strings(preferences.nice_to_have_items),
      specialRequirements: strings(preferences.special_requirements),
    },
    priority: preferences.priority,
    additionalNotes: preferences.additional_notes,
  });
}

function metadataForItem(item: FurniturePlanV11["items"][number], input: AestheticItemMetadataInput = {}): AestheticItemContext {
  const catalog = input.catalog;
  const designObject = input.designObject;
  const styleRaw = catalog?.normalizedStyle;
  const colorRaw = catalog?.normalizedColor ?? designObject?.primary_color;
  const materialRaw = catalog?.normalizedMaterial ?? designObject?.material ?? input.furnitureAttributes?.upholsteryMaterial;
  const attributes = input.furnitureAttributes ?? normalizeFurnitureAttributes({ seatingCapacity: catalog?.seatingCapacity ?? null });
  const textureRaw = attributes.fabricTexture;
  const textureValue = textureRaw ? textureRaw : null;
  const finishRaw: string | null = null;
  const material = materialRaw ? normalizeDesignMaterial(materialRaw) : null;
  const parsedAttributes = aestheticFurnitureAttributesSchema.parse(attributes);
  return aestheticSpatialItemSchema.parse({
    itemId: item.id, category: item.category, subtype: item.subtype, role: null, semanticRole: item.semanticPlacement.role,
    placement: {
      approximatePosition: item.placement.approximatePosition ? { ...item.placement.approximatePosition } : null,
      preferredOrientationDegrees: item.placement.preferredOrientationDegrees, anchorWallId: item.placement.anchorWallId,
      mode: item.semanticPlacement.mode, zoneId: item.semanticPlacement.zoneId,
      relationships: item.semanticPlacement.relationships.map((relationship) => ({ ...relationship })).sort((first, second) => {
        const a = `${first.type}:${first.targetItemId}`; const b = `${second.type}:${second.targetItemId}`; return a < b ? -1 : a > b ? 1 : 0;
      }),
    },
    sizeRange: { ...item.sizeRange },
    catalogReference: catalog ? { productId: catalog.productId || null, variantId: catalog.variantId || null }
      : designObject ? { productId: designObject.catalog_product_id, variantId: designObject.catalog_product_variant_id } : null,
    designObjectReference: designObject?.id ?? null,
    metadata: {
      style: knownValue(styleRaw, styleRaw ? normalizeDesignStyle(styleRaw) : null, "catalog", styleRaw !== null && styleRaw !== undefined),
      color: knownValue(colorRaw, colorRaw ? normalizeDesignColor(colorRaw) : null, catalog?.normalizedColor ? "catalog" : "design_object", colorRaw !== null && colorRaw !== undefined),
      materials: material ? { status: "KNOWN", values: [material], source: catalog?.normalizedMaterial ? "catalog" : designObject?.material ? "design_object" : "normalized_attributes" }
        : { status: "UNKNOWN", reason: materialRaw ? "UNRECOGNIZED_VALUE" : "NOT_SUPPLIED" },
      attributes: parsedAttributes,
      texture: knownValue(textureRaw, textureValue, "normalized_attributes", textureRaw !== null),
      finish: knownValue(finishRaw, null, "design_object", false),
      visualWeight: input.visualWeight ?? "UNKNOWN",
      catalogMeasurements: catalog ? { widthCm: validMeasurement(catalog.widthCm), depthCm: validMeasurement(catalog.depthCm), heightCm: validMeasurement(catalog.heightCm) } : null,
      designMeasurements: designObject ? { widthCm: validMeasurement(designObject.width_cm), depthCm: validMeasurement(designObject.depth_cm), heightCm: validMeasurement(designObject.height_cm) } : null,
    },
  });
}

function coverageForDimension(dimension: z.infer<typeof aestheticMetadataCoverageSchema>["dimension"], known: string[], applicableItemIds: string[]): AestheticMetadataCoverage {
  const applicable = [...applicableItemIds].sort();
  const knownItemIds = [...new Set(known.filter((id) => applicable.includes(id)))].sort();
  const unavailableItemIds = applicable.filter((id) => !knownItemIds.includes(id));
  const status = !applicable.length ? "NOT_APPLICABLE" : knownItemIds.length === 0 ? "UNAVAILABLE"
    : unavailableItemIds.length === 0 ? "AVAILABLE" : "PARTIAL";
  return aestheticMetadataCoverageSchema.parse({ dimension, status, applicableItemIds: applicable, knownItemIds, unavailableItemIds });
}

/** Projects authoritative E.10-A structures; does not create a second plan or infer appearance. */
export function createAestheticDesignContext(input: AestheticDesignContextInput): AestheticDesignContext {
  const plan = furniturePlanV11Schema.parse(input.plan);
  const allIds = plan.items.map((item) => item.id).sort();
  const preferences = normalizeAestheticPreferences(input.project.room_type, input.preferences);
  const items = plan.items.map((item) => metadataForItem(item, input.itemMetadataByPlanId?.[item.id])).sort((first, second) => first.itemId < second.itemId ? -1 : first.itemId > second.itemId ? 1 : 0);
  const known = (predicate: (item: AestheticItemContext) => boolean) => items.filter(predicate).map((item) => item.itemId);
  const zones = [...input.zones].sort((first, second) => first.id < second.id ? -1 : first.id > second.id ? 1 : 0);
  const groups = [...(input.groups ?? [])].map((group) => {
    const itemIds = [...new Set([group.primaryAnchorItemId, ...group.secondaryAnchorItemIds, ...group.dependentItemIds])].sort();
    return { id: group.id, type: group.type, itemIds, zoneId: group.zoneId,
      primaryAnchorItemId: group.primaryAnchorItemId, secondaryAnchorItemIds: [...group.secondaryAnchorItemIds].sort(),
      dependentItemIds: [...group.dependentItemIds].sort() };
  }).sort((first, second) => first.id < second.id ? -1 : first.id > second.id ? 1 : 0);
  const spatialStatus = {
    status: input.spatialReport.status, valid: input.spatialReport.valid, physicallyValid: input.spatialReport.physicallyValid,
    functionallyValid: input.spatialReport.functionallyValid,
    violationIds: input.spatialReport.violations.map((violation) => violation.id).sort(),
    violatingItemIds: [...new Set(input.spatialReport.violations.flatMap((violation) => violation.itemIds))].sort(),
    circulationStatus: input.spatialReport.circulation.status,
  };
  const rugIds = items.filter((item) => item.semanticRole === "AREA_RUG").map((item) => item.itemId);
  const lightingIds = items.filter((item) => ["TASK_LIGHTING", "AMBIENT_LIGHTING"].includes(item.semanticRole ?? "")).map((item) => item.itemId);
  return aestheticDesignContextSchema.parse({
    schemaVersion: "1.0", designId: input.designId ?? null, projectId: input.project.id, roomType: input.project.room_type,
    preferences, preferenceAvailability: preferences ? "PROVIDED" : "NOT_SUPPLIED",
    planReference: { schemaVersion: plan.schemaVersion, itemIds: allIds },
    geometry: { ...input.geometry, vertices: input.geometry.vertices.map((vertex) => ({ ...vertex })), wallSegments: input.geometry.wallSegments.map((wall) => ({ ...wall })), templateTransform: { ...input.geometry.templateTransform } },
    openings: [...input.openings].map((opening) => ({ ...opening })).sort((first, second) => {
      const a = `${first.wallSegmentId}:${first.offsetCm}:${first.id ?? ""}`; const b = `${second.wallSegmentId}:${second.offsetCm}:${second.id ?? ""}`; return a < b ? -1 : a > b ? 1 : 0;
    }),
    zones: zones.map((zone) => ({ ...zone, polygon: zone.polygon.map((vertex) => ({ ...vertex })), center: { ...zone.center } })), groups, items,
    spatialValidation: spatialStatus,
    metadataCoverage: [
      coverageForDimension("scale_proportion", known((item) =>
        [item.metadata.designMeasurements, item.metadata.catalogMeasurements].some((measurements) =>
          measurements?.widthCm !== null && measurements?.widthCm !== undefined
          && measurements.depthCm !== null && measurements.depthCm !== undefined)), allIds),
      coverageForDimension("style_harmony", known((item) => item.metadata.style.status === "KNOWN"), allIds),
      coverageForDimension("color_harmony", known((item) => item.metadata.color.status === "KNOWN"), allIds),
      coverageForDimension("material_harmony", known((item) => item.metadata.materials.status === "KNOWN"), allIds),
      coverageForDimension("texture_harmony", known((item) => item.metadata.texture.status === "KNOWN"), allIds),
      coverageForDimension("visual_weight", known((item) => item.metadata.visualWeight !== "UNKNOWN"), allIds),
      coverageForDimension("visual_balance", known((item) => item.placement.approximatePosition !== null), allIds),
      coverageForDimension("rug_zone_coherence", known((item) => item.placement.zoneId !== null), rugIds),
      coverageForDimension("lighting_composition", known((item) => item.placement.approximatePosition !== null), lightingIds),
      ...aestheticDimensions.filter((dimension) => !["scale_proportion", "style_harmony", "color_harmony", "material_harmony", "texture_harmony", "visual_weight", "visual_balance", "rug_zone_coherence", "lighting_composition"].includes(dimension)).map((dimension) => coverageForDimension(dimension, [], allIds)),
    ].sort((first, second) => aestheticDimensions.indexOf(first.dimension) - aestheticDimensions.indexOf(second.dimension)),
  });
}