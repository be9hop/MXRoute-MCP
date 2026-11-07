import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { enc, MxRouteClient, unwrapData } from "../src/client.js";
import { ApiError } from "../src/errors.js";

const CONFIG = {
  apiKey: "test-key",
  server: "eagle.mxlogin.com",
  username: "johndoe",
  baseUrl: "https://api.test",
};

const AUTH_HEADERS = {
  "X-Server": "eagle.mxlogin.com",
  "X-Username": "johndoe",
  "X-API-Key": "test-key",
  Accept: "application/json",
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** JSON Response with the exact surface client.ts consumes (status/ok/headers/text). */
function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** Body-less Response (204 or an empty 2xx body). */
function emptyResponse(status = 200): Response {
  return new Response(null, { status });
}

/** Run a request that is expected to reject and return the rejection value. */
async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  return promise.then(
    () => {
      throw new Error("expected the request to reject");
    },
    (err) => err as ApiError,
  );
}

describe("MxRouteClient configuration guard", () => {
  it("throws CONFIG_MISSING listing every env var when the config is null, without calling fetch", async () => {
    const err = await rejection(new MxRouteClient(null).request("GET", "/domains"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("CONFIG_MISSING");
    expect(err.hint).toContain("MXROUTE_API_KEY");
    expect(err.hint).toContain("MXROUTE_SERVER");
    expect(err.hint).toContain("MXROUTE_USERNAME");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws CONFIG_MISSING naming only the blank field", async () => {
    const client = new MxRouteClient({ ...CONFIG, apiKey: "" });
    const err = await rejection(client.request("GET", "/domains"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("CONFIG_MISSING");
    expect(err.hint).toContain("MXROUTE_API_KEY");
    expect(err.hint).not.toContain("MXROUTE_SERVER");
    expect(err.hint).not.toContain("MXROUTE_USERNAME");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("request formation", () => {
  beforeEach(() => {
    fetchMock.mockResolvedValue(emptyResponse(204));
  });

  it("GET targets baseUrl + path with the auth headers, no body, and an abort signal", async () => {
    await new MxRouteClient(CONFIG).request("GET", "/domains");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/domains");
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual(AUTH_HEADERS);
    expect(init.body).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("POST serializes the body as JSON and sets Content-Type", async () => {
    await new MxRouteClient(CONFIG).request("POST", "/domains", { domain: "example.com" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/domains");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ ...AUTH_HEADERS, "Content-Type": "application/json" });
    expect(init.body).toBe('{"domain":"example.com"}');
  });

  it("PATCH serializes the body as JSON and sets Content-Type", async () => {
    await new MxRouteClient(CONFIG).request("PATCH", "/domains/example.com/mail-status", {
      enabled: false,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/domains/example.com/mail-status");
    expect(init.method).toBe("PATCH");
    expect(init.headers).toEqual({ ...AUTH_HEADERS, "Content-Type": "application/json" });
    expect(init.body).toBe('{"enabled":false}');
  });

  it("DELETE sends no body and no Content-Type header", async () => {
    await new MxRouteClient(CONFIG).request("DELETE", "/domains/example.com");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/domains/example.com");
    expect(init.method).toBe("DELETE");
    expect(init.headers).toEqual(AUTH_HEADERS);
    expect(init.body).toBeUndefined();
  });
});

describe("success handling", () => {
  it("resolves null for 204 No Content", async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(204));
    await expect(new MxRouteClient(CONFIG).request("GET", "/domains")).resolves.toBeNull();
  });

  it("resolves null for an empty 2xx body", async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(200));
    await expect(new MxRouteClient(CONFIG).request("GET", "/domains")).resolves.toBeNull();
  });

  it("returns the full enveloped body without unwrapping .data", async () => {
    const body = { success: true, data: ["example.com", "other.org"] };
    fetchMock.mockResolvedValueOnce(jsonResponse(body));
    await expect(new MxRouteClient(CONFIG).request("GET", "/domains")).resolves.toEqual(body);
  });
});

describe("error mapping", () => {
  it("VALIDATION_ERROR propagates code, status, message, hint, and field", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          success: false,
          error: { code: "VALIDATION_ERROR", message: "quota must be an integer", field: "quota" },
        },
        422,
      ),
    );
    const err = await rejection(
      new MxRouteClient(CONFIG).request("POST", "/domains/example.com/email-accounts", {
        username: "info",
      }),
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.status).toBe(422);
    expect(err.message).toBe("quota must be an integer");
    expect(err.field).toBe("quota");
    expect(err.hint).toContain("Fix the highlighted field and retry");
  });

  it("UNAUTHORIZED hint points at panel.mxroute.com", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: false, error: { code: "UNAUTHORIZED", message: "bad key" } }, 401),
    );
    const err = await rejection(new MxRouteClient(CONFIG).request("GET", "/domains"));
    expect(err.code).toBe("UNAUTHORIZED");
    expect(err.status).toBe(401);
    expect(err.hint).toContain("panel.mxroute.com");
  });

  it("RATE_LIMITED derives the wait from the Retry-After header", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { success: false, error: { code: "RATE_LIMITED", message: "Too many requests" } },
        429,
        { "Retry-After": "17" },
      ),
    );
    const err = await rejection(new MxRouteClient(CONFIG).request("GET", "/domains"));
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.status).toBe(429);
    expect(err.hint).toContain("17s (Retry-After)");
    expect(err.message).not.toContain("17");
  });

  it("RATE_LIMITED falls back to X-RateLimit-Reset when Retry-After is absent", async () => {
    const reset = Math.ceil(Date.now() / 1000) + 45;
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { success: false, error: { code: "RATE_LIMITED", message: "Too many requests" } },
        429,
        { "X-RateLimit-Reset": String(reset) },
      ),
    );
    const err = await rejection(new MxRouteClient(CONFIG).request("GET", "/domains"));
    expect(err.hint).toMatch(/Wait 4[56]s/);
  });

  it("maps a generic 500 envelope to code SERVER_ERROR with the default hint", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { success: false, error: { code: "SERVER_ERROR", message: "Internal error" } },
        500,
      ),
    );
    const err = await rejection(new MxRouteClient(CONFIG).request("GET", "/domains"));
    expect(err.code).toBe("SERVER_ERROR");
    expect(err.status).toBe(500);
    expect(err.message).toBe("Internal error");
    expect(err.hint).toContain("HTTP 500");
    expect(err.hint).toContain("Retry later");
  });

  it("503 hint explains the concurrent-update retry", async () => {
    fetchMock.mockResolvedValueOnce(new Response("maintenance", { status: 503 }));
    const err = await rejection(
      new MxRouteClient(CONFIG).request("PATCH", "/domains/example.com/spam/settings", {
        high_score: 5,
      }),
    );
    expect(err.code).toBe("SERVER_ERROR");
    expect(err.status).toBe(503);
    expect(err.hint).toContain("in progress");
    expect(err.hint).toContain("wait a few seconds");
  });

  it("a non-JSON error body becomes SERVER_ERROR with the HTTP status in the message", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html>boom</html>", { status: 500, headers: { "Content-Type": "text/html" } }),
    );
    const err = await rejection(new MxRouteClient(CONFIG).request("GET", "/domains"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("SERVER_ERROR");
    expect(err.status).toBe(500);
    expect(err.message).toContain("Unexpected non-JSON response");
    expect(err.message).toContain("500");
  });
});

