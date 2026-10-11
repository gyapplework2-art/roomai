import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DesignFloorPlan } from "@/components/design-floor-plan";
import { detectFloorPlanWarnings, projectFloorPlanObjects } from "@/lib/designs/floor-plan";
import { createLShapeGeometry, createRectangleGeometry } from "@/lib/geometry/templates";
import { rotateGeometry90, mirrorGeometryHorizontal } from "@/lib/geometry/transforms";
import type { Tables } from "@/types/database.types";

const furniture: Tables<"design_objects"> = {
  id: "object-1", design_id: "design-1", object_type: "furniture", category: "coffee_table", name: "Coffee table",
  x_cm: 200, y_cm: 150, z_cm: 0, width_cm: 100, depth_cm: 60, height_cm: 40, rotation_degrees: 0,
  material: "wood", primary_color: "black", product_id: null,
  catalog_product_id: "private-product", catalog_product_variant_id: "private-variant",
  reasoning: null, created_at: "2026-10-06T00:00:00Z",
};

test("warnings detect saved collisions without flagging intentional rug layering or moving objects", () => {
  const geometry = createRectangleGeometry(500, 400, 250);
  const projection = projectFloorPlanObjects([
    furniture, { ...furniture, id: "other", name: "Chair" },
    { ...furniture, id: "rug", category: "area_rug", name: "Rug" },
    { ...furniture, id: "outside", name: "Outside", x_cm: -50 },
  ]);
  const before = structuredClone(projection);
  const warnings = detectFloorPlanWarnings(projection.objects, geometry, []);
  assert.deepEqual(warnings.filter((warning) => warning.code === "overlap"), [{ code: "overlap", labels: ["Coffee table", "Chair"] }]);
  assert.ok(warnings.some((warning) => warning.code === "outside_room" && warning.labels[0] === "Outside"));
  assert.deepEqual(projection, before);
});

test("irregular concave boundaries and physical door/window intersections are detected", () => {
  const geometry = createLShapeGeometry(500, 400, 250);
  const object = projectFloorPlanObjects([{ ...furniture, x_cm: 30, y_cm: 0 }]).objects[0];
  const opening = { openingType: "door" as const, wallSegmentId: geometry.wallSegments[0].id, offsetCm: 20, widthCm: 50, heightCm: 210, sillHeightCm: null, hingeSide: "left" as const, swingDirection: "inward" as const };
  assert.ok(detectFloorPlanWarnings([object], geometry, [opening]).some((warning) => warning.code === "opening_obstructed"));
  assert.ok(detectFloorPlanWarnings([object], geometry, [{ ...opening, openingType: "window", hingeSide: null, swingDirection: null }]).some((warning) => warning.code === "opening_obstructed"));
  const crossing = { ...object, footprint: [{ xCm: 0, yCm: 0 }, { xCm: 500, yCm: 0 }, { xCm: 500, yCm: 400 }, { xCm: 0, yCm: 400 }] as typeof object.footprint };
  assert.ok(detectFloorPlanWarnings([crossing], geometry, []).some((warning) => warning.code === "outside_room"));
});

test("valid furniture preserves real dimensions and treats coordinates as footprint centers", () => {
  const { objects, skipped } = projectFloorPlanObjects([furniture]);
  assert.deepEqual(skipped, []);
  assert.equal(objects[0].objectRef, "object-1");
  assert.equal(objects[0].widthCm, 100);
  assert.equal(objects[0].depthCm, 60);
  assert.deepEqual(objects[0].footprint, [
    { xCm: 150, yCm: 120 }, { xCm: 250, yCm: 120 },
    { xCm: 250, yCm: 180 }, { xCm: 150, yCm: 180 },
  ]);
});

test("rotation normalizes without moving the saved footprint center", () => {
  for (const rotation of [90, 450, -270]) {
    const { objects } = projectFloorPlanObjects([{ ...furniture, rotation_degrees: rotation }]);
    assert.equal(objects[0].rotationDegrees, 90);
    assert.deepEqual(objects[0].footprint, [
      { xCm: 230, yCm: 100 }, { xCm: 230, yCm: 200 },
      { xCm: 170, yCm: 200 }, { xCm: 170, yCm: 100 },
    ]);
  }
});

