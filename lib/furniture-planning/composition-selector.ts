import { getGeometryBounds } from "@/lib/geometry/dimensions";
import type { RoomGeometry } from "@/lib/geometry/types";
import { validateRoomGeometryStructure } from "@/lib/geometry/validation";
import { livingRoomCompositions, type CompositionTemplate, type CompositionTemplateId, type CompositionType } from "./compositions";

export type CompositionSelectionInput = {
  geometry?: RoomGeometry;
  mustHaveItems?: readonly string[];
  roomFunctions?: readonly string[];
};

export type RequirementDiagnostics = {
  recognized: Array<{
    category: CompositionType;
    requested: number;
    satisfied: number;
    unmet: number;
  }>;
  unrecognized: string[];
};

export type CompositionSelectionResult = CompositionTemplate & {
  requirementDiagnostics: RequirementDiagnostics;
};

export const compositionSelectionPolicy = {
  largeMinimumAreaCm2: 240000,
  largeMinimumShortSideCm: 400,
  largeMinimumLongSideCm: 600,
  smallMaximumAreaCm2: 180000,
  smallMaximumShortSideCm: 350,
  explicitRequirements: "Maximize represented required seating counts before room-scale preferences; duplicates represent multiplicity.",
  sparse: "T2 when geometry is absent or invalid.",
  small: "T2 when area < 180000 cm2 or short bounding side < 350 cm.",
  medium: "T1 for entertaining, otherwise T2.",
  large: "T6 for entertaining, T1 for reading, otherwise T3 when all large thresholds are met.",
  ties: "Preferred template first, then T2, T1, T3, T4, T5, T6. Selection does not certify fit.",
} as const;

function requestedFurnitureType(value: string): CompositionType | null {
  switch (value.trim().toLowerCase().replace(/[\s-]+/g, "_")) {
    case "sofa": return "sofa";
    case "sectional": case "sectional_sofa": return "sectional";
    case "loveseat": return "loveseat";
    case "modular_seating": case "modular_sofa": return "modular_seating";
    case "chair": case "armchair": case "accent_chair": return "armchair";
    case "coffee_table": return "coffee_table";
    case "rug": case "area_rug": return "rug";
    default: return null;
  }
}

function preferredTemplate(input: CompositionSelectionInput): CompositionTemplateId {
  const geometry = input.geometry;
  if (!geometry || !validateRoomGeometryStructure(geometry).valid) return "T2";
  const bounds = getGeometryBounds(geometry);
  const shortSide = Math.min(bounds.widthCm, bounds.lengthCm);
  const longSide = Math.max(bounds.widthCm, bounds.lengthCm);
  let twiceArea = 0;
  geometry.vertices.forEach((vertex, index) => {
    const next = geometry.vertices[(index + 1) % geometry.vertices.length];
    twiceArea += vertex.xCm * next.yCm - next.xCm * vertex.yCm;
  });
  const area = Math.abs(twiceArea) / 2;
  const policy = compositionSelectionPolicy;
  if (area < policy.smallMaximumAreaCm2 || shortSide < policy.smallMaximumShortSideCm) return "T2";
  const functions = new Set(input.roomFunctions ?? []);
  if (area >= policy.largeMinimumAreaCm2 && shortSide >= policy.largeMinimumShortSideCm && longSide >= policy.largeMinimumLongSideCm) {
    return functions.has("entertaining") ? "T6" : functions.has("reading") ? "T1" : "T3";
  }
  return functions.has("entertaining") ? "T1" : "T2";
}

export function selectLivingRoomComposition(input: CompositionSelectionInput = {}): CompositionSelectionResult {
  const required = new Map<CompositionType, number>();
  const unrecognized: string[] = [];
  for (const value of input.mustHaveItems ?? []) {
    const category = requestedFurnitureType(value);
    if (category) required.set(category, (required.get(category) ?? 0) + 1);
    else unrecognized.push(value);
  }
  const preferred = preferredTemplate(input);
  const order: CompositionTemplateId[] = [preferred, "T2", "T1", "T3", "T4", "T5", "T6"];
  const score = (composition: CompositionTemplate) => {
    let matches = 0;
    for (const [category, count] of required) {
      const available = composition.roles.filter((role) => role.category === category).reduce((total, role) => total + role.count, 0);
      matches += Math.min(count, available);
    }
    return matches;
  };
  const selected = [...livingRoomCompositions].sort((first, second) => score(second) - score(first) || order.indexOf(first.id) - order.indexOf(second.id))[0];
  const recognized = [...required].sort(([first], [second]) => first < second ? -1 : first > second ? 1 : 0)
    .map(([category, requested]) => {
      const available = selected.roles.filter((role) => role.category === category).reduce((total, role) => total + role.count, 0);
      const satisfied = Math.min(requested, available);
      return { category, requested, satisfied, unmet: requested - satisfied };
    });
  return { ...selected, requirementDiagnostics: { recognized, unrecognized: [...unrecognized].sort() } };
}