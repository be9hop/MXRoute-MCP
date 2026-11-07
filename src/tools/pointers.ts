import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { enc, unwrapData } from "../client.js";
import type { MxRouteClient } from "../client.js";
import { ok, toErrorResult } from "../errors.js";
import { domainSchema } from "../schemas.js";
import type { ApiEnvelope, DomainPointer } from "../types.js";

/** Unwrapped `DomainPointer` payload. */
const domainPointerResultSchema = z
  .object({
    pointer: z.string(),
    type: z.enum(["alias", "redirect"]),
    target: z.string(),
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
 * Domain pointer (alias/redirect) tools: list, attach, and detach the pointer
 * domains serving a target domain's mailboxes.
 */
export function registerDomainPointerTools(server: McpServer, client: MxRouteClient): void {
  server.registerTool(
    "list_domain_pointers",
    {
      title: "List Domain Pointers",
      description:
        'Lists the domain pointers (aliases and redirects) attached to a domain. Each entry has the pointer domain name, its type ("alias" or "redirect"), and the target domain it serves.',
      inputSchema: z.object({ domain: domainSchema }),
      outputSchema: z.array(domainPointerResultSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ domain }) => {
      try {
        const res = await client.request<ApiEnvelope<DomainPointer[]> | null>(
          "GET",
          `/domains/${enc(domain)}/pointers`,
        );
        return ok(unwrapData(res));
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "create_domain_pointer",
    {
      title: "Create Domain Pointer",
      description:
        "Attaches a pointer domain to an existing domain. With alias=true (the default) the pointer is an alias serving the same mailboxes as the target domain; with alias=false it is a redirect.",
      inputSchema: z.object({
        domain: domainSchema,
        pointer: domainSchema,
        alias: z
          .boolean()
          .optional()
          .describe("true (default) = alias serving the same mailboxes; false = redirect"),
      }),
      outputSchema: unspecifiedResultSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ domain, pointer, alias }) => {
      try {
        const body: Record<string, unknown> = { pointer };
        if (alias !== undefined) body.alias = alias;
        const res = await client.request<ApiEnvelope<unknown> | null>(
          "POST",
          `/domains/${enc(domain)}/pointers`,
          body,
        );
        return ok(
          res?.data ?? {
            success: true,
            message: `Domain pointer ${pointer} (${alias === false ? "redirect" : "alias"}) attached to ${domain}.`,
          },
        );
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "delete_domain_pointer",
    {
      title: "Delete Domain Pointer",
      description:
        "Removes a domain pointer (alias or redirect) from a domain. The pointer domain stops serving the target domain's mailboxes; the target domain itself is unchanged.",
      inputSchema: z.object({ domain: domainSchema, pointer: domainSchema }),
      outputSchema: messageResultSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ domain, pointer }) => {
      try {
        await client.request("DELETE", `/domains/${enc(domain)}/pointers/${enc(pointer)}`);
        return ok({ success: true, message: `Domain pointer ${pointer} removed from ${domain}.` });
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );
}
