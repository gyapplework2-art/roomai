import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogCandidate } from "@/lib/catalog/schema";
import {
  DESIGN_MATERIAL_FAMILIES,
  evaluateCandidateMaterialHarmony,
  normalizeDesignMaterial,
} from "@/lib/design-intelligence/material-harmony";

function intent(
  preferredMaterials: string[] = [],
  avoidMaterials: string[] = [],
) {
  return {
    preferredMaterials,
    avoidMaterials,
  };
}

function candidate(
  normalizedMaterial: string | null,
): Pick<CatalogCandidate, "normalizedMaterial"> {
  return { normalizedMaterial };
}

test("defines explicit material families", () => {
  assert.deepEqual(DESIGN_MATERIAL_FAMILIES, [
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
  ]);
});

test("normalizes controlled catalog materials into design families", () => {
  assert.deepEqual(normalizeDesignMaterial("linen"), {
    value: "linen",
    family: "textile",
  });
  assert.deepEqual(normalizeDesignMaterial("walnut"), {
    value: "walnut",
    family: "wood",
  });
  assert.deepEqual(normalizeDesignMaterial("stainless_steel"), {
    value: "stainless_steel",
    family: "metal",
  });
  assert.deepEqual(normalizeDesignMaterial("marble"), {
    value: "marble",
    family: "stone",
  });
});

test("normalizes supported design-language material aliases", () => {
  assert.deepEqual(normalizeDesignMaterial("Solid Walnut"), {
    value: "walnut",
    family: "wood",
  });
  assert.deepEqual(normalizeDesignMaterial("Full-grain leather"), {
    value: "leather",
    family: "leather",
  });
  assert.deepEqual(normalizeDesignMaterial("Performance Velvet"), {
    value: "velvet",
    family: "textile",
  });
});

test("recognizes canonical ash and beech as wood species", () => {
  for (const value of ["ash", "beech"]) {
    assert.deepEqual(normalizeDesignMaterial(value), { value, family: "wood" });
  }
});

test("exact preferred material match is compatible", () => {
  const result = evaluateCandidateMaterialHarmony(
    intent(["linen"]),
    candidate("linen"),
  );

  assert.equal(result.compatibility, "compatible");
  assert.deepEqual(result.reasons, [
    "candidate_matches_preferred_material",
  ]);
});

test("same preferred material family is compatible", () => {
  const result = evaluateCandidateMaterialHarmony(
    intent(["fabric"]),
    candidate("linen"),
  );

  assert.equal(result.compatibility, "compatible");
  assert.deepEqual(result.reasons, [
    "candidate_matches_preferred_material_family",
  ]);
});

test("wood preference accepts a specific wood material", () => {
  const result = evaluateCandidateMaterialHarmony(
    intent(["wood"]),
    candidate("walnut"),
  );

  assert.equal(result.compatibility, "compatible");
  assert.deepEqual(result.reasons, [
    "candidate_matches_preferred_material_family",
  ]);
});

test("exact avoided material match is incompatible", () => {
  const result = evaluateCandidateMaterialHarmony(
    intent([], ["leather"]),
    candidate("leather"),
  );

  assert.equal(result.compatibility, "incompatible");
  assert.deepEqual(result.reasons, [
    "candidate_matches_avoided_material",
  ]);
});

test("avoided material family is incompatible", () => {
  const result = evaluateCandidateMaterialHarmony(
    intent([], ["fabric"]),
    candidate("velvet"),
  );

  assert.equal(result.compatibility, "incompatible");
  assert.deepEqual(result.reasons, [
    "candidate_matches_avoided_material_family",
  ]);
});

test("avoid material takes precedence over preferred material", () => {
  const result = evaluateCandidateMaterialHarmony(
    intent(["linen"], ["fabric"]),
    candidate("linen"),
  );

  assert.equal(result.compatibility, "incompatible");
  assert.deepEqual(result.reasons, [
    "candidate_matches_avoided_material_family",
  ]);
});

test("valid material outside preferences remains mixed", () => {
  const result = evaluateCandidateMaterialHarmony(
    intent(["linen"]),
    candidate("leather"),
  );

  assert.equal(result.compatibility, "mixed");
  assert.deepEqual(result.reasons, [
    "candidate_material_valid_but_not_preferred",
  ]);
});

test("avoid-only intent allows non-avoided material without claiming preference", () => {
  const result = evaluateCandidateMaterialHarmony(
    intent([], ["leather"]),
    candidate("linen"),
  );

  assert.equal(result.compatibility, "mixed");
  assert.deepEqual(result.reasons, [
    "candidate_material_valid_but_not_preferred",
  ]);
});

test("missing candidate material produces unknown compatibility", () => {
  const result = evaluateCandidateMaterialHarmony(
    intent(["linen"]),
    candidate(null),
  );

  assert.equal(result.compatibility, "unknown");
  assert.deepEqual(result.reasons, ["candidate_material_missing"]);
});

test("unsupported candidate material produces unknown compatibility", () => {
  const result = evaluateCandidateMaterialHarmony(
    intent(["linen"]),
    candidate("mystery textile"),
  );

  assert.equal(result.compatibility, "unknown");
  assert.deepEqual(result.reasons, ["candidate_material_unknown"]);
});

test("missing usable design material intent produces unknown compatibility", () => {
  const result = evaluateCandidateMaterialHarmony(
    intent(),
    candidate("linen"),
  );

  assert.equal(result.compatibility, "unknown");
  assert.deepEqual(result.reasons, ["design_material_intent_missing"]);
});

test("composite material descriptions remain unknown instead of being guessed", () => {
  assert.equal(
    normalizeDesignMaterial("70% wool, 30% viscose"),
    null,
  );
  assert.equal(
    normalizeDesignMaterial("oak and steel"),
    null,
  );
});
