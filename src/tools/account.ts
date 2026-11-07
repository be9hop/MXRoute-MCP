import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { unwrapData, type MxRouteClient } from "../client.js";
import { ok, toErrorResult } from "../errors.js";
import type { ApiEnvelope, VerificationKeyResponse } from "../types.js";

/**
 * Account-level tools. `get_verification_key` is step 1 of the domain-add
 * workflow (get key, publish the TXT record at the registrar, wait for DNS
 * propagation, then create the domain).
 */
export function registerAccountTools(server: McpServer, client: MxRouteClient): void {
  server.registerTool(
    "get_verification_key",
    {
      title: "Get Verification Key",
      description:
        "Returns the account's domain verification key. To add a new domain: create a TXT record at your registrar named `<key>.<yourdomain>` with value `domain-verified`, wait for DNS propagation (typically 5-15 minutes), then call create_domain. The returned record object contains the exact TXT record name, type, and value.",
      inputSchema: z.object({}),
      outputSchema: z
        .object({
          key: z.string(),
          record: z
            .object({
              type: z.string(),
              name: z.string(),
              value: z.string(),
            })
            .loose(),
          description: z.string().optional(),
        })
        .loose(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      try {
        const res = await client.request<ApiEnvelope<VerificationKeyResponse> | null>(
          "GET",
          "/verification-key",
        );
        return ok(unwrapData(res));
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );
}
