import type { CallToolResult } from "@modelcontextprotocol/server";

/**
 * Error thrown by the client (and by tools) for every failure path:
 * missing configuration, network/timeout failures, and API error envelopes.
 *
 * `hint` carries the actionable fix text mapped from the API error code
 * (see client.ts), `field` the offending field for validation errors.
 */
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status?: number,
    public hint?: string,
    public field?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Ensure a fragment ends with exactly one terminal period (hints already do). */
function withPeriod(fragment: string): string {
  return /[.!?]$/.test(fragment) ? fragment : `${fragment}.`;
}

/**
 * Convert any thrown value into a standard MCP error tool result.
 *
 * Text format for ApiError: `[CODE] message` plus, when present,
 * ` Field: <field>.` and ` Hint: <hint>.` (a period is appended only when the
 * fragment does not already end in sentence punctuation, so hints that are
 * full sentences do not produce `..`). Generic Error messages are passed
 * through as-is (the client never puts credentials in error messages, so
 * nothing here can leak them).
 */
export function toErrorResult(err: unknown): CallToolResult {
  let text: string;
  if (err instanceof ApiError) {
    text = `[${err.code}] ${err.message}`;
    if (err.field) text += ` Field: ${withPeriod(err.field)}`;
    if (err.hint) text += ` Hint: ${withPeriod(err.hint)}`;
  } else if (err instanceof Error) {
    text = err.message;
  } else {
    text = String(err);
  }
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * The standard success result every tool returns: pretty-printed JSON as text
 * content plus the same value as structuredContent.
 */
export function ok(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) ?? "null" }],
    structuredContent: data as Record<string, unknown>,
  };
}