describe("transport failures", () => {
  it("maps a fetch TimeoutError rejection to ApiError TIMEOUT", async () => {
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error("signal timed out"), { name: "TimeoutError" }),
    );
    const err = await rejection(new MxRouteClient(CONFIG).request("GET", "/domains"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("TIMEOUT");
    expect(err.message).toContain("30 seconds");
  });

  it("maps an AbortError-like fetch rejection to ApiError NETWORK_ERROR, not a raw crash", async () => {
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
    );
    const err = await rejection(new MxRouteClient(CONFIG).request("GET", "/domains"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.message).toContain("https://api.test");
  });

  it("maps a generic fetch rejection (TypeError) to ApiError NETWORK_ERROR", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const err = await rejection(new MxRouteClient(CONFIG).request("GET", "/domains"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("NETWORK_ERROR");
  });

  /** Response look-alike whose body read rejects, for mid-body failure tests. */
  function responseWithFailingBody(reason: unknown): Response {
    return {
      status: 200,
      ok: true,
      headers: new Headers(),
      text: () => Promise.reject(reason),
    } as unknown as Response;
  }

  it("maps a body-read TimeoutError to ApiError TIMEOUT, not a raw DOMException", async () => {
    fetchMock.mockResolvedValueOnce(responseWithFailingBody(new DOMException("aborted", "TimeoutError")));
    const err = await rejection(new MxRouteClient(CONFIG).request("GET", "/domains"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("TIMEOUT");
    expect(err.message).toContain("30 seconds");
  });

  it("maps a mid-body network failure to ApiError NETWORK_ERROR", async () => {
    fetchMock.mockResolvedValueOnce(responseWithFailingBody(new TypeError("terminated")));
    const err = await rejection(new MxRouteClient(CONFIG).request("GET", "/domains"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("NETWORK_ERROR");
  });
});

describe("unwrapData", () => {
  it("returns res.data for an enveloped response", () => {
    expect(unwrapData({ success: true, data: ["example.com"] })).toEqual(["example.com"]);
  });

  it("throws SERVER_ERROR for a null response (empty 200) or null/undefined data", () => {
    for (const bad of [null, { success: true, data: null }, { success: true, data: undefined }]) {
      let thrown: unknown;
      try {
        unwrapData(bad as never);
      } catch (err) {
        thrown = err;
      }
      expect(thrown, JSON.stringify(bad)).toBeInstanceOf(ApiError);
      expect((thrown as ApiError).code).toBe("SERVER_ERROR");
      expect((thrown as ApiError).message).toContain("unexpected empty response");
      expect((thrown as ApiError).hint).toContain("Retry the call");
    }
  });
});

describe("enc", () => {
  it("throws VALIDATION_ERROR for '.' and '..' (dot segments collapse the URL path)", () => {
    for (const bad of [".", ".."]) {
      expect(() => enc(bad), bad).toThrow(ApiError);
      expect(() => enc(bad), bad).toThrow("Path segment must not be '.' or '..'");
    }
  });

  it("still encodes normal segments unchanged", () => {
    expect(enc("info")).toBe("info");
    expect(enc("first.last+tag")).toBe("first.last%2Btag");
  });

  it("percent-encodes @ but keeps wildcards and dots", () => {
    expect(enc("*@trusted.com")).toBe("*%40trusted.com");
  });

  it("encodes the pipe in impersonation-style usernames", () => {
    expect(enc("reseller|user")).toBe("reseller%7Cuser");
  });

  it("leaves plain domains unchanged", () => {
    expect(enc("example.com")).toBe("example.com");
  });

  it("encodes + in local parts", () => {
    expect(enc("first.last+tag")).toBe("first.last%2Btag");
  });
});
