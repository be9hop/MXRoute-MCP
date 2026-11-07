import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";

import { MxRouteClient } from "../src/client.js";
import { registerAccountTools } from "../src/tools/account.js";
import { registerDomainTools } from "../src/tools/domains.js";
import { registerDomainPointerTools } from "../src/tools/pointers.js";
import { registerEmailAccountTools } from "../src/tools/emailAccounts.js";
import { registerForwarderTools } from "../src/tools/forwarders.js";
import { registerSpamTools } from "../src/tools/spam.js";
import { registerDnsTools } from "../src/tools/dns.js";
import { registerCatchAllTools } from "../src/tools/catchAll.js";
import { registerQuotaTools } from "../src/tools/quota.js";
import { registerResellerUserTools } from "../src/tools/resellerUsers.js";
import { registerResellerPackageTools } from "../src/tools/resellerPackages.js";

type Captured = {
  name: string;
  options: any;
  handler: (args: any) => Promise<any>;
};

const BASE_URL = "https://api.test";
const DOMAIN = "example.com";

// Capture every registerTool call with a fake server; the client is real and
// its global fetch is stubbed per test below.
const captured: Captured[] = [];
const fakeServer = {
  registerTool: (name: string, options: any, handler: any) => {
    captured.push({ name, options, handler });
  },
} as unknown as McpServer;

const client = new MxRouteClient({
  apiKey: "k",
  server: "s.mxlogin.com",
  username: "u",
  baseUrl: BASE_URL,
});

registerAccountTools(fakeServer, client);
registerDomainTools(fakeServer, client);
registerDomainPointerTools(fakeServer, client);
registerEmailAccountTools(fakeServer, client);
registerForwarderTools(fakeServer, client);
registerSpamTools(fakeServer, client);
registerDnsTools(fakeServer, client);
registerCatchAllTools(fakeServer, client);
registerQuotaTools(fakeServer, client);
registerResellerUserTools(fakeServer, client);
registerResellerPackageTools(fakeServer, client);

const byName = new Map(captured.map((entry) => [entry.name, entry]));

