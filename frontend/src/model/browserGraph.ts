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

interface ModelConfig {
  id2label: Record<string, string>;
}

const RELATION_PATTERN =
  /([A-Za-z][A-Za-z0-9,/'’()\- ]{1,140}?)\s+(is associated with|is related to|is based in|is located in|works for|lives in|is responsible for|increases?|decreases?|reduces?|causes?|prevents?|improves?|worsens?|accelerates?|elevates?|raises?|lowers?|affects?|supports?|enables?|produces?|drives?|contains?|uses?|includes?|requires?|creates?|announces?|acquires?|develops?|broadcasts?|exerts?|binds?|transfers?|measures?|indicates?|reports?|diagnoses?|treats?|prohibits?|permits?|applies to|governs?|entitles?|qualifies?)\s+([A-Za-z][A-Za-z0-9,/'’()\- ]{1,180}?)(?=$|[.;:])/gi;

const WEAK_PHRASE = /^(?:it|they|this|these|those|which|that|who|whom|may)$/i;
const CONTINUATION_PATTERN = /^(.*?),\s*(?:which\s+)?may\s+(.+)$/i;
const CHAINED_RELATION_PATTERN =
  /^(increases?|decreases?|reduces?|causes?|prevents?|improves?|worsens?|accelerates?|elevates?|raises?|lowers?|affects?|supports?|enables?|produces?|drives?)\s+(.+?)(?:\s+and\s+(increases?|decreases?|reduces?|causes?|prevents?|improves?|worsens?|accelerates?|elevates?|raises?|lowers?|affects?|supports?|enables?|produces?|drives?)\s+(.+))?$/i;
const MAX_TEXT_LENGTH = 12_000;

let pipelinePromise: Promise<NerPipeline> | undefined;

function basePath(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

async function loadPipeline(
  onProgress?: ProgressCallback,
): Promise<NerPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = createLocalPipeline(onProgress).catch(
      (error: unknown) => {
        // A transient asset or browser-runtime failure must be retryable.
        pipelinePromise = undefined;
        throw error;
      },
    );
  }
  return pipelinePromise;
}

