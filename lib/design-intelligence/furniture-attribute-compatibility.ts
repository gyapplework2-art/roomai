import type { FurnitureDesignAttributes } from "@/lib/design-intelligence/furniture-attributes";
import { normalizeDesignMaterial } from "@/lib/design-intelligence/material-harmony";
import type { DesignCompatibility } from "@/lib/design-intelligence/schema";

type DetailedAttribute = Exclude<keyof FurnitureDesignAttributes, "seatingCapacity">;

export type FurnitureAttributeComparison = {
  compatibility: DesignCompatibility;
  reasons: string[];
};

export type FurnitureAttributeCompatibility = {
  attributes: Record<DetailedAttribute, FurnitureAttributeComparison>;
  overallCompatibility: DesignCompatibility;
};

const KNOWN_VALUES: Record<Exclude<DetailedAttribute, "seatDepthCm" | "tufting" | "exposedWood" | "exposedMetal" | "upholsteryMaterial">, readonly string[]> = {
  silhouette: ["curved", "straight", "angular", "rectangular", "round", "oval"],
  armStyle: ["armless", "track", "rolled", "sloped", "flared"],
  backStyle: ["high_back", "low_back", "tight_back", "pillow_back", "tufted_back", "open_back", "wing_back"],
  cushionStyle: ["loose", "fixed", "bench", "t_cushion"],
  upholsteryType: ["fabric", "leather"],
  fabricTexture: ["boucle", "chenille", "velvet", "linen", "microfiber", "basketweave"],
  legBaseStyle: ["tapered", "hairpin", "sled", "pedestal", "plinth", "block", "turned"],
  heightProfile: ["low", "standard", "high"],
};

function result(attribute: DetailedAttribute, compatibility: DesignCompatibility, reason: string): FurnitureAttributeComparison {
  return { compatibility, reasons: [`${attribute}_${reason}`] };
}

function compareKnownText(
  attribute: keyof typeof KNOWN_VALUES,
  first: string | null,
  second: string | null,
): FurnitureAttributeComparison {
  const known = KNOWN_VALUES[attribute];
  if (!first || !second || !known.includes(first) || !known.includes(second)) {
    return result(attribute, "unknown", "unknown");
  }
  if (first === second) return result(attribute, "compatible", "match");
  if (attribute === "silhouette" && (
    ["curved", "round", "oval"].includes(first) && ["curved", "round", "oval"].includes(second)
    || ["straight", "angular", "rectangular"].includes(first) && ["straight", "angular", "rectangular"].includes(second)
  )) return result(attribute, "compatible", "shared_form");
  return result(attribute, "mixed", "different");
}

function compareBoolean(
  attribute: "tufting" | "exposedWood" | "exposedMetal",
  first: boolean | null,
  second: boolean | null,
): FurnitureAttributeComparison {
  if (typeof first !== "boolean" || typeof second !== "boolean") return result(attribute, "unknown", "unknown");
  return result(attribute, first === second ? "compatible" : "mixed", first === second ? "match" : "different");
}

function compareMaterial(first: string | null, second: string | null): FurnitureAttributeComparison {
  const left = normalizeDesignMaterial(first);
  const right = normalizeDesignMaterial(second);
  if (!left || !right || !["leather", "textile"].includes(left.family) || !["leather", "textile"].includes(right.family)) {
    return result("upholsteryMaterial", "unknown", "unknown");
  }
  if (left.value === right.value) return result("upholsteryMaterial", "compatible", "match");
  if (left.family === right.family) return result("upholsteryMaterial", "compatible", "shared_material_family");
  return result("upholsteryMaterial", "mixed", "different");
}

function compareSeatDepth(first: number | null, second: number | null): FurnitureAttributeComparison {
  if (first === null || second === null || !Number.isFinite(first) || !Number.isFinite(second) || first <= 0 || second <= 0) {
    return result("seatDepthCm", "unknown", "unknown");
  }
  if (first === second) return result("seatDepthCm", "compatible", "match");
  // A measured difference of at most 5 cm remains comparable, without implying ergonomic fit.
  return Math.abs(first - second) <= 5
    ? result("seatDepthCm", "compatible", "similar")
    : result("seatDepthCm", "mixed", "different");
}

export function evaluateFurnitureAttributeCompatibility(
  first: FurnitureDesignAttributes,
  second: FurnitureDesignAttributes,
): FurnitureAttributeCompatibility {
  const attributes = {
    silhouette: compareKnownText("silhouette", first.silhouette, second.silhouette),
    armStyle: compareKnownText("armStyle", first.armStyle, second.armStyle),
    backStyle: compareKnownText("backStyle", first.backStyle, second.backStyle),
    cushionStyle: compareKnownText("cushionStyle", first.cushionStyle, second.cushionStyle),
    upholsteryType: compareKnownText("upholsteryType", first.upholsteryType, second.upholsteryType),
    upholsteryMaterial: compareMaterial(first.upholsteryMaterial, second.upholsteryMaterial),
    fabricTexture: compareKnownText("fabricTexture", first.fabricTexture, second.fabricTexture),
    tufting: compareBoolean("tufting", first.tufting, second.tufting),
    legBaseStyle: compareKnownText("legBaseStyle", first.legBaseStyle, second.legBaseStyle),
    exposedWood: compareBoolean("exposedWood", first.exposedWood, second.exposedWood),
    exposedMetal: compareBoolean("exposedMetal", first.exposedMetal, second.exposedMetal),
    heightProfile: compareKnownText("heightProfile", first.heightProfile, second.heightProfile),
    seatDepthCm: compareSeatDepth(first.seatDepthCm, second.seatDepthCm),
  } satisfies Record<DetailedAttribute, FurnitureAttributeComparison>;

  const evaluations = Object.values(attributes);
  const overallCompatibility: DesignCompatibility = evaluations.some((item) => item.compatibility === "mixed")
    ? "mixed"
    : evaluations.some((item) => item.compatibility === "compatible")
      ? "compatible"
      : "unknown";
  return { attributes, overallCompatibility };
}