function tool(name: string): Captured {
  const entry = byName.get(name);
  if (!entry) throw new Error(`tool ${name} was not registered`);
  return entry;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function rawJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

function emptyBody(): Response {
  return new Response(null, { status: 200 });
}

/** Assert the single fetch call the handler made: exact URL, method, and JSON body. */
function expectRequest(method: string, path: string, body?: unknown): void {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe(BASE_URL + path);
  expect(init.method).toBe(method);
  if (body === undefined) {
    expect(init.body).toBeUndefined();
  } else {
    expect(JSON.parse(init.body)).toEqual(body);
  }
}

/** Message result synthesized by the tools when the API returns no payload. */
const SYNTHESIZED = { success: true, message: expect.any(String) };

const EMAIL_ACCOUNT = {
  username: "info",
  email: "info@example.com",
  quota: 1024,
  usage: 12.5,
  limit: 9600,
  sent: 3,
  suspended: false,
};

const RESELLER_USER = {
  username: "johndoe",
  email: "john@example.com",
  domain: "johndoe.example.com",
  package: "basic",
  suspended: false,
  quota: { limit: 2048, used: 12.5, unlimited: false },
};

const PACKAGE = {
  name: "basic",
  settings: {
    quota_gb: 1,
    quota_unlimited: false,
    domains: 1,
    email_accounts: 100,
    email_forwarders: 100,
    domain_pointers: 10,
  },
};

type Row = {
  name: string;
  args: Record<string, unknown>;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  /** "envelope" wraps `data` in {success:true,data}; "raw" returns `data` as-is; "204" is empty. */
  resp: "envelope" | "raw" | "204";
  data?: unknown;
};

const rows: Row[] = [
  // account.ts
  {
    name: "get_verification_key",
    args: {},
    method: "GET",
    path: "/verification-key",
    resp: "envelope",
    data: {
      key: "da-verify-0123456789abcdef0123456789abcdef",
      record: {
        type: "TXT",
        name: "_da-verify-0123456789abcdef0123456789abcdef.example.com",
        value: "domain-verified",
      },
      description: "Domain verification",
    },
  },
  // domains.ts
  {
    name: "list_domains",
    args: {},
    method: "GET",
    path: "/domains",
    resp: "envelope",
    data: ["example.com", "other.org"],
  },
  {
    name: "create_domain",
    args: { domain: DOMAIN },
    method: "POST",
    path: "/domains",
    body: { domain: DOMAIN },
    resp: "envelope",
    data: { domain: DOMAIN, ssl_enabled: true },
  },
  {
    name: "get_domain",
    args: { domain: DOMAIN },
    method: "GET",
    path: "/domains/example.com",
    resp: "envelope",
    data: { domain: DOMAIN, mail_hosting: true, ssl_enabled: true, pointers: ["alias.example.com"] },
  },
  {
    name: "delete_domain",
    args: { domain: DOMAIN },
    method: "DELETE",
    path: "/domains/example.com",
    resp: "204",
  },
  {
    name: "set_domain_mail_hosting",
    args: { domain: DOMAIN, enabled: false },
    method: "PATCH",
    path: "/domains/example.com/mail-status",
    body: { enabled: false },
    resp: "envelope",
    data: { success: true, message: "Mail hosting updated." },
  },
  // pointers.ts
  {
    name: "list_domain_pointers",
    args: { domain: DOMAIN },
    method: "GET",
    path: "/domains/example.com/pointers",
    resp: "envelope",
    data: [{ pointer: "alias.example.com", type: "alias", target: DOMAIN }],
  },
  {
    name: "create_domain_pointer",
    args: { domain: DOMAIN, pointer: "alias.example.com" },
    method: "POST",
    path: "/domains/example.com/pointers",
    body: { pointer: "alias.example.com" },
    resp: "envelope",
    data: { attached: true },
  },
  {
    name: "delete_domain_pointer",
    args: { domain: DOMAIN, pointer: "alias.example.com" },
    method: "DELETE",
    path: "/domains/example.com/pointers/alias.example.com",
    resp: "204",
  },
  // emailAccounts.ts
  {
    name: "list_email_accounts",
    args: { domain: DOMAIN },
    method: "GET",
    path: "/domains/example.com/email-accounts",
    resp: "envelope",
    data: [EMAIL_ACCOUNT],
  },
  {
    name: "create_email_account",
    args: { domain: DOMAIN, username: "info", password: "str0ngPass!" },
    method: "POST",
    path: "/domains/example.com/email-accounts",
    body: { username: "info", password: "str0ngPass!" },
    resp: "envelope",
    data: { created: true },
  },
  {
    name: "get_email_account",
    args: { domain: DOMAIN, user: "info" },
    method: "GET",
    path: "/domains/example.com/email-accounts/info",
    resp: "envelope",
    data: EMAIL_ACCOUNT,
  },
  {
    name: "update_email_account",
    args: { domain: DOMAIN, user: "info", quota: 512 },
    method: "PATCH",
    path: "/domains/example.com/email-accounts/info",
    body: { quota: 512 },
    resp: "envelope",
    data: { updated: true },
  },
  {
    name: "delete_email_account",
    args: { domain: DOMAIN, user: "info" },
    method: "DELETE",
    path: "/domains/example.com/email-accounts/info",
    resp: "204",
  },
  // forwarders.ts
  {
    name: "list_forwarders",
    args: { domain: DOMAIN },
    method: "GET",
    path: "/domains/example.com/forwarders",
    resp: "envelope",
    data: [{ alias: "sales", email: "sales@example.com", destinations: ["boss@example.com"] }],
  },
  {
    name: "create_forwarder",
    args: { domain: DOMAIN, alias: "sales", destinations: ["boss@example.com"] },
    method: "POST",
    path: "/domains/example.com/forwarders",
    body: { alias: "sales", destinations: ["boss@example.com"] },
    resp: "envelope",
    data: { created: true },
  },
  {
    name: "delete_forwarder",
    args: { domain: DOMAIN, alias: "sales" },
    method: "DELETE",
    path: "/domains/example.com/forwarders/sales",
    resp: "204",
  },
  // spam.ts
  {
    name: "get_spam_settings",
    args: { domain: DOMAIN },
    method: "GET",
    path: "/domains/example.com/spam/settings",
    resp: "envelope",
    data: { high_score: 15 },
  },
  {
    name: "update_spam_settings",
    args: { domain: DOMAIN, high_score: 10 },
    method: "PATCH",
    path: "/domains/example.com/spam/settings",
    body: { high_score: 10 },
    resp: "envelope",
    data: { saved: true },
  },
  {
    name: "get_spam_whitelist",
    args: { domain: DOMAIN },
    method: "GET",
    path: "/domains/example.com/spam/whitelist",
    resp: "envelope",
    data: ["*@trusted.com"],
  },
  {
    name: "add_spam_whitelist_entry",
    args: { domain: DOMAIN, entry: "*@trusted.com" },
    method: "POST",
    path: "/domains/example.com/spam/whitelist",
    body: { entry: "*@trusted.com" },
    resp: "envelope",
    data: { added: true },
  },
  {
    name: "remove_spam_whitelist_entry",
    args: { domain: DOMAIN, entry: "*@trusted.com" },
    method: "DELETE",
    path: "/domains/example.com/spam/whitelist/*%40trusted.com",
    resp: "204",
  },
  {
    name: "get_spam_blacklist",
    args: { domain: DOMAIN },
    method: "GET",
    path: "/domains/example.com/spam/blacklist",
    resp: "envelope",
    data: ["spam@example.net"],
  },
  {
    name: "add_spam_blacklist_entry",
    args: { domain: DOMAIN, entry: "spam@example.net" },
    method: "POST",
    path: "/domains/example.com/spam/blacklist",
    body: { entry: "spam@example.net" },
    resp: "envelope",
    data: { added: true },
  },
  {
    name: "remove_spam_blacklist_entry",
    args: { domain: DOMAIN, entry: "spam@example.net" },
    method: "DELETE",
    path: "/domains/example.com/spam/blacklist/spam%40example.net",
    resp: "204",
  },
  // dns.ts
  {
    name: "get_dns_records",
    args: { domain: DOMAIN },
    method: "GET",
    path: "/domains/example.com/dns",
    resp: "envelope",
    data: {
      mx_records: [
        { priority: 10, hostname: "mail1.mxlogin.com" },
        { priority: 20, hostname: "mail2.mxlogin.com" },
      ],
      spf: { type: "TXT", name: DOMAIN, value: "v=spf1 include:mxlogin.com ~all" },
      dkim: { type: "TXT", name: "default._domainkey.example.com", value: "k=rsa; p=..." },
      verification: null,
    },
  },
  // catchAll.ts
  {
    name: "get_catch_all",
    args: { domain: DOMAIN },
    method: "GET",
    path: "/domains/example.com/catch-all",
    resp: "envelope",
    data: { type: "blackhole", address: null },
  },
  {
    name: "set_catch_all",
    args: { domain: DOMAIN, type: "blackhole" },
    method: "PATCH",
    path: "/domains/example.com/catch-all",
    body: { type: "blackhole" },
    resp: "envelope",
    data: { saved: true },
  },
  // quota.ts (NOT enveloped: the raw body IS the payload)
  {
    name: "get_disk_quota",
    args: {},
    method: "GET",
    path: "/quota",
    resp: "raw",
    data: {
      username: "u",
      total_used: 123456,
      total_limit: 0,
      percent_used: 1.2,
      breakdown: { email: 100000, web: 20000, databases: 3456, backups: 0, other: 0 },
      grace_period: null,
      updated_at: "2026-01-01T00:00:00Z",
    },
  },
  {
    name: "get_email_usage",
    args: {},
    method: "GET",
    path: "/quota/email",
    resp: "raw",
    data: {
      username: "u",
      accounts: [
        { email_address: "info@example.com", size_bytes: 5242880, updated_at: "2026-01-01T00:00:00Z" },
      ],
    },
  },
  // resellerUsers.ts
  {
    name: "list_reseller_users",
    args: {},
    method: "GET",
    path: "/reseller/users",
    resp: "envelope",
    data: ["johndoe", "janedoe"],
  },
  {
    name: "create_reseller_user",
    args: { username: "johndoe", email: "john@example.com", password: "str0ngPass!", package: "basic" },
    method: "POST",
    path: "/reseller/users",
    body: { username: "johndoe", email: "john@example.com", password: "str0ngPass!", package: "basic" },
    resp: "envelope",
    data: { created: true },
  },
  {
    name: "get_reseller_user",
    args: { username: "johndoe" },
    method: "GET",
    path: "/reseller/users/johndoe",
    resp: "envelope",
    data: RESELLER_USER,
  },
  {
    name: "update_reseller_user",
    args: { username: "johndoe", quota: "unlimited" },
    method: "PATCH",
    path: "/reseller/users/johndoe",
    body: { quota: "unlimited" },
    resp: "envelope",
    data: { updated: true },
  },
  {
    name: "delete_reseller_user",
    args: { username: "johndoe" },
    method: "DELETE",
    path: "/reseller/users/johndoe",
    resp: "204",
  },
  {
    name: "suspend_reseller_user",
    args: { username: "johndoe" },
    method: "POST",
    path: "/reseller/users/johndoe/suspend",
    resp: "envelope",
    data: { suspended: true },
  },
  {
    name: "unsuspend_reseller_user",
    args: { username: "johndoe" },
    method: "POST",
    path: "/reseller/users/johndoe/unsuspend",
    resp: "envelope",
    data: { suspended: false },
  },
  {
    name: "set_reseller_user_package",
    args: { username: "johndoe", package: "premium" },
    method: "PATCH",
    path: "/reseller/users/johndoe/package",
    body: { package: "premium" },
    resp: "envelope",
    data: { ...RESELLER_USER, package: "premium" },
  },
  // resellerPackages.ts
  {
    name: "list_packages",
    args: {},
    method: "GET",
    path: "/reseller/packages",
    resp: "envelope",
    data: ["basic", "premium"],
  },
  {
    name: "create_package",
    args: { name: "basic" },
    method: "POST",
    path: "/reseller/packages",
    body: { name: "basic" },
    resp: "envelope",
    data: { created: true },
  },
  {
    name: "get_package",
    args: { name: "basic" },
    method: "GET",
    path: "/reseller/packages/basic",
    resp: "envelope",
    data: PACKAGE,
  },
  {
    name: "update_package",
    args: { name: "basic", domains: "unlimited" },
    method: "PATCH",
    path: "/reseller/packages/basic",
    body: { domains: "unlimited" },
    resp: "envelope",
    data: { updated: true },
  },
  {
    name: "delete_package",
    args: { name: "basic" },
    method: "DELETE",
    path: "/reseller/packages/basic",
    resp: "204",
  },
];

describe("registration metadata", () => {
  it("registers exactly 43 tools with unique names", () => {
    expect(captured).toHaveLength(43);
    expect(new Set(captured.map((entry) => entry.name)).size).toBe(43);
  });

  it("every tool has a non-empty description, an outputSchema, and a boolean readOnlyHint", () => {
    expect(captured.length).toBeGreaterThan(0);
    for (const entry of captured) {
      expect(typeof entry.options.description, entry.name).toBe("string");
      expect(entry.options.description.length, entry.name).toBeGreaterThan(0);
      expect(entry.options.outputSchema, entry.name).toBeDefined();
      expect(typeof entry.options.annotations?.readOnlyHint, entry.name).toBe("boolean");
    }
  });
});

describe("happy paths (table-driven, one row per tool)", () => {
  it.each(rows)("$name", async (row) => {
    fetchMock.mockResolvedValueOnce(
      row.resp === "envelope" ? envelope(row.data) : row.resp === "raw" ? rawJson(row.data) : noContent(),
    );
    const result = await tool(row.name).handler(row.args);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(row.resp === "204" ? SYNTHESIZED : row.data);
    expectRequest(row.method, row.path, row.body);
  });
});

/** Tools whose success body the spec leaves unspecified: `res?.data ?? synthesized message`. */
const UNSPECIFIED_BODY_TOOLS = new Set([
  "set_domain_mail_hosting",
  "create_domain",
  "create_domain_pointer",
  "create_email_account",
  "update_email_account",
  "create_forwarder",
  "update_spam_settings",
  "add_spam_whitelist_entry",
  "add_spam_blacklist_entry",
  "set_catch_all",
  "create_reseller_user",
  "update_reseller_user",
  "suspend_reseller_user",
  "unsuspend_reseller_user",
  "create_package",
  "update_package",
]);

describe("unspecified-body writes with an empty 2xx response", () => {
  it.each(rows.filter((row) => UNSPECIFIED_BODY_TOOLS.has(row.name)))(
    "$name synthesizes a message from an empty body",
    async (row) => {
      fetchMock.mockResolvedValueOnce(emptyBody());
      const result = await tool(row.name).handler(row.args);
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual(SYNTHESIZED);
      expectRequest(row.method, row.path, row.body);
    },
  );
});

describe("enveloped tools with a specified body, against an empty 2xx response", () => {
  it("create_domain synthesizes a message instead of null", async () => {
    fetchMock.mockResolvedValueOnce(emptyBody());
    const result = await tool("create_domain").handler({ domain: DOMAIN });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      success: true,
      message: "Domain added to the account.",
    });
    expectRequest("POST", "/domains", { domain: DOMAIN });
  });

  it("set_reseller_user_package synthesizes a message instead of null", async () => {
    fetchMock.mockResolvedValueOnce(emptyBody());
    const result = await tool("set_reseller_user_package").handler({
      username: "johndoe",
      package: "premium",
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      success: true,
      message: "User package updated.",
    });
    expectRequest("PATCH", "/reseller/users/johndoe/package", { package: "premium" });
  });
});

