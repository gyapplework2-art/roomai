import "server-only";

import OpenAI from "openai";

import { visualizationPrompt, type VisualizationBrief } from "@/lib/designs/visualization-brief";

export const VISUALIZATION_MODEL = "gpt-image-1-mini";
export const VISUALIZATION_PROMPT_VERSION = "roomai-visualization-v1";
export const VISUALIZATION_BUCKET = "design-visualizations";

export class VisualizationGenerationError extends Error {
  constructor(readonly code: "not_configured" | "provider_failure" | "invalid_response") {
    super(code);
    this.name = "VisualizationGenerationError";
  }
}

export async function generateVisualizationImage(brief: VisualizationBrief): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new VisualizationGenerationError("not_configured");

  let response;
  try {
    response = await new OpenAI({ apiKey }).images.generate({
      model: VISUALIZATION_MODEL,
      prompt: visualizationPrompt(brief),
      n: 1,
      output_format: "png",
      quality: "medium",
      size: "1536x1024",
    });
  } catch {
    throw new VisualizationGenerationError("provider_failure");
  }

  const encodedImage = response.data?.[0]?.b64_json;
  if (!encodedImage) throw new VisualizationGenerationError("invalid_response");

  try {
    const image = Buffer.from(encodedImage, "base64");
    if (image.length === 0) throw new Error("empty_image");
    return image;
  } catch {
    throw new VisualizationGenerationError("invalid_response");
  }
}

export function visualizationStoragePath(input: {
  userId: string;
  projectId: string;
  designId: string;
  visualizationId: string;
}) {
  return `${input.userId}/${input.projectId}/${input.designId}/${input.visualizationId}.png`;
}
