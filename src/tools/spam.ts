import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { enc, unwrapData, type MxRouteClient } from "../client.js";
import { ApiError, ok, toErrorResult } from "../errors.js";
import { domainSchema, highScoreSchema, spamEntrySchema } from "../schemas.js";
import type { ApiEnvelope } from "../types.js";

/** Shape synthesized when the API returns no body (add/remove/update). */
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

/**
 * Spam settings tools. Sender lists (whitelist/blacklist) are shared across
 * the account's domains; entries match case-insensitively, so adding a
 * duplicate returns 409 and writes are serialized account-wide (503 means
 * another update is in progress).
 */
export function registerSpamTools(server: McpServer, client: MxRouteClient): void {
  server.registerTool(
    "get_spam_settings",
    {
      title: "Get Spam Settings",
      description:
        "Returns the spam settings for a domain. `high_score` is the SpamAssassin-style score threshold (1-50) at which incoming mail is automatically deleted.",
      inputSchema: z.object({ domain: domainSchema }),
      outputSchema: z
        .object({
          high_score: z.number(),
        })
        .loose(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const { domain } = args;
        const res = await client.request<ApiEnvelope<{ high_score: number }> | null>(
          "GET",
          `/domains/${enc(domain)}/spam/settings`,
        );
        return ok(unwrapData(res));
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "update_spam_settings",
    {
      title: "Update Spam Settings",
      description:
        "Sets the spam auto-deletion threshold (`high_score`, integer 1-50) for a domain. Lower values delete more aggressively; higher values keep more mail. Writes are serialized account-wide: if a save fails (for example 503), re-read the settings before retrying.",
      inputSchema: z.object({
        domain: domainSchema,
        high_score: highScoreSchema,
      }),
      outputSchema: unspecifiedResultOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const { domain, high_score } = args;
        const res = await client.request<ApiEnvelope<unknown> | null>(
          "PATCH",
          `/domains/${enc(domain)}/spam/settings`,
          { high_score },
        );
        return ok(
          res?.data ?? {
            success: true,
            message: `Spam settings updated for ${domain}: high_score is now ${high_score}.`,
          },
        );
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "get_spam_whitelist",
    {
      title: "Get Spam Whitelist",
      description:
        "Lists the spam whitelist entries for a domain. Whitelisted senders bypass spam filtering. Entries support wildcards (for example `*@trusted.com`) and match case-insensitively. Sender lists are shared across all domains on the account.",
      inputSchema: z.object({ domain: domainSchema }),
      outputSchema: z.array(z.string()),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const { domain } = args;
        const res = await client.request<ApiEnvelope<string[]> | null>(
          "GET",
          `/domains/${enc(domain)}/spam/whitelist`,
        );
        return ok(unwrapData(res));
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "add_spam_whitelist_entry",
    {
      title: "Add Spam Whitelist Entry",
      description:
        "Adds an entry to the spam whitelist; whitelisted senders bypass spam filtering. Supports wildcards (for example `*@trusted.com`). A 409 error means the entry already exists (entries match case-insensitively). Sender lists are shared across all domains on the account.",
      inputSchema: z.object({
        domain: domainSchema,
        entry: spamEntrySchema,
      }),
      outputSchema: unspecifiedResultOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      try {
        const { domain, entry } = args;
        const res = await client.request<ApiEnvelope<unknown> | null>(
          "POST",
          `/domains/${enc(domain)}/spam/whitelist`,
          { entry },
        );
        return ok(
          res?.data ?? {
            success: true,
            message: `Added ${entry} to the spam whitelist for ${domain}.`,
          },
        );
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "remove_spam_whitelist_entry",
    {
      title: "Remove Spam Whitelist Entry",
      description:
        "Removes an entry from the spam whitelist. Entries match case-insensitively, so the stored casing may differ. Sender lists are shared across all domains on the account, so this affects every domain on the account.",
      inputSchema: z.object({
        domain: domainSchema,
        entry: spamEntrySchema,
      }),
      outputSchema: actionResultOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async (args) => {
      try {
        const { domain, entry } = args;
        await client.request(
          "DELETE",
          `/domains/${enc(domain)}/spam/whitelist/${enc(entry)}`,
        );
        return ok({
          success: true,
          message: `Removed ${entry} from the spam whitelist for ${domain}.`,
        });
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "get_spam_blacklist",
    {
      title: "Get Spam Blacklist",
      description:
        "Lists the spam blacklist entries for a domain. Blacklisted senders are always treated as spam. Entries support wildcards (for example `*@example.com`) and match case-insensitively. Sender lists are shared across all domains on the account. An empty 200 response is treated as an empty list.",
      inputSchema: z.object({ domain: domainSchema }),
      outputSchema: z
        .union([z.array(z.string()), z.object({}).loose()])
        .describe("Blacklist entries; an empty 200 response is treated as an empty list"),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const { domain } = args;
        const body = await client.request<string[] | ApiEnvelope<string[]> | null>(
          "GET",
          `/domains/${enc(domain)}/spam/blacklist`,
        );
        if (body === null) return ok([]);
        if (Array.isArray(body)) return ok(body);
        if (Array.isArray(body.data)) return ok(body.data);
        throw new ApiError(
          "SERVER_ERROR",
          "Unexpected response shape from the spam blacklist endpoint.",
          undefined,
          "Retry the call; if it persists, the API contract may have changed.",
        );
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "add_spam_blacklist_entry",
    {
      title: "Add Spam Blacklist Entry",
      description:
        "Adds an entry to the spam blacklist; blacklisted senders are always treated as spam. Supports wildcards (for example `*@example.com`). A 409 error means the entry already exists (entries match case-insensitively). Sender lists are shared across all domains on the account.",
      inputSchema: z.object({
        domain: domainSchema,
        entry: spamEntrySchema,
      }),
      outputSchema: unspecifiedResultOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      try {
        const { domain, entry } = args;
        const res = await client.request<ApiEnvelope<unknown> | null>(
          "POST",
          `/domains/${enc(domain)}/spam/blacklist`,
          { entry },
        );
        return ok(
          res?.data ?? {
            success: true,
            message: `Added ${entry} to the spam blacklist for ${domain}.`,
          },
        );
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "remove_spam_blacklist_entry",
    {
      title: "Remove Spam Blacklist Entry",
      description:
        "Removes an entry from the spam blacklist. Entries match case-insensitively, so the stored casing may differ. Sender lists are shared across all domains on the account, so this affects every domain on the account.",
      inputSchema: z.object({
        domain: domainSchema,
        entry: spamEntrySchema,
      }),
      outputSchema: actionResultOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async (args) => {
      try {
        const { domain, entry } = args;
        await client.request(
          "DELETE",
          `/domains/${enc(domain)}/spam/blacklist/${enc(entry)}`,
        );
        return ok({
          success: true,
          message: `Removed ${entry} from the spam blacklist for ${domain}.`,
        });
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );
}
