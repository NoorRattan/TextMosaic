import type {
  Entity,
  ExtractResponse,
  Relation,
  TierInfo,
  TierName,
} from "../types";

const REQUEST_TIMEOUT_MS = 20_000;
const GRADIO_REQUEST_TIMEOUT_MS = 90_000;
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

interface RuntimeConfiguration {
  apiBaseUrl?: string;
  apiTransport?: "rest" | "gradio";
}

class DeploymentConfigurationError extends Error {}

const SERVICE_UNAVAILABLE_MESSAGE =
  "The extraction service is unavailable. Please reload the page or try again shortly.";

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
    "This deployment is missing VITE_API_BASE_URL. Set the frontend container environment variable to the public API URL.",
  );
}

function getApiTransport(): "rest" | "gradio" {
  const runtimeConfiguration = (
    globalThis as typeof globalThis & {
      __TEXTMOSAIC_CONFIG__?: RuntimeConfiguration;
    }
  ).__TEXTMOSAIC_CONFIG__;
  return (
    runtimeConfiguration?.apiTransport ??
    import.meta.env.VITE_API_TRANSPORT ??
    "rest"
  );
}

function getServiceOrigin(): string {
  return getApiBaseUrl().replace(/\/api$/, "");
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

async function requestResponse(
  url: string,
  init?: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
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
    globalThis.clearTimeout(timeout);
  }
  return response;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await requestResponse(`${getApiBaseUrl()}${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorResponse;
    throw new Error(body.error?.message ?? SERVICE_UNAVAILABLE_MESSAGE);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(SERVICE_UNAVAILABLE_MESSAGE);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(SERVICE_UNAVAILABLE_MESSAGE);
  }
}

async function requestGradio<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await requestResponse(
    `${getServiceOrigin()}${path}`,
    init,
    GRADIO_REQUEST_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(SERVICE_UNAVAILABLE_MESSAGE);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(SERVICE_UNAVAILABLE_MESSAGE);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(SERVICE_UNAVAILABLE_MESSAGE);
  }
}

const GRADIO_TIER_DESCRIPTIONS: Record<TierName, string> = {
  speed: "Fastest, lowest accuracy",
  balanced: "Default — a middle ground",
  accuracy: "Slowest, highest accuracy",
};

interface GradioInfoResponse {
  named_endpoints?: {
    "/extract"?: {
      parameters?: Array<{
        parameter_name?: string;
        type?: { enum?: string[] };
      }>;
    };
  };
}

interface GradioCallResponse {
  event_id?: string;
}

interface GradioErrorEvent {
  error?: string;
}

function isTierName(value: string): value is TierName {
  return value === "speed" || value === "balanced" || value === "accuracy";
}

async function getGradioTiers(): Promise<TierInfo[]> {
  const info = await requestGradio<GradioInfoResponse>("/gradio_api/info");
  const values = info.named_endpoints?.["/extract"]?.parameters?.find(
    (parameter) => parameter.parameter_name === "tier",
  )?.type?.enum;
  const tierNames = values?.filter(isTierName) ?? [];
  if (tierNames.length === 0) {
    throw new Error(SERVICE_UNAVAILABLE_MESSAGE);
  }
  return tierNames.map((name) => ({
    name,
    description: GRADIO_TIER_DESCRIPTIONS[name],
  }));
}

async function extractWithGradio(
  text: string,
  tier: TierName,
): Promise<ExtractResponse> {
  const call = await requestGradio<GradioCallResponse>(
    "/gradio_api/call/v2/extract",
    {
      method: "POST",
      body: JSON.stringify({ text, tier }),
    },
  );
  if (!call.event_id) {
    throw new Error(SERVICE_UNAVAILABLE_MESSAGE);
  }
  const response = await requestResponse(
    `${getServiceOrigin()}/gradio_api/call/extract/${encodeURIComponent(call.event_id)}`,
    undefined,
    GRADIO_REQUEST_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(SERVICE_UNAVAILABLE_MESSAGE);
  }
  const events = (await response.text()).split("\n\n");
  const completeEvent = events.find((event) =>
    event.includes("event: complete"),
  );
  const errorEvent = events.find((event) => event.includes("event: error"));
  const data = completeEvent
    ?.split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .join("\n");
  if (!data) {
    const errorData = errorEvent
      ?.split("\n")
      .find((line) => line.startsWith("data: "))
      ?.slice("data: ".length);
    if (errorData) {
      let error: GradioErrorEvent | undefined;
      try {
        error = JSON.parse(errorData) as GradioErrorEvent;
      } catch {
        error = undefined;
      }
      if (error?.error) {
        throw new Error(error.error);
      }
    }
    throw new Error(SERVICE_UNAVAILABLE_MESSAGE);
  }
  try {
    const outputs = JSON.parse(data) as unknown[];
    return toClientResponse(outputs[0] as ApiExtractResponse);
  } catch {
    throw new Error(SERVICE_UNAVAILABLE_MESSAGE);
  }
}

export async function getTiers(): Promise<TierInfo[]> {
  if (getApiTransport() === "gradio") {
    return getGradioTiers();
  }
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
          : new Error("Unable to load model tiers.");
    }
  }
  throw lastError ?? new Error("Unable to load model tiers.");
}

export async function extractText(
  text: string,
  tier: TierName,
): Promise<ExtractResponse> {
  if (getApiTransport() === "gradio") {
    return extractWithGradio(text, tier);
  }
  const response = await request<ApiExtractResponse>("/extract", {
    method: "POST",
    body: JSON.stringify({ text, tier }),
  });
  return toClientResponse(response);
}

export { toClientResponse };
