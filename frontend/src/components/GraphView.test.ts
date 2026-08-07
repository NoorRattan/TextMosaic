import { describe, expect, it } from "vitest";

import { escapeHtml } from "./graphHtml";

describe("escapeHtml", () => {
  it("escapes entity and relation labels before the graph library renders HTML", () => {
    expect(escapeHtml("<img src=x onerror=\"alert(1)\"> & 'quoted'")).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;quoted&#39;",
    );
  });
});
