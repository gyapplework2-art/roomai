import "server-only";

import OpenAI from "openai";

import { visualizationPrompt, type VisualizationBrief } from "@/lib/designs/visualization-brief";

export const VISUALIZATION_MODEL = "gpt-image-1-mini";
export const VISUALIZATION_PROMPT_VERSION = "roomai-visualization-v1";
export const VISUALIZATION_BUCKET = "design-visualizations";

export class VisualizationGenerationError extends Error {
  constructor(readonly code: "not_configured" | "provider_failure" | "invalid_response" | "provider_authentication" | "provider_access_denied" | "provider_rate_limited" | "provider_invalid_request") {
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
  } catch (error) {
    const status = error instanceof OpenAI.APIError ? error.status : undefined;
    const code = status === 401 ? "provider_authentication"
      : status === 403 ? "provider_access_denied"
        : status === 429 ? "provider_rate_limited"
          : status === 400 ? "provider_invalid_request" : "provider_failure";
    console.error("RoomAI image provider failed", JSON.stringify({ model: VISUALIZATION_MODEL, status, code }));
    throw new VisualizationGenerationError(code);
  }

  const encodedImage = response.data?.[0]?.b64_json;
  if (!encodedImage) throw new VisualizationGenerationError("invalid_response");

  try {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encodedImage) || encodedImage.length % 4 !== 0) {
      throw new Error("invalid_base64");
    }
    const image = Buffer.from(encodedImage, "base64");
    if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error("invalid_png");
    }
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
