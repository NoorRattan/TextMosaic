import { describe, expect, it } from "vitest";

import { composeKnowledgeMap } from "./browserGraph";

describe("composeKnowledgeMap", () => {
  it("combines local ML entities with source-grounded graph relations", () => {
    const source =
      "Acme Labs increases cardiovascular research funding in London.";
    const result = composeKnowledgeMap(source, [
      {
        entity_group: "ORG",
        word: "Acme Labs",
        start: 0,
        end: 9,
        score: 0.93,
      },
      {
        entity_group: "GPE",
        word: "London",
        start: 55,
        end: 61,
        score: 0.91,
      },
    ]);

    expect(result.concepts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Acme Labs", kind: "organization" }),
        expect.objectContaining({ label: "London", kind: "place" }),
      ]),
    );
    expect(result.graphRelations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "increase",
          evidence: [{ quote: source }],
        }),
      ]),
    );
    expect(result.analysis.notice).toContain("No text was sent to a server");
  });

  it("keeps modal continuation clauses attached to the preceding concept", () => {
    const source =
      "Chronic exposure to fine particulate matter increases systemic inflammation, which may accelerate plaque formation and elevate cardiovascular risk.";
    const result = composeKnowledgeMap(source, []);

    expect(result.graphRelations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "chronic-exposure-to-fine-particulate-matter",
          target: "systemic-inflammation",
          label: "increase",
        }),
        expect.objectContaining({
          source: "systemic-inflammation",
          target: "plaque-formation",
          label: "accelerate",
        }),
        expect.objectContaining({
          source: "plaque-formation",
          target: "cardiovascular-risk",
          label: "elevate",
        }),
      ]),
    );
    expect(result.concepts.map((concept) => concept.label)).not.toContain(
      "may",
    );
  });

  it("recognises broadcast statements as source-grounded relationships", () => {
    const source =
      "Havana Radio Reloj Network broadcast the interview from Cuba.";
    const result = composeKnowledgeMap(source, []);

    expect(result.graphRelations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "havana-radio-reloj-network",
          target: "interview",
          label: "broadcast",
          evidence: [{ quote: source }],
        }),
      ]),
    );
  });
});
