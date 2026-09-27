import type { CatalogCandidate } from "@/lib/catalog/schema";
import { normalizeDesignMaterial } from "@/lib/design-intelligence/material-harmony";

export type FurnitureDesignAttributes = {
  seatingCapacity: number | null;
  silhouette: string | null;
  armStyle: string | null;
  backStyle: string | null;
  cushionStyle: string | null;
  upholsteryType: "fabric" | "leather" | null;
  upholsteryMaterial: string | null;
  fabricTexture: string | null;
  tufting: boolean | null;
  legBaseStyle: string | null;
  exposedWood: boolean | null;
  exposedMetal: boolean | null;
  heightProfile: string | null;
  seatDepthCm: number | null;
};

export type FurnitureAttributeEvidence = {
  normalizedAttributes?: Readonly<Record<string, unknown>>;
  sourceAttributes?: Readonly<Record<string, unknown>>;
};

const VALUE_ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  silhouette: { curved: "curved", rounded: "curved", straight: "straight", angular: "angular", rectangular: "rectangular", round: "round", oval: "oval" },
  armStyle: { armless: "armless", "no arms": "armless", "track arm": "track", "track arms": "track", track: "track", "rolled arm": "rolled", "rolled arms": "rolled", rolled: "rolled", "slope arm": "sloped", "sloped arm": "sloped", sloped: "sloped", "flared arm": "flared", flared: "flared" },
  backStyle: { "high back": "high_back", "low back": "low_back", "tight back": "tight_back", "pillow back": "pillow_back", "tufted back": "tufted_back", "open back": "open_back", "wing back": "wing_back" },
  cushionStyle: { "loose cushions": "loose", "loose cushion": "loose", "fixed cushions": "fixed", "fixed cushion": "fixed", "bench cushion": "bench", "bench seat": "bench", "t cushion": "t_cushion" },
  fabricTexture: { boucle: "boucle", bouclé: "boucle", chenille: "chenille", velvet: "velvet", linen: "linen", microfiber: "microfiber", "basket weave": "basketweave", basketweave: "basketweave" },
  legBaseStyle: { "tapered legs": "tapered", "tapered leg": "tapered", "hairpin legs": "hairpin", "hairpin leg": "hairpin", "sled base": "sled", "pedestal base": "pedestal", "plinth base": "plinth", "block legs": "block", "turned legs": "turned" },
  heightProfile: { "low profile": "low", "high profile": "high", "standard profile": "standard" },
};

function words(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[_/-]+/g, " ").replace(/\s+/g, " ");
}

function explicitValue(evidence: FurnitureAttributeEvidence, ...keys: string[]): unknown {
  for (const collection of [evidence.normalizedAttributes, evidence.sourceAttributes]) {
    if (!collection) continue;
    for (const [key, value] of Object.entries(collection)) {
      if (keys.includes(words(key).replace(/:$/, ""))) return value;
    }
  }
  return null;
}

function controlled(value: unknown, attribute: keyof typeof VALUE_ALIASES): string | null {
  return typeof value === "string" ? VALUE_ALIASES[attribute]?.[words(value)] ?? null : null;
}

function explicitBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = words(value);
  if (["yes", "true"].includes(normalized)) return true;
  if (["no", "false"].includes(normalized)) return false;
  return null;
}

function seatDepth(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  const match = /^(\d+(?:\.\d+)?)\s*(cm|centimeters?|in|inches?)$/i.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return /^(in|inch|inches)$/i.test(match[2]) ? amount * 2.54 : amount;
}

export function normalizeFurnitureAttributes(
  candidate: Pick<CatalogCandidate, "seatingCapacity">,
  evidence: FurnitureAttributeEvidence = {},
): FurnitureDesignAttributes {
  const upholstery = explicitValue(evidence, "upholstery", "upholstery material");
  const material = typeof upholstery === "string" ? normalizeDesignMaterial(upholstery) : null;

  return {
    seatingCapacity: Number.isInteger(candidate.seatingCapacity) && candidate.seatingCapacity! > 0
      ? candidate.seatingCapacity : null,
    silhouette: controlled(explicitValue(evidence, "shape", "silhouette", "form"), "silhouette"),
    armStyle: controlled(explicitValue(evidence, "arm type", "arm style"), "armStyle"),
    backStyle: controlled(explicitValue(evidence, "back type", "back style"), "backStyle"),
    cushionStyle: controlled(explicitValue(evidence, "cushion style"), "cushionStyle"),
    upholsteryType: material?.family === "leather" ? "leather" : material?.family === "textile" ? "fabric" : null,
    upholsteryMaterial: material?.family === "leather" || material?.family === "textile" ? material.value : null,
    fabricTexture: controlled(explicitValue(evidence, "fabric texture"), "fabricTexture"),
    tufting: explicitBoolean(explicitValue(evidence, "tufting", "tufted")),
    legBaseStyle: controlled(explicitValue(evidence, "leg style", "base style"), "legBaseStyle"),
    exposedWood: explicitBoolean(explicitValue(evidence, "exposed wood")),
    exposedMetal: explicitBoolean(explicitValue(evidence, "exposed metal")),
    heightProfile: controlled(explicitValue(evidence, "height profile"), "heightProfile"),
    seatDepthCm: seatDepth(explicitValue(evidence, "seat depth")),
  };
}