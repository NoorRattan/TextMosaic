import type {
  Entity,
  ExtractResponse,
  Relation,
  TierInfo,
  TierName,
} from "../types";

const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ??
  "http://localhost:7860";

interface ApiExtractResponse {
  tokens: string[];
  entities: Entity[];
  relations: Relation[];
}

interface ApiTierResponse {
  tiers: TierInfo[];
}

interface ApiErrorResponse {
  error?: { message?: string };
}

function toClientResponse(response: ApiExtractResponse): ExtractResponse {
  // This is the deliberate API boundary. All current fields are single words,
  // so the required snake_case-to-camelCase conversion is a no-op today.
  return {
    tokens: response.tokens,
    entities: response.entities.map((entity) => ({ ...entity })),
    relations: response.relations.map((relation) => ({ ...relation })),
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorResponse;
    throw new Error(
      body.error?.message ?? `Request failed with status ${response.status}.`,
    );
  }
  return (await response.json()) as T;
}

export async function getTiers(): Promise<TierInfo[]> {
  return (await request<ApiTierResponse>("/tiers")).tiers;
}

export async function extractText(
  text: string,
  tier: TierName,
): Promise<ExtractResponse> {
  const response = await request<ApiExtractResponse>("/extract", {
    method: "POST",
    body: JSON.stringify({ text, tier }),
  });
  return toClientResponse(response);
}

export { toClientResponse };
