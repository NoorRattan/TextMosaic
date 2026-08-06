import { describe, expect, it } from "vitest";

import { toClientResponse } from "./client";

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
});
