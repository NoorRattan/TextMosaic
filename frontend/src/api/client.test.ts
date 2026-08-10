import { afterEach, describe, expect, it, vi } from "vitest";

import { extractText, getTiers, toClientResponse } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as typeof globalThis & { __TEXTMOSAIC_CONFIG__?: object })
    .__TEXTMOSAIC_CONFIG__;
});

describe("toClientResponse", () => {
  it("preserves the current one-word API schema at the fetch boundary", () => {
    expect(
      toClientResponse({
        tokens: ["Ada"],
        entities: [{ type: "Peop", start: 0, end: 1 }],
        relations: [],
      }),
    ).toEqual({
      tokens: ["Ada"],
      entities: [{ type: "Peop", start: 0, end: 1 }],
      relations: [],
    });
  });

  it("loads the live model tier contract through the API boundary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          tiers: [
            { name: "speed", description: "Fastest" },
            { name: "balanced", description: "Default" },
            { name: "accuracy", description: "Strongest" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getTiers()).resolves.toEqual([
      { name: "speed", description: "Fastest" },
      { name: "balanced", description: "Default" },
      { name: "accuracy", description: "Strongest" },
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:7860/tiers",
      expect.objectContaining({
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("uses runtime container configuration instead of a compile-time API URL", async () => {
    (
      globalThis as typeof globalThis & {
        __TEXTMOSAIC_CONFIG__?: { apiBaseUrl: string };
      }
    ).__TEXTMOSAIC_CONFIG__ = { apiBaseUrl: "https://api.example.test/" };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ tiers: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getTiers();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/tiers",
      expect.any(Object),
    );
  });

  it("turns an HTML fallback response into an actionable service error", async () => {
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
      "The extraction service is unavailable.",
    );
  });

  it("uses the deployed Gradio queue contract for tiers and extraction", async () => {
    (
      globalThis as typeof globalThis & {
        __TEXTMOSAIC_CONFIG__?: {
          apiBaseUrl: string;
          apiTransport: "gradio";
        };
      }
    ).__TEXTMOSAIC_CONFIG__ = {
      apiBaseUrl: "https://demo.example.test/api",
      apiTransport: "gradio",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            named_endpoints: {
              "/extract": {
                parameters: [
                  {
                    parameter_name: "tier",
                    type: { enum: ["speed", "balanced", "accuracy"] },
                  },
                ],
              },
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ event_id: "event-123" }), {
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          'event: complete\ndata: [{"tokens":["Ada"],"entities":[],"relations":[]}]\n\n',
          { headers: { "Content-Type": "text/event-stream" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getTiers()).resolves.toHaveLength(3);
    await expect(extractText("Ada", "balanced")).resolves.toEqual({
      tokens: ["Ada"],
      entities: [],
      relations: [],
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://demo.example.test/gradio_api/info",
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://demo.example.test/gradio_api/call/v2/extract",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://demo.example.test/gradio_api/call/extract/event-123",
      expect.any(Object),
    );
  });

  it("preserves a useful Gradio queue error for the product UI", async () => {
    (
      globalThis as typeof globalThis & {
        __TEXTMOSAIC_CONFIG__?: {
          apiBaseUrl: string;
          apiTransport: "gradio";
        };
      }
    ).__TEXTMOSAIC_CONFIG__ = {
      apiBaseUrl: "https://demo.example.test/api",
      apiTransport: "gradio",
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ event_id: "event-456" }), {
            headers: { "Content-Type": "application/json" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            'event: error\ndata: {"error":"ZeroGPU quota exceeded"}\n\n',
            { headers: { "Content-Type": "text/event-stream" } },
          ),
        ),
    );

    await expect(extractText("Ada", "balanced")).rejects.toThrow(
      "ZeroGPU quota exceeded",
    );
  });
});
