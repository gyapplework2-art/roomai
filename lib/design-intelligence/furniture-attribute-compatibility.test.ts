import assert from "node:assert/strict";
import test from "node:test";

import { evaluateFurnitureAttributeCompatibility } from "./furniture-attribute-compatibility";
import { normalizeFurnitureAttributes, type FurnitureDesignAttributes } from "./furniture-attributes";

function furniture(overrides: Partial<FurnitureDesignAttributes> = {}): FurnitureDesignAttributes {
  return {
    ...normalizeFurnitureAttributes({ seatingCapacity: 3 }, {
      sourceAttributes: {
        Form: "Rounded",
        "Arm Style": "Rolled Arms",
        "Back Style": "Pillow Back",
        "Cushion Style": "Bench Seat",
        Upholstery: "Velvet",
        "Fabric Texture": "Boucle",
        Tufting: "Yes",
        "Base Style": "Sled Base",
        "Exposed Wood": "No",
        "Exposed Metal": "Yes",
        "Height Profile": "Low Profile",
        "Seat Depth": "22 in",
      },
    }),
    ...overrides,
  };
}

test("exact matches compare every detailed attribute without comparing seating capacity", () => {
  const evaluation = evaluateFurnitureAttributeCompatibility(furniture(), furniture({ seatingCapacity: 5 }));

  assert.equal(evaluation.overallCompatibility, "compatible");
  assert.equal(Object.keys(evaluation.attributes).length, 13);
  assert.ok(Object.values(evaluation.attributes).every((item) => item.compatibility === "compatible"));
  assert.equal("seatingCapacity" in evaluation.attributes, false);
});

test("explicitly equivalent forms and related known materials are compatible", () => {
  const evaluation = evaluateFurnitureAttributeCompatibility(
    furniture({ silhouette: "curved", upholsteryMaterial: "velvet", seatDepthCm: 55.88 }),
    furniture({ silhouette: "oval", upholsteryMaterial: "linen", seatDepthCm: 60.88 }),
  );

  assert.deepEqual(evaluation.attributes.silhouette, { compatibility: "compatible", reasons: ["silhouette_shared_form"] });
  assert.deepEqual(evaluation.attributes.upholsteryMaterial, { compatibility: "compatible", reasons: ["upholsteryMaterial_shared_material_family"] });
  assert.deepEqual(evaluation.attributes.seatDepthCm, { compatibility: "compatible", reasons: ["seatDepthCm_similar"] });
});

test("known visual differences and explicit boolean differences are mixed, not incompatible", () => {
  const evaluation = evaluateFurnitureAttributeCompatibility(furniture(), furniture({
    silhouette: "angular",
    armStyle: "track",
    backStyle: "high_back",
    cushionStyle: "loose",
    upholsteryType: "leather",
    upholsteryMaterial: "leather",
    fabricTexture: "chenille",
    tufting: false,
    legBaseStyle: "plinth",
    exposedWood: true,
    exposedMetal: false,
    heightProfile: "high",
    seatDepthCm: 70,
  }));

  assert.equal(evaluation.overallCompatibility, "mixed");
  assert.ok(Object.values(evaluation.attributes).every((item) => item.compatibility === "mixed"));
});

test("missing or unsupported evidence is unknown and does not downgrade a known match", () => {
  const empty = normalizeFurnitureAttributes({ seatingCapacity: null });
  assert.equal(evaluateFurnitureAttributeCompatibility(empty, empty).overallCompatibility, "unknown");
  const evaluation = evaluateFurnitureAttributeCompatibility(
    { ...empty, tufting: false, silhouette: "unsupported", seatDepthCm: 0 },
    { ...empty, tufting: false, silhouette: "curved", seatDepthCm: 56 },
  );

  assert.equal(evaluation.attributes.tufting.compatibility, "compatible");
  assert.equal(evaluation.attributes.silhouette.compatibility, "unknown");
  assert.equal(evaluation.attributes.seatDepthCm.compatibility, "unknown");
  assert.equal(evaluation.overallCompatibility, "compatible");
});

test("seat depth is compared only from explicit positive centimeter evidence", () => {
  const original = furniture({ seatDepthCm: 55 });
  assert.equal(evaluateFurnitureAttributeCompatibility(original, furniture({ seatDepthCm: 55 })).attributes.seatDepthCm.reasons[0], "seatDepthCm_match");
  assert.equal(evaluateFurnitureAttributeCompatibility(original, furniture({ seatDepthCm: 60.01 })).attributes.seatDepthCm.compatibility, "mixed");
  assert.equal(evaluateFurnitureAttributeCompatibility(original, furniture({ seatDepthCm: Number.NaN })).attributes.seatDepthCm.compatibility, "unknown");
  assert.equal(evaluateFurnitureAttributeCompatibility(original, furniture({ seatDepthCm: null })).attributes.seatDepthCm.compatibility, "unknown");
});

test("evaluation is deterministic, symmetric, and does not mutate either input", () => {
  const first = furniture({ silhouette: "oval", tufting: false });
  const second = furniture({ silhouette: "rectangular", tufting: true });
  const firstCopy = structuredClone(first);
  const secondCopy = structuredClone(second);
  const evaluation = evaluateFurnitureAttributeCompatibility(first, second);

  assert.deepEqual(evaluation, evaluateFurnitureAttributeCompatibility(first, second));
  assert.deepEqual(evaluation, evaluateFurnitureAttributeCompatibility(second, first));
  assert.deepEqual(first, firstCopy);
  assert.deepEqual(second, secondCopy);
});