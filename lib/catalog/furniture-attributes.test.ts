import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import test from "node:test";

const registerHooks = (nodeModule as unknown as { registerHooks: (hooks: object) => void }).registerHooks;
registerHooks({
  resolve(specifier: string, context: unknown, nextResolve: (specifier: string, context: unknown) => unknown) {
    if (specifier === "server-only") {
      return { url: "node:module", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const getFurnitureAttributesByVariantIds = async (
  ...args: Parameters<typeof import("./furniture-attributes").getFurnitureAttributesByVariantIds>
) => (await import("./furniture-attributes")).getFurnitureAttributesByVariantIds(...args);

test("deduplicates IDs, ignores blanks, and skips the query for an empty request", async () => {
  const requested: string[][] = [];
  const query = async (ids: string[]) => {
    requested.push(ids);
    return [{ id: "variant-a", variant_attributes: { normalized_attributes: { seat_depth: 55 } } }];
  };
  const empty = await getFurnitureAttributesByVariantIds(["", "  "], undefined, query);
  const result = await getFurnitureAttributesByVariantIds(["variant-a", "", "variant-a", "   "], undefined, query);

  assert.equal(empty.size, 0);
  assert.deepEqual(requested, [["variant-a"]]);
  assert.equal(result.size, 1);
  assert.equal(result.get("variant-a")?.seatDepthCm, 55);
});

test("maps multiple variants by their own IDs through E.7.2", async () => {
  const rows = [
    { id: "variant-b", variant_attributes: { normalized_attributes: { upholstery: "velvet", seat_depth: 57.15, arm_type: "track" } } },
    { id: "variant-a", variant_attributes: { normalized_attributes: { upholstery: "leather", seat_depth: 61, tufting: true } } },
    { id: "not-requested", variant_attributes: { normalized_attributes: { seat_depth: 100 } } },
  ];
  const snapshot = structuredClone(rows);
  const seating = new Map([["variant-a", 3]]);
  const result = await getFurnitureAttributesByVariantIds(
    ["variant-a", "variant-b"], seating, async () => rows,
  );

  assert.deepEqual([...result.keys()], ["variant-a", "variant-b"]);
  assert.equal(result.get("variant-a")?.upholsteryType, "leather");
  assert.equal(result.get("variant-a")?.seatDepthCm, 61);
  assert.equal(result.get("variant-a")?.tufting, true);
  assert.equal(result.get("variant-a")?.seatingCapacity, 3);
  assert.equal(result.get("variant-b")?.upholsteryType, "fabric");
  assert.equal(result.get("variant-b")?.armStyle, "track");
  assert.equal(result.get("variant-b")?.seatDepthCm, 57.15);
  assert.equal(result.get("variant-b")?.seatingCapacity, null);
  assert.equal(result.has("not-requested"), false);
  assert.deepEqual(rows, snapshot);
  assert.deepEqual([...seating], [["variant-a", 3]]);
});

test("missing rows or normalized bags return unknown detail, preserving only explicit capacity", async () => {
  const result = await getFurnitureAttributesByVariantIds(
    ["missing", "no-bag", "invalid-bag"],
    new Map([["missing", 2]]),
    async () => [
      { id: "no-bag", variant_attributes: {} },
      { id: "invalid-bag", variant_attributes: { normalized_attributes: ["seat_depth", 52] } },
    ],
  );

  assert.equal(result.get("missing")?.seatingCapacity, 2);
  for (const [variantId, attributes] of result) {
    assert.equal(attributes.seatDepthCm, null, variantId);
    assert.equal(attributes.upholsteryMaterial, null, variantId);
    assert.equal(attributes.armStyle, null, variantId);
  }
  assert.equal(result.get("no-bag")?.seatingCapacity, null);
  assert.equal(result.get("invalid-bag")?.seatingCapacity, null);
});

test("ignores raw source attributes and unrelated product or commercial fields", async () => {
  const row = {
    id: "variant-a",
    variant_attributes: {
      article_attributes: { "Seat Depth": "22 in", Upholstery: "Velvet", Tufting: "Yes" },
      normalized_attributes: { seat_depth: 52 },
    },
    source_description: "tufted sofa with velvet fabric",
    product_url: "https://vendor.example/product",
    vendor_name: "Internal vendor",
    depth_cm: 95,
    price: 999,
    availability: "in_stock",
  };
  const snapshot = structuredClone(row);
  const result = await getFurnitureAttributesByVariantIds(["variant-a"], undefined, async () => [row]);
  const attributes = result.get("variant-a");

  assert.equal(attributes?.seatDepthCm, 52);
  assert.equal(attributes?.upholsteryType, null);
  assert.equal(attributes?.tufting, null);
  assert.equal(attributes?.seatingCapacity, null);
  assert.deepEqual(row, snapshot);
});

test("sanitizes database failures as CatalogQueryError", async () => {
  await assert.rejects(
    getFurnitureAttributesByVariantIds(["variant-a"], undefined, async () => {
      throw new Error("Sensitive database connection detail");
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, "CatalogQueryError");
      assert.equal(error.message.includes("Sensitive"), false);
      return true;
    },
  );
});