import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import * as integration from "@/lib/catalog/integration";
import type { CoffeeTableCandidatePool } from "@/lib/catalog/integration";
import type { CatalogCandidate, CatalogQuery } from "@/lib/catalog/schema";
import { normalizeFurniturePlanForMarket } from "@/lib/furniture-planning/normalize-plan";
import { constrainFurniturePlanToRoom } from "@/lib/furniture-planning/room-constraints";
import type { FurniturePlanV11 } from "@/lib/furniture-planning/types";
import { createRectangleGeometry } from "@/lib/geometry/templates";

const geometry = createRectangleGeometry(500, 400, 250);
const range = { widthMinCm: 80, widthMaxCm: 140, depthMinCm: 45, depthMaxCm: 80, heightMinCm: 35, heightMaxCm: 50 };
const plan: FurniturePlanV11 = {
  schemaVersion: "1.1", roomIntent: "Living room", notes: [],
  items: [{
    id: "table-1", category: "coffee_table", subtype: null, priority: "required", sizeRange: range,
    placement: { preferredZone: null, anchorWallId: null, approximatePosition: { xCm: 250, yCm: 200 }, preferredOrientationDegrees: 0 },
    styleHints: [], materialHints: [], colorHints: [], functionalRequirements: [], reasoning: "Coffee surface",
    semanticPlacement: { role: "COFFEE_TABLE", mode: "FLOATING", targetWallId: null, zoneId: null, alignment: null, relationships: [], fallbackModes: [] },
  }, {
    id: "sofa-1", category: "sofa", subtype: "3-seat", priority: "required",
    sizeRange: { widthMinCm: 180, widthMaxCm: 240, depthMinCm: 80, depthMaxCm: 110, heightMinCm: 70, heightMaxCm: 105 },
    placement: { preferredZone: null, anchorWallId: null, approximatePosition: { xCm: 250, yCm: 300 }, preferredOrientationDegrees: 0 },
    styleHints: [], materialHints: [], colorHints: [], functionalRequirements: [], reasoning: "Seating",
    semanticPlacement: { role: "PRIMARY_SEATING", mode: "FLOATING", targetWallId: null, zoneId: null, alignment: null, relationships: [], fallbackModes: [] },
  }],
};

const candidate: CatalogCandidate = {
  productId: "server-product", variantId: "server-variant", countryCode: "US",
  categoryCode: "living_room", categoryName: "Living Room", furnitureTypeCode: "coffee_table", furnitureTypeName: "Coffee Table",
  productTitle: "Coffee Table", roomaiDescription: null, normalizedColor: null, normalizedMaterial: null, normalizedStyle: null,
  configuration: null, seatingCapacity: null, widthCm: 110, depthCm: 65, heightCm: 40, weightKg: null,
  currency: "USD", roomaiSellingPrice: 700, normalizedAvailability: "in_stock", deliveryText: null,
  estimatedDeliveryDaysMin: null, estimatedDeliveryDaysMax: null, vendorDataCheckedAt: null, roomaiPriceCalculatedAt: null,
  vendorName: "Internal Vendor", productUrl: "https://example.com/product", primaryImageUrl: "https://example.com/image.jpg",
};

for (const scenario of ["eligible", "empty", "query_failure"] as const) {
  test(`design action uses semantic coffee-table queries and preserves unmatched generation: ${scenario}`, async () => {
    const calls: string[] = [];
    const queries: CatalogQuery[] = [];
    let grounding: { plan: FurniturePlanV11; candidatePools: CoffeeTableCandidatePool[] } | undefined;
    const fixtureRows: Record<string, object | null> = {
      projects: { id: "project-1", currency: "USD" }, room_preferences: null, room_geometries: {},
    };
    const client = {
      auth: { getClaims: async () => ({ data: { claims: { sub: "user-1" } }, error: null }) },
      from: (table: string) => {
        const response = { data: table === "room_openings" ? [] : fixtureRows[table], error: null };
        return {
          select() { return this; }, eq() { return this; }, order() { return this; },
          maybeSingle: async () => response,
          then: (resolve: (value: typeof response) => unknown) => Promise.resolve(response).then(resolve),
        };
      },
    };
    const dependencies: Record<string, unknown> = {
      "@/lib/catalog/integration": integration,
      "@/lib/catalog/query": { findCatalogProducts: async (query: CatalogQuery) => {
        calls.push("query"); queries.push(query);
        if (scenario === "query_failure") throw new Error("simulated read failure");
        return scenario === "empty" ? [] : [candidate];
      } },
      "@/lib/supabase/server": { createClient: async () => client },
      "@/lib/geometry/schema": { roomGeometrySchema: { safeParse: () => ({ success: true, data: geometry }) } },
      "@/lib/geometry/openings": { validateRoomOpenings: () => ({ valid: true }) },
      "@/lib/geometry/validation": { validateRoomGeometryStructure: () => ({ valid: true }) },
      "@/lib/furniture-planning/normalize-plan": { normalizeFurniturePlanForMarket },
      "@/lib/furniture-planning/room-constraints": { constrainFurniturePlanToRoom },
      "@/lib/furniture-planning/generation": {
        createFurniturePlanningBrief: () => ({}),
        generateFurniturePlan: async () => { calls.push("plan"); return plan; },
      },
      "@/lib/designs/generation": {
        createDesignBrief: () => ({ project: { currency: "USD" } }),
        generateDesignSpecification: async (_brief: unknown, legacyCandidates: unknown[], received: typeof grounding) => {
          calls.push("generate"); grounding = received;
          assert.deepEqual(Array.from(legacyCandidates), []);
          return { specification: { furniture: [] }, catalogSelectionsByObjectId: {} };
        },
      },
      "@/lib/designs/persistence": {
        DesignPersistenceError: class extends Error {},
        persistDesign: async () => { calls.push("persist"); return { designId: "design-1", version: 1 }; },
      },
    };
    const source = readFileSync(path.resolve("lib/designs/actions.ts"), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const exports: { generateDesign?: (projectId: string) => Promise<{ success: boolean }> } = {};
    runInNewContext(compiled.outputText, {
      exports, Date, console: { error: () => undefined },
      require: (name: string) => {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected I/O dependency: ${name}`);
        return dependencies[name];
      },
    });
    assert.ok(exports.generateDesign);
    const result = await exports.generateDesign("project-1");
    assert.equal(result.success, true);
    assert.deepEqual(calls, ["plan", "query", "generate", "persist"]);
    assert.equal(queries.length, 1);
    assert.equal(queries[0].furnitureTypeCode, "coffee_table");
    assert.equal(queries[0].countryCode, "US");
    assert.equal(queries[0].currency, "USD");
    assert.equal(queries[0].maxWidthCm, 140);
    assert.equal(queries[0].maxDepthCm, 80);
    assert.equal(queries[0].maxHeightCm, 50);
    assert.equal(grounding?.plan, plan);
    assert.equal(grounding?.candidatePools.length, 1);
    assert.equal(grounding?.candidatePools[0].planItemId, "table-1");
    assert.equal(grounding?.candidatePools[0].candidates.length, scenario === "eligible" ? 1 : 0);
  });
}