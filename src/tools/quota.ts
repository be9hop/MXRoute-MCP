import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { requireBody, type MxRouteClient } from "../client.js";
import { ok, toErrorResult } from "../errors.js";
import type { DiskQuota, EmailUsage } from "../types.js";

/**
 * Quota/usage tools. Both endpoints return their payload at the TOP LEVEL
 * (no `data` envelope) and are refreshed hourly, so values can lag recent
 * changes by up to an hour.
 */
export function registerQuotaTools(server: McpServer, client: MxRouteClient): void {
  server.registerTool(
    "get_disk_quota",
    {
      title: "Get Disk Quota",
      description:
        "Returns account disk usage: total bytes used and quota limit (0 = unlimited), percent used, a category breakdown (email, web, databases, backups, other — in bytes), and the grace period when the account is over quota. Data is refreshed hourly.",
      inputSchema: z.object({}),
      outputSchema: z
        .object({
          username: z.string(),
          total_used: z.number(),
          total_limit: z.number(),
          percent_used: z.number(),
          breakdown: z
            .object({
              email: z.number(),
              web: z.number(),
              databases: z.number(),
              backups: z.number(),
              other: z.number(),
            })
            .loose(),
          grace_period: z
            .object({
              days_remaining: z.number(),
              deadline: z.string(),
            })
            .loose()
            .nullable(),
          updated_at: z.string(),
        })
        .loose(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      try {
        const res = await client.request<DiskQuota>("GET", "/quota");
        return ok(requireBody(res));
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );

  server.registerTool(
    "get_email_usage",
    {
      title: "Get Email Usage",
      description:
        "Returns per-mailbox disk usage for the account, largest mailbox first (email address, size in bytes, last update time). Useful for finding which mailboxes to trim when the account nears its quota. Data is refreshed hourly.",
      inputSchema: z.object({}),
      outputSchema: z
        .object({
          username: z.string(),
          accounts: z.array(
            z
              .object({
                email_address: z.string(),
                size_bytes: z.number(),
                updated_at: z.string(),
              })
              .loose(),
          ),
        })
        .loose(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      try {
        const res = await client.request<EmailUsage>("GET", "/quota/email");
        return ok(requireBody(res));
      } catch (e) {
        return toErrorResult(e);
      }
    },
  );
}
