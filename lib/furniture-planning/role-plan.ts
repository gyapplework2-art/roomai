import { getWallLengthCm } from "@/lib/geometry/dimensions";
import type { RoomGeometry, RoomOpening } from "@/lib/geometry/types";
import { selectLivingRoomComposition, type CompositionSelectionInput } from "./composition-selector";
import type { CompositionTemplate, CompositionType } from "./compositions";
import { normalizeSemanticPlan } from "./semantic-normalize";
import { resolveSemanticPlacement, resolveSemanticPlan } from "./semantic-resolver";
import type { FurniturePlanItemV11, FurniturePlanV11 } from "./types";
import { deriveFunctionalZones, PRIMARY_SEATING_ZONE_ID } from "./zones";

export type PrimarySeatingGroup = {
  id: "primary-seating-group";
  type: "PRIMARY_SEATING_GROUP";
  zoneId: string;
  primaryAnchorItemId: string;
  secondaryAnchorItemIds: string[];
  dependentItemIds: string[];
};

const planningSizes: Record<CompositionType, FurniturePlanItemV11["sizeRange"]> = {
  sofa: { widthMinCm: 200, widthMaxCm: 240, depthMinCm: 80, depthMaxCm: 100, heightMinCm: 75, heightMaxCm: 90 },
  loveseat: { widthMinCm: 140, widthMaxCm: 180, depthMinCm: 80, depthMaxCm: 100, heightMinCm: 75, heightMaxCm: 90 },
  sectional: { widthMinCm: 260, widthMaxCm: 320, depthMinCm: 140, depthMaxCm: 180, heightMinCm: 75, heightMaxCm: 90 },
  modular_seating: { widthMinCm: 260, widthMaxCm: 360, depthMinCm: 90, depthMaxCm: 160, heightMinCm: 75, heightMaxCm: 90 },
  armchair: { widthMinCm: 70, widthMaxCm: 90, depthMinCm: 70, depthMaxCm: 90, heightMinCm: 75, heightMaxCm: 95 },
  coffee_table: { widthMinCm: 90, widthMaxCm: 110, depthMinCm: 50, depthMaxCm: 70, heightMinCm: 35, heightMaxCm: 50 },
  rug: { widthMinCm: 180, widthMaxCm: 240, depthMinCm: 240, depthMaxCm: 300, heightMinCm: 1, heightMaxCm: 3 },
};

function itemId(key: string, occurrence: number) {
  return `${key}-${occurrence}`;
}

export function generateCompositionRolePlan(
  composition: CompositionTemplate,
  geometry: RoomGeometry,
  openings: RoomOpening[] = [],
) {
  const zones = deriveFunctionalZones(geometry);
  const seatingZone = zones.find((zone) => zone.type === "PRIMARY_SEATING");
  const items: FurniturePlanItemV11[] = composition.roles.flatMap((role) => role.placements.map((intent, index) => ({
    id: itemId(role.key, index + 1),
    category: role.category,
    subtype: null,
    priority: "required",
    placement: {
      preferredZone: PRIMARY_SEATING_ZONE_ID,
      anchorWallId: null,
      approximatePosition: seatingZone ? { ...seatingZone.center } : null,
      preferredOrientationDegrees: seatingZone?.orientationDegrees ?? 0,
    },
    semanticPlacement: {
      role: role.role,
      mode: intent.mode,
      alignment: intent.alignment,
      zoneId: PRIMARY_SEATING_ZONE_ID,
      targetWallId: null,
      relationships: intent.relationships.map((relationship) => ({
        type: relationship.type,
        targetItemId: itemId(relationship.targetRoleKey, relationship.targetOccurrence),
      })),
      fallbackModes: [],
    },
    sizeRange: { ...planningSizes[role.category] },
    styleHints: [], materialHints: [], colorHints: [], functionalRequirements: [],
    reasoning: `${composition.id} ${role.key} composition intent; provisional dimensions, not a fit certification.`,
  })));
  const primaryId = itemId(composition.group.primaryAnchorKey, 1);
  const primary = items.find((item) => item.id === primaryId);
  if (!primary) throw new Error("Composition requires an explicit primary anchor.");
  const orderedWalls = [...geometry.wallSegments].sort((first, second) =>
    (getWallLengthCm(geometry, second) ?? 0) - (getWallLengthCm(geometry, first) ?? 0)
      || (first.id < second.id ? -1 : first.id > second.id ? 1 : 0));
  const wall = orderedWalls.find((candidate) => {
    const item = { ...primary, semanticPlacement: { ...primary.semanticPlacement, targetWallId: candidate.id } };
    return resolveSemanticPlacement(item, geometry, openings).placement !== item.placement;
  });
  primary.semanticPlacement = {
    ...primary.semanticPlacement,
    mode: wall ? "AGAINST_WALL" : "CENTERED_IN_ZONE",
    targetWallId: wall?.id ?? null,
  };
  const idsForKeys = (keys: readonly string[]) => keys.flatMap((key) => items.filter((item) => item.id.startsWith(`${key}-`)).map((item) => item.id));
  const group: PrimarySeatingGroup = {
    id: "primary-seating-group", type: composition.group.type, zoneId: PRIMARY_SEATING_ZONE_ID,
    primaryAnchorItemId: primaryId,
    secondaryAnchorItemIds: idsForKeys(composition.group.secondaryAnchorKeys),
    dependentItemIds: idsForKeys(composition.group.dependentKeys),
  };
  const plan: FurniturePlanV11 = {
    schemaVersion: "1.1", roomIntent: `${composition.id} living-room composition`, items,
    notes: [
      "Runtime composition strategy; physical fit and circulation are not certified.",
      "PRIMARY_SEATING uses the whole-room polygon as a bootstrap allocation, not exclusive seating ownership. Its center is an approximate composition reference, not a certification of fit, collision safety, circulation, or final rug placement quality. Later spatial planning may refine the usable seating region.",
      "Independent chair intents do not guarantee symmetric or separated placement; later spatial validation may refine them.",
    ],
  };
  return { templateId: composition.id, group, zones, plan: normalizeSemanticPlan(plan) };
}

export function resolveLivingRoomComposition(
  input: CompositionSelectionInput & { geometry: RoomGeometry },
  openings: RoomOpening[] = [],
) {
  const composition = selectLivingRoomComposition(input);
  const generated = generateCompositionRolePlan(composition, input.geometry, openings);
  return {
    ...generated,
    requirementDiagnostics: composition.requirementDiagnostics,
    plan: resolveSemanticPlan(generated.plan, input.geometry, openings, generated.zones),
  };
}