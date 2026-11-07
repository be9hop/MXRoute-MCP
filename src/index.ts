#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { loadConfig } from "./config.js";
import { MxRouteClient } from "./client.js";
import { registerAccountTools } from "./tools/account.js";
import { registerDomainTools } from "./tools/domains.js";
import { registerDomainPointerTools } from "./tools/pointers.js";
import { registerEmailAccountTools } from "./tools/emailAccounts.js";
import { registerForwarderTools } from "./tools/forwarders.js";
import { registerSpamTools } from "./tools/spam.js";
import { registerDnsTools } from "./tools/dns.js";
import { registerCatchAllTools } from "./tools/catchAll.js";
import { registerQuotaTools } from "./tools/quota.js";
import { registerResellerUserTools } from "./tools/resellerUsers.js";
import { registerResellerPackageTools } from "./tools/resellerPackages.js";

/**
 * Startup warning (stderr only). serveStdio invokes its factory lazily — with
 * an immediately-closed stdin the factory never runs — so the missing-config
 * warning is printed here, at process start.
 */
function warnIfMissingConfig(): void {
  const { missing } = loadConfig(process.env);
  if (missing.length > 0) {
    console.error(
      `[mxroute-mcp] Warning: missing environment variables: ${missing.join(", ")}. Tool calls will fail until they are set. See the README for configuration.`,
    );
  }
}

/**
 * Build a fresh, fully-wired McpServer. serveStdio calls this factory so each
 * connection gets its own server instance.
 *
 * Credentials are validated lazily: the server always starts (so tools/list
 * works without credentials) and each tool call reports CONFIG_MISSING until
 * the environment variables are set.
 */
function buildServer(): McpServer {
  const server = new McpServer({ name: "mxroute-mcp", version: "0.1.0" });

  const { config } = loadConfig(process.env);
  const client = new MxRouteClient(config);

  registerAccountTools(server, client);
  registerDomainTools(server, client);
  registerDomainPointerTools(server, client);
  registerEmailAccountTools(server, client);
  registerForwarderTools(server, client);
  registerSpamTools(server, client);
  registerDnsTools(server, client);
  registerCatchAllTools(server, client);
  registerQuotaTools(server, client);
  registerResellerUserTools(server, client);
  registerResellerPackageTools(server, client);

  return server;
}

// stdio transport. NEVER write to stdout (it carries JSON-RPC); all logging
// goes to stderr via console.error.
warnIfMissingConfig();
serveStdio(buildServer, {
  onerror: (e) => console.error("[mxroute-mcp] server error:", e),
});
