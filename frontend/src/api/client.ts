import type {
  Entity,
  ExtractResponse,
  GraphRelation,
  Relation,
  TierInfo,
  TierName,
} from "../types";

const REQUEST_TIMEOUT_MS = 20_000;
const TIER_RETRY_DELAYS_MS = [300, 900] as const;

interface ApiExtractResponse {
  tokens: string[];
  entities: Entity[];
  relations: Relation[];
  concepts?: ExtractResponse["concepts"];
  graph_relations?: GraphRelation[];
  analysis?: ExtractResponse["analysis"];
}

interface ApiTierResponse {
  tiers: TierInfo[];
}

interface ApiErrorResponse {
  error?: { message?: string };
}

interface RuntimeConfiguration {
  apiBaseUrl?: string;
}

class DeploymentConfigurationError extends Error {}

const SERVICE_UNAVAILABLE_MESSAGE =
  "The local model service is unavailable. Please reload the page or try again shortly.";

function getApiBaseUrl(): string {
  const runtimeConfiguration = (
    globalThis as typeof globalThis & {
      __TEXTMOSAIC_CONFIG__?: RuntimeConfiguration;
    }
  ).__TEXTMOSAIC_CONFIG__;
  const configuredUrl =
    runtimeConfiguration?.apiBaseUrl ?? import.meta.env.VITE_API_BASE_URL;
  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, "");
  }

  const hostname = globalThis.location?.hostname;
  if (
    hostname === undefined ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  ) {
    return "http://127.0.0.1:7860";
  }
  throw new DeploymentConfigurationError(
    "This deployment is missing VITE_API_BASE_URL. Set the frontend container environment variable to the local model service URL.",
  );
}

function toClientResponse(response: ApiExtractResponse): ExtractResponse {
  return {
    tokens: response.tokens,
    entities: response.entities.map((entity) => ({ ...entity })),
    relations: response.relations.map((relation) => ({ ...relation })),
    concepts: response.concepts ?? [],
    graphRelations: response.graph_relations ?? [],
    analysis:
      response.analysis ??
      ({
        mode: "extractor",
        coverage: "targeted",
        notice:
          "This legacy model response has no document-level concept explanations.",
      } as const),
  };
}

async function requestResponse(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );
  try {
    return await fetch(url, {
      headers: { "Content-Type": "application/json", ...init?.headers },
      signal: controller.signal,
      ...init,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The local model service did not respond in time.");
    }
    throw new Error("Unable to reach the local model service.");
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await requestResponse(`${getApiBaseUrl()}${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorResponse;
    throw new Error(body.error?.message ?? SERVICE_UNAVAILABLE_MESSAGE);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error(SERVICE_UNAVAILABLE_MESSAGE);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(SERVICE_UNAVAILABLE_MESSAGE);
  }
}

export async function getTiers(): Promise<TierInfo[]> {
  let lastError: Error | undefined;
  for (const delay of [...TIER_RETRY_DELAYS_MS, 0]) {
    if (delay > 0) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, delay));
    }
    try {
      return (await request<ApiTierResponse>("/tiers")).tiers;
    } catch (error) {
      if (error instanceof DeploymentConfigurationError) {
        throw error;
      }
      lastError =
        error instanceof Error
          ? error
          : new Error("Unable to load local relation-model tiers.");
    }
  }
  throw lastError ?? new Error("Unable to load local relation-model tiers.");
}

export async function extractText(
  text: string,
  tier: TierName,
  mode: "document" | "extractor" = "document",
): Promise<ExtractResponse> {
  const response = await request<ApiExtractResponse>("/extract", {
    method: "POST",
    body: JSON.stringify({ text, tier, mode }),
  });
  return toClientResponse(response);
}

export { toClientResponse };
