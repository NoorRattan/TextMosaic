export type EntityType = "Peop" | "Org" | "Loc" | "Other";
export type RelationType =
  "Located_In" | "Work_For" | "OrgBased_In" | "Live_In" | "Kill";
export type TierName = "speed" | "balanced" | "accuracy";

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

export interface ExtractResponse {
  tokens: string[];
  entities: Entity[];
  relations: Relation[];
}

export interface TierInfo {
  name: TierName;
  description: string;
}
