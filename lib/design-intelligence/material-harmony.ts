import type { CatalogCandidate } from "@/lib/catalog/schema";
import type {
  DesignCompatibility,
  DesignIntent,
} from "@/lib/design-intelligence/schema";

export const DESIGN_MATERIAL_FAMILIES = [
  "textile",
  "leather",
  "wood",
  "engineered_wood",
  "natural_woven",
  "metal",
  "glass",
  "stone",
  "ceramic",
  "concrete",
] as const;

export type DesignMaterialFamily =
  (typeof DESIGN_MATERIAL_FAMILIES)[number];

export type NormalizedDesignMaterial = {
  value: string;
  family: DesignMaterialFamily;
};

export type MaterialHarmonyResult = {
  compatibility: DesignCompatibility;
  reasons: string[];
};

const MATERIAL_FAMILY_BY_VALUE: Record<string, DesignMaterialFamily> = {
  fabric: "textile",
  polyester: "textile",
  linen: "textile",
  cotton: "textile",
  wool: "textile",
  velvet: "textile",
  boucle: "textile",
  chenille: "textile",
  microfiber: "textile",

  leather: "leather",
  faux_leather: "leather",
  vegan_leather: "leather",

  wood: "wood",
  oak: "wood",
  walnut: "wood",
  acacia: "wood",
  teak: "wood",

  mdf: "engineered_wood",
  particleboard: "engineered_wood",
  plywood: "engineered_wood",

  rattan: "natural_woven",
  wicker: "natural_woven",
  bamboo: "natural_woven",

  metal: "metal",
  steel: "metal",
  brass: "metal",
  iron: "metal",
  stainless_steel: "metal",
  aluminum: "metal",

  glass: "glass",

  marble: "stone",
  stone: "stone",

  ceramic: "ceramic",
  concrete: "concrete",
};

const MATERIAL_ALIASES: Record<string, string> = {
  "solid wood": "wood",
  "solid oak": "oak",
  "solid walnut": "walnut",
  "solid acacia": "acacia",
  "solid teak": "teak",
  "full aniline leather": "leather",
  "full grain leather": "leather",
  "polyester fabric": "polyester",
  "performance basketweave": "fabric",
  "woven fabric": "fabric",
  "performance velvet": "velvet",
  "particle board": "particleboard",
  "stainless steel": "stainless_steel",
  "faux leather": "faux_leather",
  "vegan leather": "vegan_leather",
};

function normalizedWords(value: string): string {
  return value.trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
}

export function normalizeDesignMaterial(
  value: string | null | undefined,
): NormalizedDesignMaterial | null {
  if (!value?.trim()) return null;

  const words = normalizedWords(value);
  const canonical =
    MATERIAL_ALIASES[words] ??
    words.replace(/\s+/g, "_");

  const family = MATERIAL_FAMILY_BY_VALUE[canonical];
  if (!family) return null;

  return {
    value: canonical,
    family,
  };
}

function normalizedIntentMaterials(values: string[]) {
  return values
    .map(normalizeDesignMaterial)
    .filter((value): value is NormalizedDesignMaterial => value !== null);
}

function exactMatch(
  candidate: NormalizedDesignMaterial,
  targets: NormalizedDesignMaterial[],
): boolean {
  return targets.some((target) => target.value === candidate.value);
}

function familyMatch(
  candidate: NormalizedDesignMaterial,
  targets: NormalizedDesignMaterial[],
): boolean {
  return targets.some((target) => target.family === candidate.family);
}

export function evaluateCandidateMaterialHarmony(
  intent: Pick<DesignIntent, "preferredMaterials" | "avoidMaterials">,
  candidate: Pick<CatalogCandidate, "normalizedMaterial">,
): MaterialHarmonyResult {
  const candidateMaterial = normalizeDesignMaterial(
    candidate.normalizedMaterial,
  );

  if (!candidate.normalizedMaterial?.trim()) {
    return {
      compatibility: "unknown",
      reasons: ["candidate_material_missing"],
    };
  }

  if (!candidateMaterial) {
    return {
      compatibility: "unknown",
      reasons: ["candidate_material_unknown"],
    };
  }

  const preferred = normalizedIntentMaterials(intent.preferredMaterials);
  const avoided = normalizedIntentMaterials(intent.avoidMaterials);

  if (exactMatch(candidateMaterial, avoided)) {
    return {
      compatibility: "incompatible",
      reasons: ["candidate_matches_avoided_material"],
    };
  }

  if (familyMatch(candidateMaterial, avoided)) {
    return {
      compatibility: "incompatible",
      reasons: ["candidate_matches_avoided_material_family"],
    };
  }

  if (exactMatch(candidateMaterial, preferred)) {
    return {
      compatibility: "compatible",
      reasons: ["candidate_matches_preferred_material"],
    };
  }

  if (familyMatch(candidateMaterial, preferred)) {
    return {
      compatibility: "compatible",
      reasons: ["candidate_matches_preferred_material_family"],
    };
  }

  if (preferred.length === 0 && avoided.length === 0) {
    return {
      compatibility: "unknown",
      reasons: ["design_material_intent_missing"],
    };
  }

  return {
    compatibility: "mixed",
    reasons: ["candidate_material_valid_but_not_preferred"],
  };
}
