import assert from "node:assert/strict";
import test from "node:test";

import { normalizeFurnitureAttributes } from "./furniture-attributes";

test("bridges explicit E.7.1 seating attributes without interpreting cushion fill as style", () => {
  const result = normalizeFurnitureAttributes({ seatingCapacity: 3 }, {
    normalizedAttributes: {
      upholstery: "full grain leather",
      seat_depth: 57.15,
      arm_type: "track",
      back_type: "high back",
      cushion_fill: "foam_and_fiber",
    },
  });

  assert.equal(result.seatingCapacity, 3);
  assert.equal(result.upholsteryType, "leather");
  assert.equal(result.upholsteryMaterial, "leather");
  assert.equal(result.seatDepthCm, 57.15);
  assert.equal(result.armStyle, "track");
  assert.equal(result.backStyle, "high_back");
  assert.equal(result.cushionStyle, null);
});

test("normalizes supported explicit source labels deterministically", () => {
  const evidence = {
    sourceAttributes: {
      "Form": "Rounded",
      "Arm Style": "Rolled Arms",
      "Back Style": "Pillow Back",
      "Cushion Style": "Bench Seat",
      "Upholstery Material": "Performance Velvet",
      "Fabric Texture": "Bouclé",
      "Tufted": "Yes",
      "Base Style": "Sled Base",
      "Exposed Wood": "No",
      "Exposed Metal": "Yes",
      "Height Profile": "Low-Profile",
      "Seat Depth:": "22.5 in",
    },
  };
  const copy = structuredClone(evidence);
  const first = normalizeFurnitureAttributes({ seatingCapacity: 2 }, evidence);

  assert.deepEqual(first, normalizeFurnitureAttributes({ seatingCapacity: 2 }, evidence));
  assert.deepEqual(evidence, copy);
  assert.deepEqual(first, {
    seatingCapacity: 2,
    silhouette: "curved",
    armStyle: "rolled",
    backStyle: "pillow_back",
    cushionStyle: "bench",
    upholsteryType: "fabric",
    upholsteryMaterial: "velvet",
    fabricTexture: "boucle",
    tufting: true,
    legBaseStyle: "sled",
    exposedWood: false,
    exposedMetal: true,
    heightProfile: "low",
    seatDepthCm: 57.15,
  });
});

test("leaves absent or unsupported concepts unknown even when overall dimensions exist elsewhere", () => {
  const result = normalizeFurnitureAttributes({ seatingCapacity: null });
  assert.ok(Object.values(result).every((value) => value === null));

  const unsupported = normalizeFurnitureAttributes({ seatingCapacity: -1 }, {
    normalizedAttributes: { upholstery: "wood", seat_depth: 0 },
    sourceAttributes: {
      "Arm Style": "bespoke unknown",
      "Tufting": "maybe",
      "Height Profile": "very tall",
      "Seat Depth": "35 unverified units",
    },
  });
  assert.ok(Object.values(unsupported).every((value) => value === null));
});

test("never converts prose, generic material, or overall depth into detailed upholstery and seat facts", () => {
  const result = normalizeFurnitureAttributes({ seatingCapacity: 0 }, {
    sourceAttributes: {
      description: "tufted velvet sofa with wooden legs and a deep seat",
      material: "velvet",
      depth_cm: 95,
      cushion_fill: "foam",
    },
  });
  assert.ok(Object.values(result).every((value) => value === null));
});