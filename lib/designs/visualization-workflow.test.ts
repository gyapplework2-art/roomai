import assert from "node:assert/strict";
import test from "node:test";

import type { VisualizationBrief } from "@/lib/designs/visualization-brief";
import { runVisualizationWorkflow, visualizationErrorMessage } from "@/lib/designs/visualization-workflow";

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

test("storage failures are persistence failures, not misreported provider errors", async () => {
  for (const stage of ["upload", "complete"]) {
    const result = await runVisualizationWorkflow(brief, {
      generate: async () => Buffer.from("image"),
      upload: async () => { if (stage === "upload") throw new Error("private storage details"); },
      markGenerated: async () => { if (stage === "complete") throw new Error("private database details"); },
      removeUpload: async () => undefined, markFailed: async () => undefined,
      errorCode: () => "generation_failed",
    });
    assert.deepEqual(result, { ok: false, errorCode: "persistence_failed" });
  }
});

test("configuration and provider codes survive failed-attempt handling and cleanup errors", async () => {
  for (const code of ["not_configured", "provider_access_denied", "provider_rate_limited", "invalid_response"]) {
    const result = await runVisualizationWorkflow(brief, {
      generate: async () => { throw new Error("private provider payload"); },
      upload: async () => assert.fail("No upload after provider failure"),
      markGenerated: async () => assert.fail("No completion after provider failure"),
      removeUpload: async () => assert.fail("No removal before upload"),
      markFailed: async () => { throw new Error("failure recording unavailable"); }, errorCode: () => code,
    });
    assert.deepEqual(result, { ok: false, errorCode: code });
    assert.ok(visualizationErrorMessage(code).length > 30);
  }
  assert.equal(visualizationErrorMessage("secret-token"), visualizationErrorMessage("constructor"));
  assert.equal(visualizationErrorMessage("secret-token").includes("secret-token"), false);
});

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
