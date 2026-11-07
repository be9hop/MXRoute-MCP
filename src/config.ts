/**
 * Environment-based configuration for the MXroute MCP server.
 *
 * Validation is deliberately lazy: `loadConfig` never throws. When required
 * variables are missing it returns `config: null` plus the names of the
 * missing variables. index.ts prints a startup warning (stderr only), and the
 * client throws a local CONFIG_MISSING ApiError per tool call — so the server
 * still starts and answers tools/list without credentials.
 *
 * SECURITY: never log the API key (or its length or contents). Only variable
 * NAMES may appear in log messages.
 */

export interface MxRouteConfig {
  apiKey: string;
  server: string;
  username: string;
  baseUrl: string;
}

/** Environment variables that must be set for API calls to work. */
export const REQUIRED_ENV_VARS = [
  "MXROUTE_API_KEY",
  "MXROUTE_SERVER",
  "MXROUTE_USERNAME",
] as const;

/** Default production API base URL. */
export const DEFAULT_BASE_URL = "https://api.mxroute.com";

function trimValue(value: string | undefined): string {
  return (value ?? "").trim();
}

/**
 * Load the MXroute configuration from an environment object (usually
 * `process.env`). Returns `config: null` and the names of the missing
 * variables when any required variable is absent or blank.
 *
 * `MXROUTE_API_BASE` is optional and overrides the API base URL (trailing
 * slashes are removed).
 */
export function loadConfig(
  env: NodeJS.ProcessEnv,
): { config: MxRouteConfig | null; missing: string[] } {
  const apiKey = trimValue(env.MXROUTE_API_KEY);
  const server = trimValue(env.MXROUTE_SERVER);
  const username = trimValue(env.MXROUTE_USERNAME);
  const baseUrl =
    trimValue(env.MXROUTE_API_BASE).replace(/\/+$/, "") || DEFAULT_BASE_URL;

  const missing: string[] = [];
  if (!apiKey) missing.push("MXROUTE_API_KEY");
  if (!server) missing.push("MXROUTE_SERVER");
  if (!username) missing.push("MXROUTE_USERNAME");

  if (missing.length > 0) {
    return { config: null, missing };
  }

  return {
    config: { apiKey, server, username, baseUrl },
    missing: [],
  };
}
