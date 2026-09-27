import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import test from "node:test";

import { normalizeFurnitureAttributes } from "@/lib/design-intelligence/furniture-attributes";

const registerHooks = (nodeModule as unknown as { registerHooks: (hooks: object) => void }).registerHooks;
registerHooks({
  resolve(specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) {
    if (specifier === "server-only") return { url: "node:module", shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const getFurnitureAttributesByVariantIds = async (
  ...args: Parameters<typeof import("./furniture-attributes").getFurnitureAttributesByVariantIds>
) => (await import("./furniture-attributes")).getFurnitureAttributesByVariantIds(...args);

type AuditedVariant = {
  id: string;
  furniture_type_id: string | null;
  source_category: string;
  overall_depth_cm?: number;
  variant_attributes: {
    normalized_attributes?: Record<string, unknown>;
    attribute_evidence: { color: unknown[]; material: unknown[]; style: unknown[] };
    ikea_labeled_attributes?: Record<string, string>;
  };
};

function articleVariant(
  id: string,
  furnitureType: string,
  normalized: Record<string, unknown>,
  overallDepthCm?: number,
): AuditedVariant {
  return {
    id,
    furniture_type_id: furnitureType,
    source_category: furnitureType,
    overall_depth_cm: overallDepthCm,
    variant_attributes: {
      normalized_attributes: normalized,
      attribute_evidence: { color: [], material: [], style: [] },
    },
  };
}

// Representative rows preserve the audited 13/12 shape and observed key set,
// not a snapshot of private database IDs or unreported source values.
const auditedVariants: AuditedVariant[] = [
  articleVariant("article-sofa-1", "sofa", { seat_depth: 57.15, seat_height: 45.72 }, 95),
  articleVariant("article-sofa-2", "sofa", { seat_depth: 60 }, 92),
  articleVariant("article-sectional", "sectional_sofa", { seat_depth: 61, seat_height: 43 }, 110),
  articleVariant("article-sofa-3", "sofa", { seat_height: 44 }, 90),
  articleVariant("article-rug-1", "area_rug", { construction: "flatwoven" }),
  articleVariant("article-rug-2", "area_rug", { pile_height: 2.54, pile_type: "medium" }),
  articleVariant("article-rug-3", "area_rug", { construction: "handwoven", pile_height: 3.81 }),
  articleVariant("article-rug-4", "area_rug", { pile_type: "shag" }),
  articleVariant("article-chair-1", "office_chair", { seat_depth: 45 }, 65),
  articleVariant("article-chair-2", "office_chair", { seat_height: 48 }, 60),
  articleVariant("article-chair-3", "office_chair", { seat_depth: 47, seat_height: 44 }, 63),
  articleVariant("article-chair-4", "office_chair", { seat_height: 42 }, 59),
  {
    id: "ikea-jattebo",
    furniture_type_id: null,
    source_category: "Sofas & sectionals",
    overall_depth_cm: 105,
    variant_attributes: {
      attribute_evidence: { color: ["green"], material: ["fabric"], style: ["modern"] },
      ikea_labeled_attributes: { "Seat Depth": "22 in", Upholstery: "Velvet" },
    },
  },
];

test("audited fixture shape preserves 13 variants, 12 normalized bags, and only observed keys", () => {
  assert.equal(auditedVariants.length, 13);
  assert.equal(auditedVariants.filter((row) => row.variant_attributes.normalized_attributes !== undefined).length, 12);
  assert.equal(auditedVariants.filter((row) => row.variant_attributes.ikea_labeled_attributes !== undefined).length, 1);
  assert.ok(auditedVariants.every((row) => Object.keys(row.variant_attributes.attribute_evidence).join(",") === "color,material,style"));
  const keys = new Set(auditedVariants.flatMap((row) => Object.keys(row.variant_attributes.normalized_attributes ?? {})));
  assert.deepEqual([...keys].sort(), ["construction", "pile_height", "pile_type", "seat_depth", "seat_height"]);
});

test("explicit seat depth stays in centimeters and never borrows overall depth", () => {
  const sofa = auditedVariants[0];
  const chairWithOnlySeatHeight = auditedVariants[9];
  const sofaAttributes = normalizeFurnitureAttributes({ seatingCapacity: null }, {
    normalizedAttributes: sofa.variant_attributes.normalized_attributes,
  });
  const chairAttributes = normalizeFurnitureAttributes({ seatingCapacity: null }, {
    normalizedAttributes: chairWithOnlySeatHeight.variant_attributes.normalized_attributes,
  });

  assert.equal(sofaAttributes.seatDepthCm, 57.15);
  assert.notEqual(sofaAttributes.seatDepthCm, sofa.overall_depth_cm);
  assert.equal(chairAttributes.seatDepthCm, null);
  assert.equal(chairWithOnlySeatHeight.variant_attributes.normalized_attributes?.seat_height, 48);
  assert.equal("seatHeightCm" in chairAttributes, false);
});

test("explicit seat height and rug construction, pile type, and pile height stay distinct in source evidence", () => {
  const rug = auditedVariants[5];
  const rugWithConstruction = auditedVariants[6];
  const pile = rug.variant_attributes.normalized_attributes;
  const construction = rugWithConstruction.variant_attributes.normalized_attributes;
  const result = normalizeFurnitureAttributes({ seatingCapacity: null }, { normalizedAttributes: pile });

  assert.equal(pile?.pile_height, 2.54);
  assert.equal(pile?.pile_type, "medium");
  assert.equal(construction?.construction, "handwoven");
  assert.equal(construction?.pile_height, 3.81);
  assert.equal(result.seatDepthCm, null);
  assert.equal(result.fabricTexture, null);
  assert.equal(result.silhouette, null);
  assert.equal("pileHeightCm" in result, false);
});

test("E.7.5 retrieves only normalized detail and leaves untyped IKEA JÄTTEBO unresolved", async () => {
  const snapshot = structuredClone(auditedVariants);
  const requestedIds = auditedVariants.map((row) => row.id);
  const queried: string[][] = [];
  const result = await getFurnitureAttributesByVariantIds(requestedIds, undefined, async (ids) => {
    queried.push([...ids]);
    return auditedVariants;
  });
  const ikea = auditedVariants[12];
  const ikeaAttributes = result.get(ikea.id);

  assert.deepEqual(queried, [requestedIds]);
  assert.equal(result.size, 13);
  assert.equal(result.get("article-sofa-1")?.seatDepthCm, 57.15);
  assert.equal(result.get("article-chair-1")?.seatDepthCm, 45);
  assert.equal(result.get("article-chair-2")?.seatDepthCm, null);
  assert.equal(ikea.furniture_type_id, null);
  assert.equal(ikea.source_category, "Sofas & sectionals");
  assert.ok(ikeaAttributes);
  assert.ok(Object.values(ikeaAttributes).every((value) => value === null));
  assert.equal("furnitureTypeCode" in ikeaAttributes, false);
  assert.deepEqual(auditedVariants, snapshot);
});