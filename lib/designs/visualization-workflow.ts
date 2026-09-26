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

  try {
    const image = await dependencies.generate(brief);
    await dependencies.upload(image);
    uploaded = true;
    await dependencies.markGenerated();
    return { ok: true };
  } catch (error) {
    const errorCode = dependencies.errorCode(error);
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
