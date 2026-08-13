import { describe, expect, it, vi } from "vitest";

vi.mock("../model/browserGraph", () => ({
  extractKnowledgeMap: vi.fn(async (text: string) => ({
    tokens: text.split(/\s+/),
    entities: [],
    relations: [],
    concepts: [],
    graphRelations: [],
    analysis: {
      mode: "document",
      coverage: "document",
      notice: "Ran in this browser.",
    },
  })),
}));

import { extractText } from "./client";

describe("on-device extraction client", () => {
  it("has no HTTP request boundary", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(extractText("A local passage.")).resolves.toMatchObject({
      analysis: { notice: "Ran in this browser." },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
