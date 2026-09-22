import { test } from "node:test";
import assert from "node:assert/strict";

import { createDesignObjectInserts } from "@/lib/designs/persistence";
import type { DesignSpecification } from "@/lib/designs/types";

const specification: DesignSpecification = {
  contractVersion: "1.0",
  designName: "Catalog Identity Test",
  summary: "A valid test design.",
  room: { widthCm: 300, lengthCm: 400, heightCm: 250, roomType: "living_room" },
  palette: { walls: "white", primary: "blue", secondary: "gray", accent: "black", metal: "brass" },
  surfaces: { walls: "paint", floor: "wood", ceiling: "paint" },
  lighting: { ambient: "ceiling", task: "lamp", accent: "sconce" },
  furniture: [
    {
      objectId: "furniture-1",
      category: "sofa",
      name: "Sofa",
      description: "A sofa.",
      material: "fabric",
      color: "blue",
      dimensions: { widthCm: 200, depthCm: 90, heightCm: 80 },
      position: { xCm: 10, yCm: 20, zCm: 0 },
      rotationDegrees: 0,
      required: true,
      estimatedPrice: 1000,
      reasoning: "Required seating.",
    },
  ],
  decorations: [
    {
      objectId: "decoration-1",
      category: "art",
      name: "Art",
      description: "Wall art.",
      material: null,
      color: "white",
      position: { xCm: 30, yCm: 40, zCm: 100 },
      estimatedPrice: 100,
      reasoning: "Adds interest.",
    },
  ],
  budget: { low: 0, high: 2000, currency: "USD" },
  advice: ["Keep clearances open."],
  warnings: [],
};

test("furniture design object inserts explicitly leave catalog identity null", () => {
  const [furniture] = createDesignObjectInserts("design-1", specification);

  assert.equal(furniture.object_type, "furniture");
  assert.equal(furniture.product_id, null);
  assert.equal(furniture.catalog_product_id, null);
  assert.equal(furniture.catalog_product_variant_id, null);
  assert.equal(furniture.name, "Sofa");
});

test("decoration design object inserts explicitly leave catalog identity null", () => {
  const [, decoration] = createDesignObjectInserts("design-1", specification);

  assert.equal(decoration.object_type, "decoration");
  assert.equal(decoration.product_id, null);
  assert.equal(decoration.catalog_product_id, null);
  assert.equal(decoration.catalog_product_variant_id, null);
  assert.equal(decoration.name, "Art");
});
