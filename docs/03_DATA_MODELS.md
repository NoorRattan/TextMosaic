# FILE 03 — DATA MODELS — TextMosaic

## No persistent datastore
The API is stateless (File 01). No database, no indexes, no ORM. If a future session adds
persistence (e.g. saving past extractions), this file needs a real revision before that code is
written, not after.

## Source schema: CoNLL04 (`DFKI-SLT/conll04` on HF Datasets)
This is the actual shape of the training data, verified directly from the dataset card — not
invented. Field names below (`tokens`, `entities`, `type`, `start`, `end`, `relations`, `head`,
`tail`) are the exact strings used throughout this project's API, per File 00's naming convention.

Real example record from the dataset:
```json
{
  "tokens": ["Newspaper", "`", "Explains", "'", "U.S.", "Interests", "Section", "Events",
             "FL1402001894", "Havana", "Radio", "Reloj", "Network", "in", "Spanish",
             "2100", "GMT", "13", "Feb", "94"],
  "entities": [
    {"type": "Loc", "start": 4, "end": 5},
    {"type": "Loc", "start": 9, "end": 10},
    {"type": "Org", "start": 10, "end": 13},
    {"type": "Other", "start": 15, "end": 17},
    {"type": "Other", "start": 17, "end": 20}
  ],
  "relations": [
    {"type": "OrgBased_In", "head": 2, "tail": 1}
  ]
}
```
`start`/`end` are token indices (end-exclusive). `head`/`tail` in `relations` are indices **into
the `entities` array**, not token indices — easy to mix up, worth a code comment where it's used.

## API request/response schema
**Request** (`POST /extract`):
```json
{ "text": "Havana Radio Reloj Network broadcast the interview.", "tier": "balanced" }
```
`tier` is optional; defaults to `MODEL_TIER_DEFAULT` (`balanced`, File 02) if omitted. Must be one
of the three exact strings in File 00's Model Architecture table: `speed`, `balanced`, `accuracy`.

**Response:** same shape as the source schema above — `tokens`, `entities` (with `type`, `start`,
`end`), `relations` (with `type`, `head`, `tail`) — so the frontend and any future evaluation code
can reuse one set of TypeScript/Python types across training data and live API responses.

## TypeScript interfaces (frontend)
```typescript
interface Entity { type: "Peop" | "Org" | "Loc" | "Other"; start: number; end: number; }
interface Relation {
  type: "Located_In" | "Work_For" | "OrgBased_In" | "Live_In" | "Kill";
  head: number;
  tail: number;
}
interface ExtractResponse { tokens: string[]; entities: Entity[]; relations: Relation[]; }
```

## snake_case → camelCase mapping table
| API field (snake_case) | Frontend field (camelCase) | Conversion needed? |
|---|---|---|
| `tokens` | `tokens` | No — already a single word |
| `entities` | `entities` | No |
| `relations` | `relations` | No |
| `type` | `type` | No |
| `start` | `start` | No |
| `end` | `end` | No |
| `head` | `head` | No |
| `tail` | `tail` | No |

Every field in this schema happens to be a single word, so the conversion layer in `client.ts`
(File 02) is a no-op today. It stays in place anyway as a single seam, because the next field this
project adds (e.g. a future `entity_id`) will need the conversion, and it's better to have the seam
already exist than to retrofit it under pressure later.

## Validation rules (pydantic, backend)
- `text`: non-empty string, reasonable max length (e.g. 2,000 chars) — an unbounded string is an
  easy way to make a CPU model hang on a giant paste.
- `tier`: `Literal["speed", "balanced", "accuracy"]` — pydantic rejects anything else with a 422
  automatically; matches File 04's error format.

## Enum completeness (entity types → BIO tags)
| Entity type | B-tag | I-tag |
|---|---|---|
| `Peop` | `B-Peop` | `I-Peop` |
| `Org` | `B-Org` | `I-Org` |
| `Loc` | `B-Loc` | `I-Loc` |
| `Other` | `B-Other` | `I-Other` |

4 entity types × 2 + `O` = 9 tags total — matches File 00's Head Architecture tag set exactly, no
gaps.

## Enum completeness (relation types → RE head output classes)
`Located_In`, `Work_For`, `OrgBased_In`, `Live_In`, `Kill` + `no_relation` = 6 classes — matches
File 00's Head Architecture RE head description exactly.
