import { z } from "zod";

/**
 * Shared zod (v4) input validators for MCP tool input schemas. Every field
 * carries a `.describe()` so AI agents see the rules inline.
 *
 * Tool modules compose these into per-tool `z.object({ ... })` shapes (or raw
 * shapes) for `server.registerTool(...)` input schemas.
 */

/** Hostname validation: labels of letters/digits/hyphens, at least one dot, label <= 63, total <= 253. */
function isValidHostname(value: string): boolean {
  if (value.length === 0 || value.length > 253) return false;
  if (value.startsWith(".") || value.endsWith(".")) return false;
  if (value.startsWith("-") || value.endsWith("-")) return false;
  const labels = value.split(".");
  if (labels.length < 2) return false;
  return labels.every((label) => {
    if (label.length < 1 || label.length > 63) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
    return /^[a-z0-9-]+$/.test(label);
  });
}

/** Domain name, e.g. `example.com`. Trimmed and lowercased before validation. */
export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .describe(
    "Domain name on this account, e.g. example.com (letters, digits, hyphens; at least one dot)",
  )
  .refine(
    (value) => isValidHostname(value),
    "Invalid domain name: use a hostname like example.com (letters/digits/hyphens per label, no leading/trailing hyphen or dot, at least one dot, labels up to 63 chars, total up to 253 chars)",
  );

/** Local part of an email address (the part before @), e.g. `your_mailbox`. */
export const localPartSchema = z
  .string()
  .min(1, "Local part must not be empty")
  .max(64, "Local part must be at most 64 characters")
  .regex(
    /^[a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~.]+$/,
    "Local part may only contain letters, digits, and !#$%&'*+-/=?^_`{|}~. characters",
  )
  .refine((value) => value !== "." && value !== "..", "Must not be '.' or '..'")
  .describe(
    "Local part of the email address (the part before the @), e.g. your_mailbox (1-64 chars)",
  );

/** Mailbox password. Character/strength rules are enforced server-side. */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be at most 72 characters")
  .describe(
    "Password (8-72 characters; must also meet the mail server's character/strength rules — enforced server-side)",
  );

/**
 * Reseller user login password. Unlike the mailbox password, the API spec
 * sets only a minimum (8 characters) — there is no maximum to enforce.
 */
export const resellerPasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .describe("Reseller user password (minimum 8 characters; no maximum — the spec sets none)");

/** Whitelist/blacklist entry; wildcards supported, e.g. `*@trusted.com`. */
export const spamEntrySchema = z
  .string()
  .max(254, "Spam entry must be at most 254 characters")
  .regex(
    /^[a-zA-Z0-9@.\-_*+=]+$/,
    "Spam entries may only contain letters, digits, and @ . - _ * + = characters",
  )
  .refine((value) => value !== "." && value !== "..", "Must not be '.' or '..'")
  .describe(
    'Email address or pattern to allow/block; wildcards supported, e.g. *@trusted.com or user@example.com',
  );

/** Spam score threshold for auto-deletion. */
export const highScoreSchema = z
  .number()
  .int("high_score must be an integer")
  .min(1, "high_score must be at least 1")
  .max(50, "high_score must be at most 50")
  .describe("Spam score threshold for auto-deletion (integer 1-50)");

/** Storage quota in MB. */
export const quotaMbSchema = z
  .number()
  .int("Quota must be an integer number of MB")
  .min(0, "Quota must be at least 0")
  .describe("Storage quota in MB (integer; 0 = unlimited)");

/** Daily send limit. */
export const sendLimitSchema = z
  .number()
  .int("Send limit must be an integer")
  .min(0, "Send limit must be at least 0")
  .max(9600, "Send limit must be at most 9600")
  .describe("Daily send limit (integer 0-9600)");

/** Catch-all configuration: `address` is required iff `type` is "address". */
export const catchAllSchema = z
  .object({
    type: z
      .enum(["fail", "blackhole", "address"])
      .describe(
        "'fail' rejects mail to unknown addresses, 'blackhole' silently discards it, 'address' forwards it to a chosen mailbox",
      ),
    address: z.string().email().optional().describe(
      "Email address to forward catch-all mail to; required when type is 'address' and not allowed otherwise",
    ),
  })
  .superRefine((value, ctx) => {
    if (value.type === "address" && !value.address) {
      ctx.addIssue({
        code: "custom",
        path: ["address"],
        message: 'address is required when type is "address"',
      });
    }
    if (value.type !== "address" && value.address) {
      ctx.addIssue({
        code: "custom",
        path: ["address"],
        message: 'address must be omitted unless type is "address"',
      });
    }
  });

/**
 * Package/user limit value: digits (whole number) or the literal
 * "unlimited". Units depend on the field: package `quota` is GB, reseller
 * user `quota` is MB, the remaining fields are plain counts.
 */
export const limitValueSchema = z
  .string()
  .regex(
    /^\d+$|^unlimited$/,
    'Value must be a whole number (digits only) or the literal "unlimited"',
  )
  .describe(
    'A whole number (digits only) or the literal "unlimited". Units: package quota is GB, reseller user quota is MB, other fields are counts',
  );

/** Reseller account username (also used for reseller-owned user names). */
export const resellerUsernameSchema = z
  .string()
  .min(1, "Username must not be empty")
  .max(10, "Username must be at most 10 characters")
  .regex(
    /^[a-z0-9_]+$/,
    "Username may only contain lowercase letters, digits, and underscores",
  )
  .describe(
    "Reseller username (1-10 chars, lowercase letters, digits, underscores)",
  );
