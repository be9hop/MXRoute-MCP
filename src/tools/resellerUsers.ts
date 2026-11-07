import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { MxRouteClient } from "../client.js";
import { enc, unwrapData } from "../client.js";
import { ok, toErrorResult } from "../errors.js";
import { limitValueSchema, resellerPasswordSchema, resellerUsernameSchema } from "../schemas.js";
import type { ApiEnvelope, ResellerUser } from "../types.js";

/** Unwrapped `data` payload of the enveloped ResellerUser endpoints. */
const resellerUserOutputSchema = z
  .object({
    username: z.string(),
    email: z.string(),
    domain: z.string(),
    package: z.string(),
    suspended: z.boolean(),
    quota: z
      .object({
        limit: z.number().nullable(),
        used: z.number(),
        unlimited: z.boolean(),
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
 * Result for set_reseller_user_package: normally the updated user, but the
 * synthesized message when the API returns an empty success body, and any
 * object is accepted in case the envelope carries something else.
 */
const setPackageResultOutputSchema = z.union([
  resellerUserOutputSchema,
  successOutputSchema,
  z.object({}).loose(),
]);

/**
 * Register the reseller user tools (API tag "Reseller Users"). Every tool is a
 * reseller-level operation: it must be called while authenticated as the
 * reseller (plain reseller username), not while impersonating a user
 * (X-Username `reseller|user`), and returns 403 otherwise.
 */
export function registerResellerUserTools(server: McpServer, client: MxRouteClient): void {
  server.registerTool(
    "list_reseller_users",
    {
      title: "List Reseller Users",
      description:
        "Lists the usernames of all users under the reseller account. Reseller-level operation: call while authenticated as the reseller (plain reseller username), not while impersonating a user. A 403 means the credential lacks reseller privileges or is impersonating.",
      inputSchema: z.object({}),
      outputSchema: z.array(z.string()),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      try {
        const res = await client.request<ApiEnvelope<string[]> | null>("GET", "/reseller/users");
        return ok(unwrapData(res));
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "create_reseller_user",
    {
      title: "Create Reseller User",
      description:
        "Creates a user under the reseller account with the given username, contact email, password, and package. Reseller-level operation: call while authenticated as the reseller (plain reseller username), not while impersonating a user. The package must already exist (see list_packages); 422 means it does not.",
      inputSchema: z.object({
        username: resellerUsernameSchema,
        email: z.string().email().describe("Contact email address for the user"),
        password: resellerPasswordSchema,
        package: z.string().describe("Existing package name to assign (see list_packages)"),
      }),
      outputSchema: unspecifiedResultOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      try {
        const res = await client.request<ApiEnvelope<unknown> | null>("POST", "/reseller/users", {
          username: args.username,
          email: args.email,
          password: args.password,
          package: args.package,
        });
        return ok(res?.data ?? { success: true, message: `Created reseller user ${args.username}.` });
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "get_reseller_user",
    {
      title: "Get Reseller User",
      description:
        "Returns one reseller user's details: username, email, domain, package, suspended flag, and quota (limit in MB, null when unlimited). Reseller-level operation: call while authenticated as the reseller (plain reseller username), not while impersonating a user. A 404 means the user does not exist.",
      inputSchema: z.object({
        username: resellerUsernameSchema,
      }),
      outputSchema: resellerUserOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const res = await client.request<ApiEnvelope<ResellerUser> | null>(
          "GET",
          `/reseller/users/${enc(args.username)}`,
        );
        return ok(unwrapData(res));
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "update_reseller_user",
    {
      title: "Update Reseller User",
      description:
        "Updates a reseller user's disk quota and/or password. Only provided fields are sent; the rest keep their current values. Reseller-level operation: call while authenticated as the reseller (plain reseller username), not while impersonating a user. A 404 means the user does not exist.",
      inputSchema: z
        .object({
          username: resellerUsernameSchema,
          quota: limitValueSchema
            .optional()
            .describe('Disk quota in MB or "unlimited"; omit to keep the current quota'),
          password: resellerPasswordSchema
            .optional()
            .describe(
              "New login password for the user (minimum 8 characters, no maximum); omit to keep the current password",
            ),
        })
        .superRefine((value, ctx) => {
          if (value.quota === undefined && value.password === undefined) {
            ctx.addIssue({
              code: "custom",
              message: "Provide at least one field to update: quota or password.",
            });
          }
        }),
      outputSchema: unspecifiedResultOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const body: { quota?: string; password?: string } = {};
        if (args.quota !== undefined) body.quota = args.quota;
        if (args.password !== undefined) body.password = args.password;
        const res = await client.request<ApiEnvelope<unknown> | null>(
          "PATCH",
          `/reseller/users/${enc(args.username)}`,
          body,
        );
        return ok(res?.data ?? { success: true, message: `Updated reseller user ${args.username}.` });
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "delete_reseller_user",
    {
      title: "Delete Reseller User",
      description:
        "Destructive: deletes the user and everything under it, irreversibly. Per DirectAdmin behavior the deletion may fail or cascade, so double-check the username first. Reseller-level operation: call while authenticated as the reseller (plain reseller username), not while impersonating a user. A 404 means the user does not exist.",
      inputSchema: z.object({
        username: resellerUsernameSchema,
      }),
      outputSchema: successOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async (args) => {
      try {
        await client.request("DELETE", `/reseller/users/${enc(args.username)}`);
        return ok({ success: true, message: `Deleted reseller user ${args.username}.` });
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "suspend_reseller_user",
    {
      title: "Suspend Reseller User",
      description:
        "Suspends a reseller user, blocking their access without deleting data. Repeating the call is harmless. Reseller-level operation: call while authenticated as the reseller (plain reseller username), not while impersonating a user. A 404 means the user does not exist.",
      inputSchema: z.object({
        username: resellerUsernameSchema,
      }),
      outputSchema: unspecifiedResultOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const res = await client.request<ApiEnvelope<unknown> | null>(
          "POST",
          `/reseller/users/${enc(args.username)}/suspend`,
        );
        return ok(res?.data ?? { success: true, message: `Suspended reseller user ${args.username}.` });
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "unsuspend_reseller_user",
    {
      title: "Unsuspend Reseller User",
      description:
        "Reverses the suspension of a reseller user, restoring their access. Repeating the call is harmless. Reseller-level operation: call while authenticated as the reseller (plain reseller username), not while impersonating a user. A 404 means the user does not exist.",
      inputSchema: z.object({
        username: resellerUsernameSchema,
      }),
      outputSchema: unspecifiedResultOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const res = await client.request<ApiEnvelope<unknown> | null>(
          "POST",
          `/reseller/users/${enc(args.username)}/unsuspend`,
        );
        return ok(res?.data ?? { success: true, message: `Unsuspended reseller user ${args.username}.` });
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "set_reseller_user_package",
    {
      title: "Set Reseller User Package",
      description:
        "Moves a reseller user to a different package and returns the updated user. Changing the package can change the quota and limits of every domain under the user. A 422 means the package does not exist (see list_packages). Reseller-level operation: call while authenticated as the reseller (plain reseller username), not while impersonating a user.",
      inputSchema: z.object({
        username: resellerUsernameSchema,
        package: z.string().describe("Name of the package to assign (see list_packages)"),
      }),
      outputSchema: setPackageResultOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const res = await client.request<ApiEnvelope<ResellerUser> | null>(
          "PATCH",
          `/reseller/users/${enc(args.username)}/package`,
          { package: args.package },
        );
        return ok(res?.data ?? { success: true, message: "User package updated." });
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );
}
