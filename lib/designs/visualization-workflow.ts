import type { VisualizationBrief } from "@/lib/designs/visualization-brief";

export type VisualizationWorkflowDependencies = {
  generate: (brief: VisualizationBrief) => Promise<Buffer>;
  upload: (image: Buffer) => Promise<void>;
  markGenerated: () => Promise<void>;
  removeUpload: () => Promise<void>;
  markFailed: (errorCode: string) => Promise<void>;
  errorCode: (error: unknown) => string;
};

export async function runVisualizationWorkflow(
  brief: VisualizationBrief,
  dependencies: VisualizationWorkflowDependencies,
): Promise<{ ok: true } | { ok: false; errorCode: string }> {
  let uploaded = false;
  let stage: "generate" | "upload" | "complete" = "generate";

  try {
    const image = await dependencies.generate(brief);
    stage = "upload";
    await dependencies.upload(image);
    uploaded = true;
    stage = "complete";
    await dependencies.markGenerated();
    return { ok: true };
  } catch (error) {
    const errorCode = stage === "generate" ? dependencies.errorCode(error) : "persistence_failed";
    console.error("RoomAI visualization workflow failed", JSON.stringify({ stage, errorCode }));
    if (uploaded) {
      try {
        await dependencies.removeUpload();
      } catch {
        // The failed attempt remains non-generated even if orphan cleanup fails.
      }
    }
    try {
      await dependencies.markFailed(errorCode);
    } catch {
      // The original failure remains the actionable result.
    }
    return { ok: false, errorCode };
  }
}

export function visualizationErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    not_configured: "Image generation is not configured. Ask the administrator to configure the server OpenAI credentials.",
    provider_authentication: "The image provider rejected the server credentials. Ask the administrator to check provider access.",
    provider_access_denied: "The image provider denied this request. Ask the administrator to check model access and account permissions.",
    provider_rate_limited: "The image provider is rate-limiting requests or has an account limit. Try later or ask the administrator to check the account.",
    provider_invalid_request: "The image provider rejected the request. Ask the administrator to review the sanitized server diagnostics.",
    provider_failure: "The image provider could not complete the visualization. Try again later.",
    invalid_response: "The image provider returned an unusable image. Try again later.",
    persistence_failed: "The visualization could not be saved. Ask the administrator to check visualization storage and database permissions.",
    invalid_room_context: "The saved room geometry or openings are invalid. Review the room layout before generating an image.",
    invalid_design: "The saved design could not be validated for visualization.",
    unauthorized: "Sign in with the account that owns this design before generating a visualization.",
    design_not_found: "The saved design could not be found for this project.",
  };
  return Object.hasOwn(messages, code) ? messages[code] : "The visualization could not be generated. Try again later.";
}