test("matched and unmatched furniture use the same projection without catalog identity leakage", () => {
  const unmatched = { ...furniture, id: "object-2", catalog_product_id: null, catalog_product_variant_id: null };
  const result = projectFloorPlanObjects([furniture, unmatched], new Map([["object-1", "Customer-safe coffee table"]]));
  assert.equal(result.objects.length, 2);
  assert.equal(result.objects[0].label, "Customer-safe coffee table");
  assert.equal(result.objects[1].label, "Coffee table");
  assert.deepEqual(result.objects[0].footprint, result.objects[1].footprint);
  const serialized = JSON.stringify(result);
  for (const privateValue of ["private-product", "private-variant", "catalog_product_id", "catalog_product_variant_id", "design_id"]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("missing and invalid legacy values are skipped separately rather than invented", () => {
  for (const invalid of [
    { ...furniture, x_cm: null }, { ...furniture, y_cm: null },
    { ...furniture, x_cm: NaN }, { ...furniture, y_cm: Infinity },
    { ...furniture, width_cm: null }, { ...furniture, depth_cm: null },
    { ...furniture, width_cm: 0 }, { ...furniture, depth_cm: -1 },
    { ...furniture, width_cm: Infinity }, { ...furniture, depth_cm: NaN },
    { ...furniture, rotation_degrees: NaN }, { ...furniture, rotation_degrees: Infinity },
  ]) {
    const result = projectFloorPlanObjects([furniture, { ...invalid, id: "invalid-object" }]);
    assert.equal(result.objects.length, 1);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].objectRef, "invalid-object");
  }
});

test("room shape or previously applied transforms never move projected objects", () => {
  const projection = projectFloorPlanObjects([furniture]);
  const rooms = [createLShapeGeometry(500, 400, 250), rotateGeometry90(createRectangleGeometry(500, 400, 250))];
  for (const room of rooms) {
    const transformed = mirrorGeometryHorizontal(room);
    assert.notDeepEqual(transformed.vertices, room.vertices);
    assert.deepEqual(projectFloorPlanObjects([furniture]), projection);
  }
});

test("overlapping and out-of-room placements are preserved and decorations are not given fake footprints", () => {
  const outside = { ...furniture, id: "outside", x_cm: -100, y_cm: -100 };
  const result = projectFloorPlanObjects([furniture, { ...furniture, id: "overlap" }, outside, { ...furniture, object_type: "decoration" }]);
  assert.equal(result.objects.length, 3);
  assert.deepEqual(result.objects[0].footprint, result.objects[1].footprint);
  assert.equal(result.objects[2].xCm, -100);
  assert.deepEqual(result.skipped, []);
});

test("read-only component renders mixed furniture and existing transformed room and opening coordinates", () => {
  const geometry = mirrorGeometryHorizontal(rotateGeometry90(createLShapeGeometry(500, 400, 250)));
  const before = structuredClone(geometry);
  const projection = projectFloorPlanObjects([
    furniture,
    { ...furniture, id: "unmatched-2", name: "Unmatched furniture", catalog_product_id: null, catalog_product_variant_id: null, rotation_degrees: 90 },
    { ...furniture, id: "invalid-3", name: "Missing dimensions", width_cm: null },
  ], new Map([[furniture.id, "Customer coffee table"]]));
  const html = renderToStaticMarkup(createElement(DesignFloorPlan, {
    geometry,
    openings: [{ id: "window-1", openingType: "window", wallSegmentId: geometry.wallSegments[0].id, offsetCm: 20, widthCm: 50, heightCm: 100, sillHeightCm: 80, hingeSide: null, swingDirection: null }],
    projection,
  }));
  assert.deepEqual(geometry, before);
  assert.ok(html.includes(`points="${geometry.vertices.map((point) => `${point.xCm},${point.yCm}`).join(" ")}"`));
  assert.ok(html.includes('points="150,120 250,120 250,180 150,180"'));
  assert.ok(html.includes('points="230,100 230,200 170,200 170,100"'));
  assert.ok(html.includes("Customer coffee table"));
  assert.ok(html.includes("Unmatched furniture"));
  assert.ok(html.includes("Missing or invalid placement data: Missing dimensions"));
  assert.equal(html.includes('role="button"'), false);
  for (const privateValue of ["private-product", "private-variant", "catalog_product_id", "catalog_product_variant_id"]) {
    assert.equal(html.includes(privateValue), false);
  }
});