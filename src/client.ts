import type { MxRouteConfig } from "./config.js";
import { ApiError } from "./errors.js";
import type { ApiEnvelope } from "./types.js";

/** Per-request timeout for all MXroute API calls. */
const REQUEST_TIMEOUT_MS = 30_000;

function configMissingError(missing: readonly string[]): ApiError {
  return new ApiError(
    "CONFIG_MISSING",
    "MXroute credentials are not configured",
    undefined,
    `Set the environment variables: ${missing.join(", ")}. Create an API key at https://panel.mxroute.com/api-keys.php (the server and username are shown on that page).`,
  );
}

/** Seconds to wait before retrying, derived from rate-limit response headers. */
function rateLimitWait(res: Response): string {
  const retryAfter = res.headers.get("Retry-After");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter.trim());
    if (Number.isFinite(seconds)) return `${Math.max(0, Math.ceil(seconds))}s (Retry-After)`;
  }
  const reset = res.headers.get("X-RateLimit-Reset");
  if (reset !== null) {
    const resetSeconds = Number(reset.trim());
    if (Number.isFinite(resetSeconds)) {
      return `${Math.max(0, Math.ceil(resetSeconds - Date.now() / 1000))}s`;
    }
  }
  return "a minute";
}

/**
 * Actionable hint text for an API error code. The RATE_LIMITED wait comes
 * from the Retry-After / X-RateLimit-Reset response headers.
 */
function hintForCode(code: string, status: number, res: Response): string {
  switch (code) {
    case "UNAUTHORIZED":
      return "Check MXROUTE_API_KEY, MXROUTE_SERVER and MXROUTE_USERNAME. Create keys at https://panel.mxroute.com/api-keys.php. Send the complete key unchanged (no keyid: prefix).";
    case "FORBIDDEN":
      return "The credential lacks permission (reseller endpoints need reseller privileges; impersonated users can't use reseller endpoints).";
    case "NOT_FOUND":
      return "Check that the name is spelled exactly and exists on this account/server.";
    case "CONFLICT":
      return "The resource already exists (spam entries match case-insensitively).";
    case "RATE_LIMITED":
      return `Rate limited. Wait ${rateLimitWait(res)} before retrying. Limits: 200 reads/min, 60 writes/min, 10 bulk/min.`;
    case "VALIDATION_ERROR":
      return "Fix the highlighted field and retry.";
    case "BUSINESS_ERROR":
      return "The request violates a business rule (e.g. a limit was reached). See message.";
    default: {
      let hint = `MXroute API error (HTTP ${status}). Retry later; if it persists check MXroute status/discord.`;
      if (status === 503) {
        hint +=
          " Another update may be in progress on this account — wait a few seconds, re-read the settings, then retry.";
      }
      return hint;
    }
  }
}

/** True when the parsed body looks like the API error envelope. */
function isEnvelope(body: unknown): body is {
  success: boolean;
  error: { code: string; message?: string; field?: string };
} {
  if (typeof body !== "object" || body === null) return false;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return false;
  return typeof (error as { code?: unknown }).code === "string";
}

/**
 * Minimal REST client for the MXroute Email Hosting API.
 *
 * Holds no state beyond the (possibly null) config, so a single instance can
 * be shared by every tool. Throws ApiError on every failure path; returns
 * the FULL parsed JSON response body on success (tools unwrap `.data`) and
 * null for 204 No Content.
 */
export class MxRouteClient {
  constructor(private readonly config: MxRouteConfig | null) {}

