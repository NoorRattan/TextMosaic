import type {
  Concept,
  Entity,
  EntityType,
  ExtractResponse,
  GraphRelation,
} from "../types";

type ProgressCallback = (progress: number) => void;

interface NerPrediction {
  entity_group?: string;
  entity?: string;
  score: number;
  start: number;
  end: number;
  word: string;
}

type NerPipeline = (
  text: string,
  options: { aggregation_strategy: "simple" },
) => Promise<NerPrediction[]>;

const RELATION_PATTERN =
  /([A-Za-z][A-Za-z0-9,\- ]{2,90}?)\s+(increases?|decreases?|reduces?|causes?|prevents?|improves?|worsens?|accelerates?|elevates?|raises?|lowers?|affects?|supports?|enables?|produces?|drives?|contains?|uses?|includes?|requires?|creates?|announces?|acquires?|develops?|broadcasts?)\s+([A-Za-z][A-Za-z0-9,\- ]{2,90}?)(?=(?:[.;]|,\s+(?:which|and|but)|\s+and\s+(?:it|they)\b|$))/gi;

const CHAINED_RELATION_PATTERN =
  /^(.*?)(?:\s+and\s+)(increases?|decreases?|reduces?|causes?|prevents?|improves?|worsens?|accelerates?|elevates?|raises?|lowers?|affects?|supports?|enables?|produces?|drives?)\s+(.+)$/i;

const CONTINUATION_SUBJECT =
  /^(?:(?:which\s+)?may|which|it|they|this|these|those)$/i;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "was",
  "were",
  "with",
  "which",
]);

let pipelinePromise: Promise<NerPipeline> | undefined;

function basePath(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

async function loadPipeline(
  onProgress?: ProgressCallback,
): Promise<NerPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = import("@huggingface/transformers").then(
      async ({ env, pipeline }) => {
        env.allowLocalModels = true;
        env.allowRemoteModels = false;
        env.localModelPath = basePath("models/");
        const wasm = env.backends.onnx.wasm;
        if (!wasm) {
          throw new Error("The bundled browser runtime is unavailable.");
        }
        wasm.wasmPaths = basePath("wasm/");
        wasm.numThreads = 1;
        wasm.proxy = false;

        return (await pipeline("token-classification", "neurobert-ner", {
          dtype: "int8",
          local_files_only: true,
          progress_callback: (event: {
            status?: string;
            progress?: number;
          }) => {
            if (event.status === "progress" && event.progress !== undefined) {
              onProgress?.(Math.round(event.progress));
            }
          },
        })) as NerPipeline;
      },
    );
  }
  return pipelinePromise;
}

function slug(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function kindFromLabel(label: string): { kind: string; type: EntityType } {
  const normalized = label.replace(/^[BI]-/, "");
  if (normalized === "PERSON") return { kind: "person", type: "Peop" };
  if (normalized === "ORG") return { kind: "organization", type: "Org" };
  if (["GPE", "LOC", "FAC"].includes(normalized)) {
    return { kind: "place", type: "Loc" };
  }
  return {
    kind: normalized.toLocaleLowerCase().replace(/_/g, " "),
    type: "Other",
  };
}

function cleanPhrase(value: string): string {
  return value
    .replace(/^(?:recent|new|the|a|an)\s+/i, "")
    .replace(/^.*?\b(?:that|which)\s+/i, "")
    .replace(/\b(?:among|within|through|from)\s+.*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,;:\s-]+|[,;:\s-]+$/g, "");
}

function candidatePhrases(text: string): string[] {
  const words = text.match(/[A-Za-z][A-Za-z-]*/g) ?? [];
  const frequency = new Map<string, number>();
  for (let index = 0; index < words.length - 1; index += 1) {
    const pair = words.slice(index, index + 2);
    if (pair.some((word) => STOP_WORDS.has(word.toLocaleLowerCase()))) continue;
    const phrase = pair.join(" ");
    frequency.set(phrase, (frequency.get(phrase) ?? 0) + 1);
  }
  return [...frequency.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([phrase]) => phrase);
}

function sentenceFor(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf(".", index - 1) + 1, 0);
  const endMarker = text.indexOf(".", index);
  const end = endMarker === -1 ? text.length : endMarker + 1;
  return text.slice(start, end).trim();
}

