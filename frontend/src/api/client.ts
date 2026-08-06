import type {
  Entity,
  ExtractResponse,
  Relation,
  TierInfo,
  TierName,
} from "../types";

const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ??
  "http://127.0.0.1:7860";
const REQUEST_TIMEOUT_MS = 20_000;
const TIER_RETRY_DELAYS_MS = [300, 900] as const;

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
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      headers: { "Content-Type": "application/json", ...init?.headers },
      signal: controller.signal,
      ...init,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The extraction service did not respond in time.");
    }
    throw new Error("Unable to reach the extraction service.");
  } finally {
    window.clearTimeout(timeout);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorResponse;
    throw new Error(
      body.error?.message ?? `Request failed with status ${response.status}.`,
    );
  }
  return (await response.json()) as T;
}

export async function getTiers(): Promise<TierInfo[]> {
  let lastError: Error | undefined;
  for (const delay of [...TIER_RETRY_DELAYS_MS, 0]) {
    if (delay > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, delay));
    }
    try {
      return (await request<ApiTierResponse>("/tiers")).tiers;
    } catch (error) {
      lastError =
        error instanceof Error
          ? error
          : new Error("Unable to load model tiers.");
    }
  }
  throw lastError ?? new Error("Unable to load model tiers.");
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
