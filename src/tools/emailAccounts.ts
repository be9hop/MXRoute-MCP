import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { enc, unwrapData } from "../client.js";
import type { MxRouteClient } from "../client.js";
import { ok, toErrorResult } from "../errors.js";
import {
  domainSchema,
  localPartSchema,
  passwordSchema,
  quotaMbSchema,
  sendLimitSchema,
} from "../schemas.js";
import type { ApiEnvelope, EmailAccount } from "../types.js";

/** Unwrapped `EmailAccount` payload. */
const emailAccountResultSchema = z
  .object({
    username: z.string(),
    email: z.string(),
    /** Storage quota in MB (0 = unlimited). */
    quota: z.number(),
    /** Current usage in MB. */
    usage: z.number(),
    /** Daily send limit. */
    limit: z.number(),
    /** Emails sent today. */
    sent: z.number(),
    suspended: z.boolean(),
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
 * Email account (mailbox) tools: list, create, inspect, update, and delete the
 * mailboxes under a domain.
 */
export function registerEmailAccountTools(server: McpServer, client: MxRouteClient): void {
  server.registerTool(
    "list_email_accounts",
    {
      title: "List Email Accounts",
      description:
        "Lists the mailboxes under a domain. Each entry includes the local part, full email address, quota in MB (0 = unlimited), current usage in MB, daily send limit, messages sent today, and suspended status.",
      inputSchema: z.object({ domain: domainSchema }),
      outputSchema: z.array(emailAccountResultSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ domain }) => {
      try {
        const res = await client.request<ApiEnvelope<EmailAccount[]> | null>(
          "GET",
          `/domains/${enc(domain)}/email-accounts`,
        );
        return ok(unwrapData(res));
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "create_email_account",
    {
      title: "Create Email Account",
      description:
        "Creates a mailbox under a domain. username is the local part before the @; password is 8-72 characters (the mail server additionally enforces its own character and strength rules server-side). quota is the storage limit in MB; limit is the daily send limit. Omitted quota and limit use the API defaults.",
      inputSchema: z.object({
        domain: domainSchema,
        username: localPartSchema,
        password: passwordSchema,
        quota: quotaMbSchema
          .describe("Storage quota in MB (integer; 0 = unlimited; default 1024)")
          .optional(),
        limit: sendLimitSchema.describe("Daily send limit (integer 0-9600; default 9600)").optional(),
      }),
      outputSchema: unspecifiedResultSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ domain, username, password, quota, limit }) => {
      try {
        const body: Record<string, unknown> = { username, password };
        if (quota !== undefined) body.quota = quota;
        if (limit !== undefined) body.limit = limit;
        const res = await client.request<ApiEnvelope<unknown> | null>(
          "POST",
          `/domains/${enc(domain)}/email-accounts`,
          body,
        );
        return ok(
          res?.data ?? { success: true, message: `Email account ${username}@${domain} created.` },
        );
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "get_email_account",
    {
      title: "Get Email Account",
      description:
        "Returns the details of one mailbox: username, full email address, quota in MB (0 = unlimited), current usage in MB, daily send limit, messages sent today, and suspended status. user is the mailbox local part (the part before the @).",
      inputSchema: z.object({ domain: domainSchema, user: localPartSchema }),
      outputSchema: emailAccountResultSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ domain, user }) => {
      try {
        const res = await client.request<ApiEnvelope<EmailAccount> | null>(
          "GET",
          `/domains/${enc(domain)}/email-accounts/${enc(user)}`,
        );
        return ok(unwrapData(res));
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "update_email_account",
    {
      title: "Update Email Account",
      description:
        "Updates a mailbox's password, storage quota, or daily send limit. Only provided fields change; omitted fields keep their current values. The mailbox is looked up case-insensitively by local part. Password rejections (outside 8-72 characters or failing server-side strength rules) return field-specific errors naming the password field.",
      inputSchema: z
        .object({
          domain: domainSchema,
          user: localPartSchema,
          password: passwordSchema.optional(),
          quota: quotaMbSchema.optional(),
          limit: sendLimitSchema.optional(),
        })
        .superRefine((value, ctx) => {
          if (value.password === undefined && value.quota === undefined && value.limit === undefined) {
            ctx.addIssue({
              code: "custom",
              message: "Provide at least one field to update: password, quota, or limit.",
            });
          }
        }),
      outputSchema: unspecifiedResultSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ domain, user, password, quota, limit }) => {
      try {
        const body: Record<string, unknown> = {};
        if (password !== undefined) body.password = password;
        if (quota !== undefined) body.quota = quota;
        if (limit !== undefined) body.limit = limit;
        const res = await client.request<ApiEnvelope<unknown> | null>(
          "PATCH",
          `/domains/${enc(domain)}/email-accounts/${enc(user)}`,
          body,
        );
        return ok(
          res?.data ?? { success: true, message: `Email account ${user}@${domain} updated.` },
        );
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "delete_email_account",
    {
      title: "Delete Email Account",
      description:
        "Permanently deletes a mailbox and its stored mail. Destructive and irreversible: the address immediately stops accepting mail. user is the mailbox local part (the part before the @). Read the exact username casing back from list_email_accounts or get_email_account before deleting: updates resolve the local part case-insensitively and reject an ambiguous match, but deletes should use the exact stored casing.",
      inputSchema: z.object({ domain: domainSchema, user: localPartSchema }),
      outputSchema: messageResultSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ domain, user }) => {
      try {
        await client.request("DELETE", `/domains/${enc(domain)}/email-accounts/${enc(user)}`);
        return ok({ success: true, message: `Email account ${user}@${domain} deleted.` });
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );
}
