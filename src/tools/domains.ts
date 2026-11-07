import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { enc, unwrapData } from "../client.js";
import type { MxRouteClient } from "../client.js";
import { ok, toErrorResult } from "../errors.js";
import { domainSchema } from "../schemas.js";
import type { ApiEnvelope, Domain } from "../types.js";

/** Unwrapped `Domain` payload; every field except `domain` is optional per the API spec. */
const domainResultSchema = z
  .object({
    domain: z.string(),
    mail_hosting: z.boolean().optional(),
    ssl_enabled: z.boolean().optional(),
    pointers: z.array(z.string()).optional(),
  })
  .loose();

/** Result synthesized for endpoints that return no payload (204 or bare success envelope). */
const messageResultSchema = z.object({ success: z.literal(true), message: z.string() }).loose();

/**
 * Result for endpoints whose success body the spec leaves unspecified: normally
 * the synthesized message, but any object is accepted in case the API wraps a
 * data payload in the envelope after all.
 */
const unspecifiedResultSchema = z.union([messageResultSchema, z.object({}).loose()]);

/**
 * Result for create_domain: normally the created domain, but the synthesized
 * message when the API returns an empty success body, and any object is
 * accepted in case the envelope carries something else.
 */
const createdDomainResultSchema = z.union([
  z.object({ domain: z.string(), ssl_enabled: z.boolean() }).loose(),
  messageResultSchema,
  z.object({}).loose(),
]);

/**
 * Domain management tools: list, create, inspect, and delete domains, and
 * toggle mail hosting per domain.
 */
export function registerDomainTools(server: McpServer, client: MxRouteClient): void {
  server.registerTool(
    "list_domains",
    {
      title: "List Domains",
      description:
        'Lists all domains on the account. Returns an array of domain names, e.g. ["example.com", "mydomain.org"]. Use get_domain for the details of a single domain.',
      inputSchema: z.object({}),
      outputSchema: z.array(z.string()),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      try {
        const res = await client.request<ApiEnvelope<string[]> | null>("GET", "/domains");
        return ok(unwrapData(res));
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "create_domain",
    {
      title: "Create Domain",
      description:
        "Adds a new domain to the account for email hosting. The domain must be verified first: call get_verification_key, then add a TXT record named `<key>.<domain>` with the value `domain-verified` at the registrar, and wait for DNS propagation (typically 5-15 minutes) before calling this tool. Returns the created domain and its ssl_enabled status. A 409 error means the domain already exists on the account.",
      inputSchema: z.object({ domain: domainSchema }),
      outputSchema: createdDomainResultSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ domain }) => {
      try {
        const res = await client.request<ApiEnvelope<{ domain: string; ssl_enabled: boolean }> | null>(
          "POST",
          "/domains",
          { domain },
        );
        return ok(res?.data ?? { success: true, message: "Domain added to the account." });
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "get_domain",
    {
      title: "Get Domain",
      description:
        "Returns the details of one domain: mail hosting status, SSL status, and the names of any domain pointers (aliases) attached to it. Use list_domains to discover the domain names on the account.",
      inputSchema: z.object({ domain: domainSchema }),
      outputSchema: domainResultSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ domain }) => {
      try {
        const res = await client.request<ApiEnvelope<Domain> | null>("GET", `/domains/${enc(domain)}`);
        return ok(unwrapData(res));
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "delete_domain",
    {
      title: "Delete Domain",
      description:
        "Removes the domain from the account. Destructive: mailboxes and forwarders under this domain stop working and mail to the domain is no longer handled. Use set_domain_mail_hosting to pause mail service without deleting the domain.",
      inputSchema: z.object({ domain: domainSchema }),
      outputSchema: messageResultSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ domain }) => {
      try {
        await client.request("DELETE", `/domains/${enc(domain)}`);
        return ok({ success: true, message: `Domain ${domain} removed from the account.` });
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "set_domain_mail_hosting",
    {
      title: "Set Domain Mail Hosting",
      description:
        "Enables or disables mail hosting for a domain. Set enabled=true to have MXroute handle mail for the domain, enabled=false to pause mail hosting. Pure state change: the domain, its mailboxes, and their settings are kept.",
      inputSchema: z.object({
        domain: domainSchema,
        enabled: z
          .boolean()
          .describe("Whether MXroute hosts mail for the domain (true = enable, false = disable)"),
      }),
      outputSchema: unspecifiedResultSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ domain, enabled }) => {
      try {
        const res = await client.request<ApiEnvelope<unknown> | null>(
          "PATCH",
          `/domains/${enc(domain)}/mail-status`,
          { enabled },
        );
        return ok(
          res?.data ?? {
            success: true,
            message: `Mail hosting ${enabled ? "enabled" : "disabled"} for ${domain}.`,
          },
        );
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );
}
