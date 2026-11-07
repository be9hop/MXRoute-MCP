import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { enc, unwrapData, type MxRouteClient } from "../client.js";
import { ok, toErrorResult } from "../errors.js";
import { domainSchema, localPartSchema } from "../schemas.js";
import type { ApiEnvelope, Forwarder } from "../types.js";

/** Unwrapped `Forwarder` payload shared by the forwarder tools. */
const forwarderOutputSchema = z
  .object({
    alias: z.string(),
    email: z.string(),
    destinations: z.array(z.string()),
  })
  .loose();

/** Shape synthesized when the API returns no body (create/delete). */
const actionResultOutputSchema = z
  .object({
    success: z.literal(true),
    message: z.string(),
  })
  .loose();

/**
 * Result for endpoints whose success body the spec leaves unspecified: normally
 * the synthesized message, but any object is accepted in case the API wraps a
 * data payload in the envelope after all.
 */
const unspecifiedResultOutputSchema = z.union([actionResultOutputSchema, z.object({}).loose()]);

/** Email forwarder tools (list, create, delete) for a domain. */
export function registerForwarderTools(server: McpServer, client: MxRouteClient): void {
  server.registerTool(
    "list_forwarders",
    {
      title: "List Forwarders",
      description:
        "Lists all email forwarders on a domain. Each entry carries the alias (local part), the full forwarder email address, and the destination addresses it forwards to.",
      inputSchema: z.object({ domain: domainSchema }),
      outputSchema: z.array(forwarderOutputSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const { domain } = args;
        const res = await client.request<ApiEnvelope<Forwarder[]> | null>(
          "GET",
          `/domains/${enc(domain)}/forwarders`,
        );
        return ok(unwrapData(res));
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "create_forwarder",
    {
      title: "Create Forwarder",
      description:
        "Creates an email forwarder for an alias on a domain. Special destinations: `:blackhole:` silently discards mail and `:fail:` rejects it. Forwarding to Gmail, Yahoo, AOL and similar providers automatically enables Expert Spam Filtering for the domain to protect its sending reputation.",
      inputSchema: z.object({
        domain: domainSchema,
        alias: localPartSchema,
        destinations: z
          .array(z.union([z.string().email(), z.literal(":blackhole:"), z.literal(":fail:")]))
          .min(1)
          .describe(
            "Destination email addresses (at least one); the special values :blackhole: (silently discard mail) and :fail: (reject mail) are also accepted",
          ),
      }),
      outputSchema: unspecifiedResultOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      try {
        const { domain, alias, destinations } = args;
        const res = await client.request<ApiEnvelope<unknown> | null>(
          "POST",
          `/domains/${enc(domain)}/forwarders`,
          { alias, destinations },
        );
        return ok(
          res?.data ?? {
            success: true,
            message: `Forwarder ${alias}@${domain} created.`,
          },
        );
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "delete_forwarder",
    {
      title: "Delete Forwarder",
      description:
        "Deletes an email forwarder by its alias. Mail sent to the alias is no longer forwarded after deletion. Read the alias's exact stored casing back from list_forwarders before deleting, and pass it unchanged.",
      inputSchema: z.object({
        domain: domainSchema,
        alias: localPartSchema,
      }),
      outputSchema: actionResultOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async (args) => {
      try {
        const { domain, alias } = args;
        await client.request(
          "DELETE",
          `/domains/${enc(domain)}/forwarders/${enc(alias)}`,
        );
        return ok({
          success: true,
          message: `Forwarder ${alias}@${domain} deleted.`,
        });
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );
}