async function loadLocalJson<T>(path: string): Promise<T> {
  const response = await fetch(basePath(path), { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error("A bundled model asset could not be loaded.");
  }
  return (await response.json()) as T;
}

function modelChunks(text: string): Array<{ text: string; offset: number }> {
  const chunks: Array<{ text: string; offset: number }> = [];
  for (const sentence of sourceSentences(text)) {
    let offset = sentence.offset;
    let remaining = sentence.quote;
    while (remaining.length > 1_000) {
      const splitAt = Math.max(remaining.lastIndexOf(" ", 1_000), 1);
      chunks.push({ text: remaining.slice(0, splitAt), offset });
      remaining = remaining.slice(splitAt);
      offset += splitAt;
    }
    if (remaining.trim()) chunks.push({ text: remaining, offset });
  }
  return chunks;
}

function tokenSpans(
  text: string,
  tokens: string[],
): Array<{ start: number; end: number } | undefined> {
  const spans: Array<{ start: number; end: number } | undefined> = [];
  const normalized = text.toLocaleLowerCase();
  let cursor = 0;
  for (const token of tokens) {
    const piece = token.replace(/^##/, "").toLocaleLowerCase();
    if (!piece || /^\[.*\]$/.test(piece)) {
      spans.push(undefined);
      continue;
    }
    const start = normalized.indexOf(piece, cursor);
    if (start === -1) {
      spans.push(undefined);
      continue;
    }
    const end = start + piece.length;
    spans.push({ start, end });
    cursor = end;
  }
  return spans;
}

function softmaxConfidence(
  values: Float32Array,
  start: number,
  width: number,
  labelIndex: number,
): number {
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < width; index += 1) {
    maximum = Math.max(maximum, values[start + index]);
  }
  let total = 0;
  for (let index = 0; index < width; index += 1) {
    total += Math.exp(values[start + index] - maximum);
  }
  return Math.exp(values[start + labelIndex] - maximum) / total;
}

function predictionsFromLogits(
  text: string,
  offset: number,
  tokens: string[],
  logits: Float32Array,
  labels: string[],
): NerPrediction[] {
  const spans = tokenSpans(text, tokens);
  const output: NerPrediction[] = [];
  let active: NerPrediction | undefined;
  for (let index = 0; index < tokens.length; index += 1) {
    const span = spans[index];
    if (!span) continue;
    const rowStart = index * labels.length;
    let labelIndex = 0;
    for (let candidate = 1; candidate < labels.length; candidate += 1) {
      if (logits[rowStart + candidate] > logits[rowStart + labelIndex]) {
        labelIndex = candidate;
      }
    }
    const label = labels[labelIndex] ?? "O";
    if (label === "O") {
      active = undefined;
      continue;
    }
    const [prefix, entityGroup] = label.split("-", 2);
    if (!entityGroup) {
      active = undefined;
      continue;
    }
    const confidence = softmaxConfidence(
      logits,
      rowStart,
      labels.length,
      labelIndex,
    );
    if (prefix === "I" && active?.entity_group === entityGroup) {
      active.end = offset + span.end;
      active.word = `${active.word}${text.slice(span.start, span.end)}`;
      active.score = Math.min(active.score, confidence);
      continue;
    }
    active = {
      entity_group: entityGroup,
      word: text.slice(span.start, span.end),
      start: offset + span.start,
      end: offset + span.end,
      score: confidence,
    };
    output.push(active);
  }
  return output;
}

async function createLocalPipeline(
  onProgress?: ProgressCallback,
): Promise<NerPipeline> {
  onProgress?.(5);
  const [{ Tokenizer }, ort, tokenizerJson, tokenizerConfig, modelConfig] =
    await Promise.all([
      import("@huggingface/tokenizers"),
      import("onnxruntime-web"),
      loadLocalJson<object>("models/neurobert-ner/tokenizer.json"),
      loadLocalJson<object>("models/neurobert-ner/tokenizer_config.json"),
      loadLocalJson<ModelConfig>("models/neurobert-ner/config.json"),
    ]);
  ort.env.wasm.numThreads = 1;
  const tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig);
  const labels = Object.entries(modelConfig.id2label)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([, label]) => label);
  onProgress?.(20);
  const session = await ort.InferenceSession.create(
    basePath("models/neurobert-ner/onnx/model_int8.onnx"),
    { executionProviders: ["wasm"] },
  );
  onProgress?.(100);

  return async (text) => {
    const predictions: NerPrediction[] = [];
    for (const chunk of modelChunks(text)) {
      const encoding = tokenizer.encode(chunk.text, {
        return_token_type_ids: true,
      });
      if (encoding.ids.length > 512) {
        throw new Error(
          "A sentence is too dense for the bundled local model. Split it into shorter sentences.",
        );
      }
      const dimensions: [number, number] = [1, encoding.ids.length];
      const ids = BigInt64Array.from(encoding.ids, BigInt);
      const attention = BigInt64Array.from(encoding.attention_mask, BigInt);
      const types = BigInt64Array.from(
        encoding.token_type_ids ?? encoding.ids.map(() => 0),
        BigInt,
      );
      const outputs = await session.run({
        input_ids: new ort.Tensor("int64", ids, dimensions),
        attention_mask: new ort.Tensor("int64", attention, dimensions),
        token_type_ids: new ort.Tensor("int64", types, dimensions),
      });
      const logits = outputs.logits?.data;
      if (!(logits instanceof Float32Array)) {
        throw new Error("The bundled model returned an invalid response.");
      }
      predictions.push(
        ...predictionsFromLogits(
          chunk.text,
          chunk.offset,
          encoding.tokens,
          logits,
          labels,
        ),
      );
    }
    return predictions;
  };
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

function sourceSentences(
  text: string,
): Array<{ quote: string; offset: number }> {
  const sentences: Array<{ quote: string; offset: number }> = [];
  const pattern = /[^.!?\n]+(?:[.!?]+|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const leadingWhitespace = match[0].length - match[0].trimStart().length;
    const quote = match[0].trim();
    if (quote) {
      sentences.push({ quote, offset: match.index + leadingWhitespace });
    }
  }
  return sentences;
}

