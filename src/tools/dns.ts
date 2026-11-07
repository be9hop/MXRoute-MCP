import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { enc, unwrapData, type MxRouteClient } from "../client.js";
import { ok, toErrorResult } from "../errors.js";
import { domainSchema } from "../schemas.js";
import type { ApiEnvelope, DnsInfo } from "../types.js";

/** A DNS TXT record (SPF / DKIM / verification) in the unwrapped payload. */
const txtRecordOutputSchema = z
  .object({
    type: z.string(),
    name: z.string(),
    value: z.string(),
    description: z.string().optional(),
  })
  .loose();

/** DNS info tools: the records the user must configure at their registrar. */
export function registerDnsTools(server: McpServer, client: MxRouteClient): void {
  server.registerTool(
    "get_dns_records",
    {
      title: "Get DNS Records",
      description:
        "Returns the DNS records to configure at the domain's registrar for MXroute mail delivery: MX records plus the SPF, DKIM, and verification TXT records. `dkim` and `verification` are null when the record does not apply to this domain.",
      inputSchema: z.object({ domain: domainSchema }),
      outputSchema: z
        .object({
          mx_records: z.array(
            z
              .object({
                priority: z.number(),
                hostname: z.string(),
                description: z.string().optional(),
              })
              .loose(),
          ),
          spf: txtRecordOutputSchema,
          dkim: txtRecordOutputSchema.nullable(),
          verification: txtRecordOutputSchema.nullable(),
        })
        .loose(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const { domain } = args;
        const res = await client.request<ApiEnvelope<DnsInfo> | null>(
          "GET",
          `/domains/${enc(domain)}/dns`,
        );
        return ok(unwrapData(res));
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );
}
