import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("image service classifies failures safely without real provider calls or changing the model", async () => {
  const source = readFileSync("lib/designs/visualization.ts", "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  for (const scenario of ["unconfigured", 400, 401, 403, 429, 500, "bad_response", "bad_png", "valid"] as const) {
    let requests = 0;
    const logs: string[] = [];
    class APIError extends Error {
      constructor(readonly status: number) { super("private provider payload"); }
    }
    class FakeOpenAI {
      static APIError = APIError;
      images = { generate: async (input: { model: string }) => {
        requests++;
        assert.equal(input.model, "gpt-image-1-mini");
        if (typeof scenario === "number") throw new APIError(scenario);
        const image = scenario === "valid" ? Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64")
          : scenario === "bad_png" ? Buffer.from("not png").toString("base64") : "invalid!!";
        return { data: [{ b64_json: image }] };
      } };
    }
    const exports: { generateVisualizationImage?: (brief: object) => Promise<Buffer> } = {};
    runInNewContext(compiled.outputText, {
      exports, Buffer, process: { env: scenario === "unconfigured" ? {} : { OPENAI_API_KEY: "private-test-key" } },
      console: { error: (...args: unknown[]) => logs.push(JSON.stringify(args)) },
      require: (name: string) => {
        if (name === "server-only") return {};
        if (name === "openai") return { default: FakeOpenAI };
        if (name === "@/lib/designs/visualization-brief") return { visualizationPrompt: () => "local fixture" };
        assert.fail(`Unexpected dependency ${name}`);
      },
    });
    assert.ok(exports.generateVisualizationImage);
    if (scenario === "valid") {
      assert.equal((await exports.generateVisualizationImage({})).length, 8);
    } else {
      const expected = scenario === "unconfigured" ? "not_configured" : scenario === 400 ? "provider_invalid_request"
        : scenario === 401 ? "provider_authentication" : scenario === 403 ? "provider_access_denied"
          : scenario === 429 ? "provider_rate_limited" : scenario === 500 ? "provider_failure" : "invalid_response";
      await assert.rejects(exports.generateVisualizationImage({}), (error: unknown) => {
        assert.equal((error as { code: string }).code, expected);
        return true;
      });
    }
    assert.equal(requests, scenario === "unconfigured" ? 0 : 1);
    assert.equal(logs.join().includes("private provider payload"), false);
    assert.equal(logs.join().includes("private-test-key"), false);
  }
});