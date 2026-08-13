import { afterEach, describe, expect, it, vi } from "vitest";

import { extractText, getTiers, toClientResponse } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as typeof globalThis & { __TEXTMOSAIC_CONFIG__?: object })
    .__TEXTMOSAIC_CONFIG__;
});

describe("local model API client", () => {
  it("preserves a documented local knowledge-map response", () => {
    expect(
      toClientResponse({
        tokens: [],
        entities: [],
        relations: [],
        concepts: [
          {
            id: "concept-1",
            label: "Ada",
            kind: "person",
            explanation: "Ada is a person in the source.",
            evidence: [{ quote: "Ada" }],
            confidence: 0.82,
          },
        ],
        graph_relations: [],
        analysis: {
          mode: "document",
          coverage: "document",
          notice: "Built locally.",
        },
      }),
    ).toMatchObject({
      concepts: [{ label: "Ada", evidence: [{ quote: "Ada" }] }],
      analysis: { mode: "document", coverage: "document" },
    });
  });

  it("loads local relation-model tiers through the REST boundary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          tiers: [{ name: "balanced", description: "Default" }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getTiers()).resolves.toEqual([
      { name: "balanced", description: "Default" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:7860/tiers",
      expect.objectContaining({
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("uses runtime configuration and sends the requested local analysis mode", async () => {
    (
      globalThis as typeof globalThis & {
        __TEXTMOSAIC_CONFIG__?: { apiBaseUrl: string };
      }
    ).__TEXTMOSAIC_CONFIG__ = { apiBaseUrl: "https://models.example.test/" };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          tokens: [],
          entities: [],
          relations: [],
          concepts: [],
          graph_relations: [],
          analysis: {
            mode: "document",
            coverage: "document",
            notice: "Built locally.",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      extractText("A dense source.", "balanced", "document"),
    ).resolves.toMatchObject({
      analysis: { mode: "document" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://models.example.test/extract",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          text: "A dense source.",
          tier: "balanced",
          mode: "document",
        }),
      }),
    );
  });

  it("rejects an HTML response instead of treating it as model data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<!doctype html><title>TextMosaic</title>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    );

    await expect(getTiers()).rejects.toThrow(
      "The local model service is unavailable.",
    );
  });
});
