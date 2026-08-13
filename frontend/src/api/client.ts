import type { ExtractResponse } from "../types";

export type ModelProgressCallback = (progress: number) => void;

/**
 * Deliberately has no network boundary: the browser loads the bundled ONNX
 * assets and performs all inference locally.
 */
export async function extractText(
  text: string,
  onProgress?: ModelProgressCallback,
): Promise<ExtractResponse> {
  const { extractKnowledgeMap } = await import("../model/browserGraph");
  return extractKnowledgeMap(text, onProgress);
}