function relationLabel(predicate: string): string {
  return predicate
    .toLocaleLowerCase()
    .replace(/^is\s+/, "")
    .split(" ")
    .map((word) => {
      if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
      if (word.endsWith("s") && word.length > 3) return word.slice(0, -1);
      return word;
    })
    .join(" ");
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
    origin: Concept["origin"] = "rule",
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
        origin,
        explanation:
          origin === "rule"
            ? `“${cleaned}” is a source phrase used in a directly supported relationship.`
            : `“${cleaned}” is recognised locally as ${/^[aeiou]/i.test(kind) ? "an" : "a"} ${kind}.`,
        evidence: [{ quote: text.slice(start, end).trim() || cleaned }],
        confidence: Number(confidence.toFixed(2)),
      });
      if (entityType) entities.push({ type: entityType, start, end });
    } else if (origin === "model" && concepts.get(id)?.origin === "rule") {
      const existing = concepts.get(id);
      if (existing) {
        existing.origin = "model";
        existing.kind = kind;
        existing.confidence = Number(confidence.toFixed(2));
        existing.explanation = `“${cleaned}” is recognised locally as ${/^[aeiou]/i.test(kind) ? "an" : "a"} ${kind}.`;
        existing.evidence = [
          { quote: text.slice(start, end).trim() || cleaned },
        ];
      }
    }
    return id;
  };

  for (const prediction of predictions) {
    if (
      !Number.isInteger(prediction.start) ||
      !Number.isInteger(prediction.end) ||
      prediction.start < 0 ||
      prediction.end <= prediction.start ||
      prediction.end > text.length
    ) {
      continue;
    }
    const label = prediction.entity_group ?? prediction.entity ?? "OTHER";
    const { kind, type } = kindFromLabel(label);
    addConcept(
      text.slice(prediction.start, prediction.end) || prediction.word,
      prediction.start,
      prediction.end,
      kind,
      prediction.score,
      type,
      "model",
    );
  }

  const graphRelations: GraphRelation[] = [];
  for (const sentence of sourceSentences(text)) {
    RELATION_PATTERN.lastIndex = 0;
    let relationMatch: RegExpExecArray | null;
    while ((relationMatch = RELATION_PATTERN.exec(sentence.quote)) !== null) {
      const subject = cleanPhrase(relationMatch[1]);
      const continuation = relationMatch[3].match(CONTINUATION_PATTERN);
      const object = cleanPhrase(continuation?.[1] ?? relationMatch[3]);
      if (WEAK_PHRASE.test(subject) || WEAK_PHRASE.test(object)) continue;
      const subjectStart =
        sentence.offset +
        relationMatch.index +
        relationMatch[0].indexOf(relationMatch[1]);
      const objectStart =
        sentence.offset +
        relationMatch.index +
        relationMatch[0].lastIndexOf(relationMatch[3]);
      const source = addConcept(
        subject,
        subjectStart,
        subjectStart + relationMatch[1].length,
      );
      const target = addConcept(
        object,
        objectStart,
        objectStart + relationMatch[3].length,
      );
      if (!source || !target || source === target) continue;
      const predicate = relationMatch[2].toLocaleLowerCase();
      const sourceLabel = concepts.get(source)?.label ?? subject;
      const targetLabel = concepts.get(target)?.label ?? object;
      graphRelations.push({
        source,
        target,
        label: relationLabel(predicate),
        explanation: `The source states that ${sourceLabel} ${predicate} ${targetLabel}.`,
        evidence: [{ quote: sentence.quote }],
        confidence: 0.66,
      });
      if (!continuation) continue;
      const chained = continuation[2].match(CHAINED_RELATION_PATTERN);
      if (!chained) continue;
      const chainedObject = cleanPhrase(chained[2]);
      if (WEAK_PHRASE.test(chainedObject)) continue;
      const chainedObjectStart =
        sentence.offset +
        relationMatch.index +
        relationMatch[0].lastIndexOf(chained[2]);
      const chainedTarget = addConcept(
        chainedObject,
        chainedObjectStart,
        chainedObjectStart + chained[2].length,
      );
      if (!chainedTarget || chainedTarget === target) continue;
      const chainedPredicate = chained[1].toLocaleLowerCase();
      const chainedTargetLabel =
        concepts.get(chainedTarget)?.label ?? chainedObject;
      graphRelations.push({
        source: target,
        target: chainedTarget,
        label: relationLabel(chainedPredicate),
        explanation: `The source states that ${targetLabel} ${chainedPredicate} ${chainedTargetLabel}.`,
        evidence: [{ quote: sentence.quote }],
        confidence: 0.66,
      });
      if (!chained[3] || !chained[4]) continue;
      const finalObject = cleanPhrase(chained[4]);
      if (WEAK_PHRASE.test(finalObject)) continue;
      const finalObjectStart =
        sentence.offset +
        relationMatch.index +
        relationMatch[0].lastIndexOf(chained[4]);
      const finalTarget = addConcept(
        finalObject,
        finalObjectStart,
        finalObjectStart + chained[4].length,
      );
      if (!finalTarget || finalTarget === chainedTarget) continue;
      const finalPredicate = chained[3].toLocaleLowerCase();
      const finalTargetLabel = concepts.get(finalTarget)?.label ?? finalObject;
      graphRelations.push({
        source: chainedTarget,
        target: finalTarget,
        label: relationLabel(finalPredicate),
        explanation: `The source states that ${chainedTargetLabel} ${finalPredicate} ${finalTargetLabel}.`,
        evidence: [{ quote: sentence.quote }],
        confidence: 0.66,
      });
    }
  }

  const conceptList = [...concepts.values()].slice(0, 24);
  const knownIds = new Set(conceptList.map((concept) => concept.id));
  const relationshipList = graphRelations
    .slice(0, 32)
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
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(
      `Keep the source to ${MAX_TEXT_LENGTH.toLocaleString()} characters or fewer.`,
    );
  }
  const model = await loadPipeline(onProgress);
  const predictions = await model(text, { aggregation_strategy: "simple" });
  onProgress?.(100);
  return composeKnowledgeMap(text, predictions);
}