export function composeKnowledgeMap(
  text: string,
  predictions: NerPrediction[],
): ExtractResponse {
  const concepts = new Map<string, Concept>();
  const entities: Entity[] = [];

  const addConcept = (
    label: string,
    start: number,
    end: number,
    kind = "concept",
    confidence = 0.7,
    entityType?: EntityType,
  ) => {
    const cleaned = cleanPhrase(label);
    if (cleaned.length < 2) return undefined;
    const id = slug(cleaned);
    if (!id) return undefined;
    if (!concepts.has(id)) {
      concepts.set(id, {
        id,
        label: cleaned,
        kind,
        explanation:
          kind === "concept"
            ? `“${cleaned}” is a key phrase in this passage.`
            : `“${cleaned}” is recognised locally as ${/^[aeiou]/i.test(kind) ? "an" : "a"} ${kind}.`,
        evidence: [{ quote: text.slice(start, end).trim() || cleaned }],
        confidence: Number(confidence.toFixed(2)),
      });
      if (entityType) entities.push({ type: entityType, start, end });
    }
    return id;
  };

  for (const prediction of predictions) {
    const label = prediction.entity_group ?? prediction.entity ?? "OTHER";
    const { kind, type } = kindFromLabel(label);
    addConcept(
      text.slice(prediction.start, prediction.end) || prediction.word,
      prediction.start,
      prediction.end,
      kind,
      prediction.score,
      type,
    );
  }

  const graphRelations: GraphRelation[] = [];
  let priorTarget: string | undefined;
  let relationMatch: RegExpExecArray | null;
  while ((relationMatch = RELATION_PATTERN.exec(text)) !== null) {
    const subject = cleanPhrase(relationMatch[1]);
    const predicate = relationMatch[2].toLocaleLowerCase();
    const chained = cleanPhrase(relationMatch[3]).match(
      CHAINED_RELATION_PATTERN,
    );
    const object = cleanPhrase(chained?.[1] ?? relationMatch[3]);
    const subjectStart =
      relationMatch.index + relationMatch[0].indexOf(relationMatch[1]);
    const objectStart =
      relationMatch.index + relationMatch[0].lastIndexOf(relationMatch[3]);
    const inferredSource = CONTINUATION_SUBJECT.test(subject)
      ? priorTarget
      : undefined;
    const source =
      inferredSource ??
      addConcept(subject, subjectStart, subjectStart + relationMatch[1].length);
    const target = addConcept(
      object,
      objectStart,
      objectStart + relationMatch[3].length,
    );
    if (!source || !target || source === target) continue;
    const evidence = sentenceFor(text, relationMatch.index);
    const sourceLabel = concepts.get(source)?.label ?? subject;
    const targetLabel = concepts.get(target)?.label ?? object;
    graphRelations.push({
      source,
      target,
      label: predicate.replace(/s$/, ""),
      explanation: `The passage states that ${sourceLabel} ${predicate} ${targetLabel}.`,
      evidence: [{ quote: evidence }],
      confidence: 0.66,
    });
    priorTarget = target;

    if (chained) {
      const chainedPredicate = chained[2].toLocaleLowerCase();
      const chainedObject = cleanPhrase(chained[3]);
      const chainedStart =
        objectStart + relationMatch[3].lastIndexOf(chained[3]);
      const chainedTarget = addConcept(
        chainedObject,
        chainedStart,
        chainedStart + chained[3].length,
      );
      if (chainedTarget && chainedTarget !== target) {
        graphRelations.push({
          source: target,
          target: chainedTarget,
          label: chainedPredicate.replace(/s$/, ""),
          explanation: `The passage states that ${targetLabel} ${chainedPredicate} ${chainedObject}.`,
          evidence: [{ quote: evidence }],
          confidence: 0.66,
        });
        priorTarget = chainedTarget;
      }
    }
  }

  for (const phrase of candidatePhrases(text)) {
    const start = text.toLocaleLowerCase().indexOf(phrase.toLocaleLowerCase());
    addConcept(phrase, start, start + phrase.length);
  }

  const conceptList = [...concepts.values()].slice(0, 16);
  const knownIds = new Set(conceptList.map((concept) => concept.id));
  const relationshipList = graphRelations
    .filter(
      (relation) =>
        knownIds.has(relation.source) && knownIds.has(relation.target),
    )
    .filter(
      (relation, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.source === relation.source &&
            candidate.target === relation.target &&
            candidate.label === relation.label,
        ) === index,
    );

  return {
    tokens: text.match(/\S+/g) ?? [],
    entities,
    relations: [],
    concepts: conceptList,
    graphRelations: relationshipList,
    analysis: {
      mode: "document",
      coverage: "document",
      notice:
        "On-device ML extraction: the bundled ONNX model and graph rules ran entirely in this browser. No text was sent to a server.",
    },
  };
}

export async function extractKnowledgeMap(
  text: string,
  onProgress?: ProgressCallback,
): Promise<ExtractResponse> {
  if (!text.trim()) throw new Error("Paste some text before building a map.");
  const model = await loadPipeline(onProgress);
  const predictions = await model(text, { aggregation_strategy: "simple" });
  onProgress?.(100);
  return composeKnowledgeMap(text, predictions);
}
