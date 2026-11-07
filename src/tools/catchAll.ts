import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { enc, unwrapData, type MxRouteClient } from "../client.js";
import { ok, toErrorResult } from "../errors.js";
import { catchAllSchema, domainSchema } from "../schemas.js";
import type { ApiEnvelope, CatchAll } from "../types.js";

/** Shape synthesized when the API returns no body (set_catch_all). */
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

/** Catch-all tools: how a domain handles mail to nonexistent addresses. */
export function registerCatchAllTools(server: McpServer, client: MxRouteClient): void {
  server.registerTool(
    "get_catch_all",
    {
      title: "Get Catch-All",
      description:
        "Returns the domain's catch-all setting: how mail addressed to nonexistent local parts is handled. `type` is `fail` (reject), `blackhole` (silently discard), or `address` (forward); `address` holds the forwarding destination when type is `address`, otherwise null.",
      inputSchema: z.object({ domain: domainSchema }),
      outputSchema: z
        .object({
          type: z.enum(["fail", "blackhole", "address"]),
          address: z.string().nullable(),
          description: z.string().optional(),
        })
        .loose(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const { domain } = args;
        const res = await client.request<ApiEnvelope<CatchAll> | null>(
          "GET",
          `/domains/${enc(domain)}/catch-all`,
        );
        return ok(unwrapData(res));
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "set_catch_all",
    {
      title: "Set Catch-All",
      description:
        "Sets how the domain handles mail addressed to nonexistent local parts: `fail` rejects the mail, `blackhole` silently discards it, `address` forwards it to a chosen mailbox or forwarder. The `address` input is required when type is `address` and must be omitted otherwise.",
      inputSchema: catchAllSchema.extend({ domain: domainSchema }),
      outputSchema: unspecifiedResultOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const { domain } = args;
        const body: { type: typeof args.type; address?: string } = { type: args.type };
        if (args.address !== undefined) body.address = args.address;
        const res = await client.request<ApiEnvelope<unknown> | null>(
          "PATCH",
          `/domains/${enc(domain)}/catch-all`,
          body,
        );
        return ok(
          res?.data ?? {
            success: true,
            message: `Catch-all for ${domain} set to ${args.type}${args.address ? ` (${args.address})` : ""}.`,
          },
        );
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );
}
