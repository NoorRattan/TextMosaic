import { afterEach, describe, expect, it, vi } from "vitest";

import { getTiers, toClientResponse } from "./client";

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
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ tiers: [] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await getTiers();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/tiers",
      expect.any(Object),
    );
  });
});