describe("write body formation variants", () => {
  it.each([
    {
      name: "create_domain_pointer",
      args: { domain: DOMAIN, pointer: "alias.example.com", alias: false },
      method: "POST",
      path: "/domains/example.com/pointers",
      body: { pointer: "alias.example.com", alias: false },
    },
    {
      name: "create_email_account",
      args: { domain: DOMAIN, username: "info", password: "str0ngPass!", quota: 2048, limit: 100 },
      method: "POST",
      path: "/domains/example.com/email-accounts",
      body: { username: "info", password: "str0ngPass!", quota: 2048, limit: 100 },
    },
    {
      name: "set_catch_all",
      args: { domain: DOMAIN, type: "address", address: "catchall@example.com" },
      method: "PATCH",
      path: "/domains/example.com/catch-all",
      body: { type: "address", address: "catchall@example.com" },
    },
    {
      name: "create_package",
      args: {
        name: "premium",
        quota: "1",
        domains: "2",
        email_accounts: "100",
        email_forwarders: "50",
        domain_pointers: "10",
      },
      method: "POST",
      path: "/reseller/packages",
      body: {
        name: "premium",
        quota: "1",
        domains: "2",
        email_accounts: "100",
        email_forwarders: "50",
        domain_pointers: "10",
      },
    },
  ])("$name sends only the provided fields, as strings for limit values", async (row) => {
    fetchMock.mockResolvedValueOnce(emptyBody());
    const result = await tool(row.name).handler(row.args);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(SYNTHESIZED);
    expectRequest(row.method, row.path, row.body);
  });
});

