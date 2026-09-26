import assert from "node:assert/strict";
import test from "node:test";

import type { VisualizationBrief } from "@/lib/designs/visualization-brief";
import { runVisualizationWorkflow } from "@/lib/designs/visualization-workflow";

const brief: VisualizationBrief = {
  instruction: "VISUALIZE THE EXISTING DESIGN. DO NOT REDESIGN THE ROOM.",
  project: { name: "Test room", roomType: "living_room" },
  design: {
    name: "Test design",
    summary: "Test summary",
    palette: { walls: "white", primary: "green", secondary: "oak", accent: "black", metal: "brass" },
    surfaces: { walls: "paint", floor: "wood", ceiling: "paint" },
    lighting: { ambient: "ceiling", task: "lamp", accent: "sconce" },
  },
  room: {
    shapeType: "rectangle",
    ceilingHeightCm: 250,
    polygon: [{ xCm: 0, yCm: 0 }, { xCm: 400, yCm: 0 }, { xCm: 400, yCm: 300 }],
    walls: [],
    openings: [],
  },
  furniture: [],
  decorations: [],
};

test("completes a visualization using mocked provider and storage boundaries", async () => {
  const calls: string[] = [];
  const result = await runVisualizationWorkflow(brief, {
    generate: async (receivedBrief) => {
      assert.equal(receivedBrief, brief);
      calls.push("generate");
      return Buffer.from("image");
    },
    upload: async (image) => {
      assert.equal(image.toString(), "image");
      calls.push("upload");
    },
    markGenerated: async () => { calls.push("generated"); },
    removeUpload: async () => { calls.push("remove"); },
    markFailed: async () => { calls.push("failed"); },
    errorCode: () => "unexpected",
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, ["generate", "upload", "generated"]);
});

test("records a provider failure without uploading or removing an asset", async () => {
  const calls: string[] = [];
  const result = await runVisualizationWorkflow(brief, {
    generate: async () => { throw new Error("provider"); },
    upload: async () => { calls.push("upload"); },
    markGenerated: async () => { calls.push("generated"); },
    removeUpload: async () => { calls.push("remove"); },
    markFailed: async (errorCode) => { calls.push(`failed:${errorCode}`); },
    errorCode: () => "provider_failure",
  });

  assert.deepEqual(result, { ok: false, errorCode: "provider_failure" });
  assert.deepEqual(calls, ["failed:provider_failure"]);
});

test("cleans only the new upload when completion fails and preserves prior history", async () => {
  const history = ["previous-success"];
  const calls: string[] = [];
  const result = await runVisualizationWorkflow(brief, {
    generate: async () => Buffer.from("image"),
    upload: async () => { calls.push("upload:new-attempt"); },
    markGenerated: async () => { throw new Error("database update failed"); },
    removeUpload: async () => { calls.push("remove:new-attempt"); },
    markFailed: async (errorCode) => { calls.push(`failed:new-attempt:${errorCode}`); },
    errorCode: () => "persistence_failed",
  });

  assert.deepEqual(result, { ok: false, errorCode: "persistence_failed" });
  assert.deepEqual(calls, [
    "upload:new-attempt",
    "remove:new-attempt",
    "failed:new-attempt:persistence_failed",
  ]);
  assert.deepEqual(history, ["previous-success"]);
});
