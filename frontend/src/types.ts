export type EntityType = "Peop" | "Org" | "Loc" | "Other";
export type RelationType = string;

export interface Entity {
  type: EntityType;
  start: number;
  end: number;
}

export interface Relation {
  type: RelationType;
  head: number;
  tail: number;
}

export interface Evidence {
  quote: string;
}

export interface Concept {
  id: string;
  label: string;
  kind: string;
  origin: "model" | "rule";
  explanation: string;
  evidence: Evidence[];
  confidence: number;
}

export interface GraphRelation {
  source: string;
  target: string;
  label: string;
  explanation: string;
  evidence: Evidence[];
  confidence: number;
}

export interface AnalysisMetadata {
  mode: "document" | "extractor";
  coverage: "document" | "targeted";
  notice: string;
}

export interface ExtractResponse {
  tokens: string[];
  entities: Entity[];
  relations: Relation[];
  concepts: Concept[];
  graphRelations: GraphRelation[];
  analysis: AnalysisMetadata;
}