  /**
   * Perform an API request.
   *
   * @param method HTTP method
   * @param path API path starting with "/" (use `enc()` for path parameters)
   * @param body Optional JSON-serializable request body
   * @returns the parsed response body, or null for 204 / empty bodies
   * @throws ApiError (CONFIG_MISSING, NETWORK_ERROR, TIMEOUT, or an API error code)
   */
  async request<T = unknown>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T | null> {
    if (!this.config) {
      throw configMissingError(["MXROUTE_API_KEY", "MXROUTE_SERVER", "MXROUTE_USERNAME"]);
    }

    const missing: string[] = [];
    if (!this.config.apiKey) missing.push("MXROUTE_API_KEY");
    if (!this.config.server) missing.push("MXROUTE_SERVER");
    if (!this.config.username) missing.push("MXROUTE_USERNAME");
    if (missing.length > 0) throw configMissingError(missing);

    const headers: Record<string, string> = {
      "X-Server": this.config.server,
      "X-Username": this.config.username,
      "X-API-Key": this.config.apiKey,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    let text: string;
    try {
      res = await fetch(this.config.baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      // 204 No Content (all DELETE endpoints and some others).
      if (res.status === 204) return null;

      // Inside the same boundary as fetch: a stalled or aborted connection
      // mid-body must surface as TIMEOUT/NETWORK_ERROR, not a raw DOMException.
      text = await res.text();
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new ApiError(
          "TIMEOUT",
          `The MXroute API request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`,
        );
      }
      throw new ApiError(
        "NETWORK_ERROR",
        `Could not reach the MXroute API at ${this.config.baseUrl}. Check your network connection and MXROUTE_API_BASE.`,
      );
    }

    if (!res.ok) {
      let parsed: unknown = null;
      try {
        parsed = text === "" ? null : JSON.parse(text);
      } catch {
        parsed = null;
      }
      if (isEnvelope(parsed)) {
        throw new ApiError(
          parsed.error.code,
          typeof parsed.error.message === "string" && parsed.error.message !== ""
            ? parsed.error.message
            : `Request failed (HTTP ${res.status})`,
          res.status,
          hintForCode(parsed.error.code, res.status, res),
          typeof parsed.error.field === "string" ? parsed.error.field : undefined,
        );
      }
      throw new ApiError(
        "SERVER_ERROR",
        `Unexpected non-JSON response (HTTP ${res.status})`,
        res.status,
        hintForCode("SERVER_ERROR", res.status, res),
      );
    }

    // Success: return the FULL response body. An empty 2xx body is treated
    // like 204 (null); a non-empty body that is not JSON is a server error.
    if (text === "") return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(
        "SERVER_ERROR",
        `Unexpected non-JSON response (HTTP ${res.status})`,
        res.status,
        hintForCode("SERVER_ERROR", res.status, res),
      );
    }
  }
}

/**
 * Unwrap the `data` payload of an enveloped response for a documented read
 * endpoint. An empty body (null) or a null/undefined `data` field violates
 * the endpoint's contract, so it surfaces as SERVER_ERROR instead of silently
 * returning null to the agent.
 */
export function unwrapData<T>(res: ApiEnvelope<T> | null): T {
  const data = res?.data;
  if (data === null || data === undefined) {
    throw new ApiError(
      "SERVER_ERROR",
      "The API returned an unexpected empty response for a documented endpoint.",
      undefined,
      "Retry the call; if it persists, the API contract may have changed.",
    );
  }
  return data;
}

/**
 * Require a non-null body from a documented NON-enveloped read endpoint
 * (the payload sits at the top level, so unwrapData does not apply). An
 * empty body (null) violates the endpoint's contract, so it surfaces as
 * SERVER_ERROR instead of emitting null to the agent.
 */
export function requireBody<T>(res: T | null): T {
  if (res === null || res === undefined) {
    throw new ApiError(
      "SERVER_ERROR",
      "The API returned an unexpected empty response for a documented endpoint.",
      undefined,
      "Retry the call; if it persists, the API contract may have changed.",
    );
  }
  return res;
}

/**
 * Percent-encode a single path segment (e.g. domain, username, spam entry).
 * Use this for every path parameter: `client.request("GET", \`/domains/${enc(domain)}/dns\`)`.
 *
 * Rejects "." and "..": the URL parser collapses such dot segments, so a
 * validated `user: ".."` would otherwise turn
 * `/domains/d/email-accounts/..` into `/domains/d/` (a whole-domain DELETE).
 * Percent-encoding them is not an alternative — the parser collapses
 * `%2E%2E` too — so rejection is the only safe handling.
 */
export function enc(segment: string): string {
  const encoded = encodeURIComponent(segment);
  if (encoded === "." || encoded === "..") {
    throw new ApiError(
      "VALIDATION_ERROR",
      "Path segment must not be '.' or '..'",
      undefined,
      "This value would alter the request URL path.",
    );
  }
  return encoded;
}