describe("create_forwarder special destinations", () => {
  it.each([
    { alias: "spamtrap", destinations: [":blackhole:"] },
    { alias: "abuse", destinations: [":fail:"] },
    { alias: "support", destinations: [":blackhole:", "boss@example.com"] },
  ])("$alias accepts the special values and serializes them as-is", async (row) => {
    const schema = tool("create_forwarder").options.inputSchema;
    const parsed = schema.safeParse({ domain: DOMAIN, alias: row.alias, destinations: row.destinations });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("expected the schema to accept");
    expect(parsed.data.destinations).toEqual(row.destinations);
    fetchMock.mockResolvedValueOnce(emptyBody());
    const result = await tool("create_forwarder").handler({
      domain: DOMAIN,
      alias: row.alias,
      destinations: row.destinations,
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(SYNTHESIZED);
    expectRequest("POST", "/domains/example.com/forwarders", {
      alias: row.alias,
      destinations: row.destinations,
    });
  });

  it("create_forwarder still rejects destinations that are neither emails nor special values", () => {
    const schema = tool("create_forwarder").options.inputSchema;
    const res = schema.safeParse({ domain: DOMAIN, alias: "sales", destinations: ["not-an-email"] });
    expect(res.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("input schema rejections (no fetch)", () => {
  it("update_email_account fails when every mutable field is absent", () => {
    const schema = tool("update_email_account").options.inputSchema;
    const res = schema.safeParse({ domain: DOMAIN, user: "info" });
    expect(res.success).toBe(false);
    if (res.success) throw new Error("expected the schema to reject");
    expect(res.error.issues.map((issue: any) => issue.message).join("; ")).toContain(
      "Provide at least one field to update",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("delete_email_account rejects user values '.' and '..' (dot-segment path traversal)", () => {
    const schema = tool("delete_email_account").options.inputSchema;
    for (const user of [".", ".."]) {
      const res = schema.safeParse({ domain: DOMAIN, user });
      expect(res.success, user).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("delete_forwarder rejects alias values '.' and '..' (dot-segment path traversal)", () => {
    const schema = tool("delete_forwarder").options.inputSchema;
    for (const alias of [".", ".."]) {
      const res = schema.safeParse({ domain: DOMAIN, alias });
      expect(res.success, alias).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("create_reseller_user accepts a 73-char password while create_email_account rejects it", () => {
    const long = "x".repeat(73);
    const reseller = tool("create_reseller_user").options.inputSchema.safeParse({
      username: "johndoe",
      email: "john@example.com",
      password: long,
      package: "basic",
    });
    expect(reseller.success).toBe(true);
    const emailAccount = tool("create_email_account").options.inputSchema.safeParse({
      domain: DOMAIN,
      username: "info",
      password: long,
    });
    expect(emailAccount.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("update_reseller_user fails when quota and password are both absent", () => {
    const schema = tool("update_reseller_user").options.inputSchema;
    const res = schema.safeParse({ username: "johndoe" });
    expect(res.success).toBe(false);
    if (res.success) throw new Error("expected the schema to reject");
    expect(res.error.issues.map((issue: any) => issue.message).join("; ")).toContain(
      "Provide at least one field to update: quota or password.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("update_package fails when every limit field is absent", () => {
    const schema = tool("update_package").options.inputSchema;
    const res = schema.safeParse({ name: "basic" });
    expect(res.success).toBe(false);
    if (res.success) throw new Error("expected the schema to reject");
    expect(res.error.issues.map((issue: any) => issue.message).join("; ")).toContain(
      "Provide at least one field to update: quota, domains, email_accounts, email_forwarders or domain_pointers.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("set_catch_all fails when type is address but address is missing", () => {
    const schema = tool("set_catch_all").options.inputSchema;
    const res = schema.safeParse({ domain: DOMAIN, type: "address" });
    expect(res.success).toBe(false);
    if (res.success) throw new Error("expected the schema to reject");
    expect(res.error.issues.map((issue: any) => issue.message).join("; ")).toContain(
      'address is required when type is "address"',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the domain schema normalizes case and whitespace before the handler runs", () => {
    const schema = tool("get_domain").options.inputSchema;
    const res = schema.safeParse({ domain: "  EXAMPLE.COM  " });
    expect(res.success).toBe(true);
    if (!res.success) throw new Error("expected the schema to accept");
    expect(res.data.domain).toBe("example.com");
  });
});

describe("get_spam_blacklist tolerant response shapes", () => {
  it("returns a bare-array 200 body as the structured content", async () => {
    fetchMock.mockResolvedValueOnce(rawJson(["spam@example.net", "*@evil.com"]));
    const result = await tool("get_spam_blacklist").handler({ domain: DOMAIN });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(["spam@example.net", "*@evil.com"]);
    expectRequest("GET", "/domains/example.com/spam/blacklist");
  });

  it("returns [] for an empty 200 body", async () => {
    fetchMock.mockResolvedValueOnce(emptyBody());
    const result = await tool("get_spam_blacklist").handler({ domain: DOMAIN });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual([]);
    expectRequest("GET", "/domains/example.com/spam/blacklist");
  });

  it("reports [SERVER_ERROR] for a body with neither a bare array nor an array data field", async () => {
    fetchMock.mockResolvedValueOnce(rawJson({ success: true }));
    const result = await tool("get_spam_blacklist").handler({ domain: DOMAIN });
    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("[SERVER_ERROR]");
    expect(result.structuredContent).toBeUndefined();
  });
});

/** The 15 enveloped read tools whose payload goes through unwrapData. */
const UNWRAP_READ_TOOLS = new Set([
  "list_domains",
  "get_domain",
  "list_domain_pointers",
  "list_email_accounts",
  "get_email_account",
  "list_forwarders",
  "get_spam_settings",
  "get_spam_whitelist",
  "get_dns_records",
  "get_catch_all",
  "get_verification_key",
  "list_reseller_users",
  "get_reseller_user",
  "list_packages",
  "get_package",
]);

describe("enveloped reads against an empty 2xx response (unwrapData path)", () => {
  it.each(rows.filter((row) => UNWRAP_READ_TOOLS.has(row.name)))(
    "$name reports [SERVER_ERROR] instead of returning null",
    async (row) => {
      fetchMock.mockResolvedValueOnce(emptyBody());
      const result = await tool(row.name).handler(row.args);
      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain("[SERVER_ERROR]");
      expect(result.content[0].text).toContain("unexpected empty response");
      expect(result.structuredContent).toBeUndefined();
    },
  );
});

describe("quota reads against an empty 2xx response (requireBody path)", () => {
  it.each(["get_disk_quota", "get_email_usage"])(
    "%s reports [SERVER_ERROR] instead of returning null",
    async (name) => {
      fetchMock.mockResolvedValueOnce(emptyBody());
      const result = await tool(name).handler({});
      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain("[SERVER_ERROR]");
      expect(result.content[0].text).toContain("unexpected empty response");
      expect(result.structuredContent).toBeUndefined();
    },
  );
});

describe("mid-body abort during a tool call", () => {
  it("surfaces TIMEOUT as an error result when the response body read is aborted", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: new Headers(),
      text: () => Promise.reject(new DOMException("aborted", "TimeoutError")),
    } as unknown as Response);
    const result = await tool("get_domain").handler({ domain: DOMAIN });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("TIMEOUT");
  });
});

describe("delete-tool description guidance", () => {
  it.each(["delete_email_account", "delete_forwarder"])(
    "%s tells the agent to read back exact casing, stays under 90 words, keeps annotations",
    (name) => {
      const description = tool(name).options.description as string;
      expect(description.toLowerCase()).toContain("casing");
      expect(description.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(90);
      expect(tool(name).options.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
      });
    },
  );
});

describe("error paths", () => {
  it("maps an API error envelope to an isError result with [CODE] text", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: { code: "NOT_FOUND", message: "Resource not found" },
        }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      ),
    );
    const result = await tool("get_domain").handler({ domain: DOMAIN });
    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("[NOT_FOUND]");
    expect(result.content[0].text).toContain("Resource not found");
    expect(result.content[0].text).toContain("Hint:");
    expect(result.structuredContent).toBeUndefined();
  });

  it("reports CONFIG_MISSING without touching fetch when the client has no config", async () => {
    const nullCaptured: Captured[] = [];
    const nullServer = {
      registerTool: (name: string, options: any, handler: any) => {
        nullCaptured.push({ name, options, handler });
      },
    } as unknown as McpServer;
    registerDomainTools(nullServer, new MxRouteClient(null));
    const result = await nullCaptured[0].handler({}); // list_domains
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("CONFIG_MISSING");
    expect(result.content[0].text).toContain("MXROUTE_SERVER");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the Retry-After wait in the rate-limit error text", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: { code: "RATE_LIMITED", message: "Too many requests" },
        }),
        { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "17" } },
      ),
    );
    const result = await tool("list_domains").handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("17s");
  });
});

describe("result content shape", () => {
  it("success results mirror structuredContent as pretty-printed text", async () => {
    fetchMock.mockResolvedValueOnce(envelope(["example.com", "other.org"]));
    const result = await tool("list_domains").handler({});
    expect(result.content).toEqual([
      { type: "text", text: JSON.stringify(result.structuredContent, null, 2) },
    ]);
  });
});
