import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { MxRouteClient } from "../client.js";
import { enc, unwrapData } from "../client.js";
import { ok, toErrorResult } from "../errors.js";
import { limitValueSchema } from "../schemas.js";
import type { ApiEnvelope, Package } from "../types.js";

/** Package name; the same rules apply to creation and to path parameters. */
const packageNameSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]+$/, "Package names may only contain letters, numbers, underscores, and hyphens")
  .describe("Package name (letters, numbers, underscores, hyphens)");

/** Unwrapped `data` payload of the enveloped Package endpoints. */
const packageOutputSchema = z
  .object({
    name: z.string(),
    settings: z
      .object({
        quota_gb: z.number().nullable(),
        quota_unlimited: z.boolean(),
        domains: z.number().nullable(),
        email_accounts: z.number().nullable(),
        email_forwarders: z.number().nullable(),
        domain_pointers: z.number().nullable(),
      })
      .loose(),
  })
  .loose();

/** Synthesized payload for endpoints whose success body is unspecified or empty. */
const successOutputSchema = z
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
const unspecifiedResultOutputSchema = z.union([successOutputSchema, z.object({}).loose()]);

/**
 * Register the reseller package tools (API tag "Reseller Packages"). Every
 * tool is a reseller-level operation: it must be called while authenticated as
 * the reseller (plain reseller username), not while impersonating a user
 * (X-Username `reseller|user`), and returns 403 otherwise.
 */
export function registerResellerPackageTools(server: McpServer, client: MxRouteClient): void {
  server.registerTool(
    "list_packages",
    {
      title: "List Packages",
      description:
        "Lists the names of all packages defined under the reseller account. Reseller-level operation: call while authenticated as the reseller (plain reseller username), not while impersonating a user. A 403 means the credential lacks reseller privileges or is impersonating.",
      inputSchema: z.object({}),
      outputSchema: z.array(z.string()),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      try {
        const res = await client.request<ApiEnvelope<string[]> | null>("GET", "/reseller/packages");
        return ok(unwrapData(res));
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "create_package",
    {
      title: "Create Package",
      description:
        "Creates a package that reseller users can be assigned to. Unset limits take the API defaults: quota 1 GB, 1 domain, 100 email accounts, 100 email forwarders, 10 domain pointers. Reseller-level operation: call while authenticated as the reseller (plain reseller username), not while impersonating a user.",
      inputSchema: z.object({
        name: packageNameSchema,
        quota: limitValueSchema.optional().describe('Disk quota in GB or "unlimited" (default 1)'),
        domains: limitValueSchema.optional().describe('Domain count or "unlimited" (default 1)'),
        email_accounts: limitValueSchema.optional().describe(
          'Customer mailbox count or "unlimited" (default 100; 0 = no customer mailboxes — the system mailbox is excluded)',
        ),
        email_forwarders: limitValueSchema
          .optional()
          .describe('Email forwarder count or "unlimited" (default 100)'),
        domain_pointers: limitValueSchema
          .optional()
          .describe('Domain pointer count or "unlimited" (default 10)'),
      }),
      outputSchema: unspecifiedResultOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      try {
        const body: {
          name: string;
          quota?: string;
          domains?: string;
          email_accounts?: string;
          email_forwarders?: string;
          domain_pointers?: string;
        } = { name: args.name };
        if (args.quota !== undefined) body.quota = args.quota;
        if (args.domains !== undefined) body.domains = args.domains;
        if (args.email_accounts !== undefined) body.email_accounts = args.email_accounts;
        if (args.email_forwarders !== undefined) body.email_forwarders = args.email_forwarders;
        if (args.domain_pointers !== undefined) body.domain_pointers = args.domain_pointers;
        const res = await client.request<ApiEnvelope<unknown> | null>("POST", "/reseller/packages", body);
        return ok(res?.data ?? { success: true, message: `Created package ${args.name}.` });
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "get_package",
    {
      title: "Get Package",
      description:
        "Returns one package's settings: quota_gb (null when unlimited), domains, email_accounts, email_forwarders, and domain_pointers limits (null = unlimited; email_accounts excludes the system mailbox). Reseller-level operation: call while authenticated as the reseller (plain reseller username), not while impersonating a user. A 404 means the package does not exist.",
      inputSchema: z.object({
        name: packageNameSchema,
      }),
      outputSchema: packageOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const res = await client.request<ApiEnvelope<Package> | null>(
          "GET",
          `/reseller/packages/${enc(args.name)}`,
        );
        return ok(unwrapData(res));
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "update_package",
    {
      title: "Update Package",
      description:
        "Updates a package's limits; only provided fields are sent, the rest keep their current values. Quota is in GB here (the reseller user quota endpoint uses MB). Changes affect every user on the package. Reseller-level operation: call while authenticated as the reseller (plain reseller username), not while impersonating a user. A 404 means the package does not exist.",
      inputSchema: z
        .object({
          name: packageNameSchema,
          quota: limitValueSchema
            .optional()
            .describe('Disk quota in GB or "unlimited"; omit to keep the current value'),
          domains: limitValueSchema
            .optional()
            .describe('Domain count or "unlimited"; omit to keep the current value'),
          email_accounts: limitValueSchema.optional().describe(
            'Customer mailbox count or "unlimited" (0 = no customer mailboxes — the system mailbox is excluded); omit to keep the current value',
          ),
          email_forwarders: limitValueSchema
            .optional()
            .describe('Email forwarder count or "unlimited"; omit to keep the current value'),
          domain_pointers: limitValueSchema
            .optional()
            .describe('Domain pointer count or "unlimited"; omit to keep the current value'),
        })
        .superRefine((value, ctx) => {
          if (
            value.quota === undefined &&
            value.domains === undefined &&
            value.email_accounts === undefined &&
            value.email_forwarders === undefined &&
            value.domain_pointers === undefined
          ) {
            ctx.addIssue({
              code: "custom",
              message:
                "Provide at least one field to update: quota, domains, email_accounts, email_forwarders or domain_pointers.",
            });
          }
        }),
      outputSchema: unspecifiedResultOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const body: {
          quota?: string;
          domains?: string;
          email_accounts?: string;
          email_forwarders?: string;
          domain_pointers?: string;
        } = {};
        if (args.quota !== undefined) body.quota = args.quota;
        if (args.domains !== undefined) body.domains = args.domains;
        if (args.email_accounts !== undefined) body.email_accounts = args.email_accounts;
        if (args.email_forwarders !== undefined) body.email_forwarders = args.email_forwarders;
        if (args.domain_pointers !== undefined) body.domain_pointers = args.domain_pointers;
        const res = await client.request<ApiEnvelope<unknown> | null>(
          "PATCH",
          `/reseller/packages/${enc(args.name)}`,
          body,
        );
        return ok(res?.data ?? { success: true, message: `Updated package ${args.name}.` });
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "delete_package",
    {
      title: "Delete Package",
      description:
        "Deletes a package. Fails with 422 while any user is still on the package; move affected users to another package first (set_reseller_user_package). Reseller-level operation: call while authenticated as the reseller (plain reseller username), not while impersonating a user. A 404 means the package does not exist.",
      inputSchema: z.object({
        name: packageNameSchema,
      }),
      outputSchema: successOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async (args) => {
      try {
        await client.request("DELETE", `/reseller/packages/${enc(args.name)}`);
        return ok({ success: true, message: `Deleted package ${args.name}.` });
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );
}
