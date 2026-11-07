# mxroute-mcp

[![npm version](https://img.shields.io/npm/v/mxroute-mcp)](https://www.npmjs.com/package/mxroute-mcp)
[![Node.js >=20](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

MXroute is an email hosting provider. Its Email Hosting REST API lives at `https://api.mxroute.com` and manages the moving parts of a hosted mail account: domains and their DNS, mailboxes, forwarders, spam filtering, quotas, and — for reseller accounts — the users and packages underneath them.

`mxroute-mcp` is an MCP (Model Context Protocol) stdio server that wraps that API. It exposes 43 tools so an AI agent in Claude Desktop, Cursor, or any other MCP client can operate an MXroute account end to end: onboarding domains, creating mailboxes and forwarders, tuning spam handling, reading DNS records, setting catch-alls, investigating quota usage, and administering reseller users and packages. Requires Node.js 20 or newer.

## Contents

- [Requirements and quick start](#requirements-and-quick-start)
- [Configuration](#configuration)
  - [Reseller impersonation](#reseller-impersonation)
  - [Security notes](#security-notes)
- [Tool reference](#tool-reference)
  - [Account](#account)
  - [Domains](#domains)
  - [Domain pointers](#domain-pointers)
  - [Email accounts](#email-accounts)
  - [Forwarders](#forwarders)
  - [Spam settings](#spam-settings)
  - [DNS](#dns)
  - [Catch-all](#catch-all)
  - [Quota](#quota)
  - [Reseller users](#reseller-users)
  - [Reseller packages](#reseller-packages)
  - [Input formats](#input-formats)
- [Rate limits](#rate-limits)
- [Error reference](#error-reference)
- [Workflows](#workflows)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

## Requirements and quick start

- Node.js 20 or newer.
- An MXroute API key. Create one at <https://panel.mxroute.com/api-keys.php> — that page also shows the mail server hostname and username to use.
- Every tool call requires the three environment variables `MXROUTE_API_KEY`, `MXROUTE_SERVER`, and `MXROUTE_USERNAME`; without them calls fail with `CONFIG_MISSING`.

### Claude Desktop

Edit the config file: `%APPDATA%\Claude\claude_desktop_config.json` on Windows, `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS.

```json
{
  "mcpServers": {
    "mxroute": {
      "command": "npx",
      "args": ["-y", "mxroute-mcp"],
      "env": {
        "MXROUTE_API_KEY": "your-api-key",
        "MXROUTE_SERVER": "eagle.mxlogin.com",
        "MXROUTE_USERNAME": "your-username"
      }
    }
  }
}
```

### Cursor

Edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mxroute": {
      "command": "npx",
      "args": ["-y", "mxroute-mcp"],
      "env": {
        "MXROUTE_API_KEY": "your-api-key",
        "MXROUTE_SERVER": "eagle.mxlogin.com",
        "MXROUTE_USERNAME": "your-username"
      }
    }
  }
}
```

### From source

Clone this repository, then:

```bash
npm install
npm run build
```

Point the MCP client at the built entry point instead of `npx`:

```json
{
  "mcpServers": {
    "mxroute": {
      "command": "node",
      "args": ["/path/to/build/index.js"],
      "env": {
        "MXROUTE_API_KEY": "your-api-key",
        "MXROUTE_SERVER": "eagle.mxlogin.com",
        "MXROUTE_USERNAME": "your-username"
      }
    }
  }
}
```

### Claude CLI one-liner

```bash
claude mcp add mxroute --env MXROUTE_API_KEY=... --env MXROUTE_SERVER=... --env MXROUTE_USERNAME=... -- npx -y mxroute-mcp
```

The key given on the command line is stored in plaintext in the client config and shell history; prefer editing the config file directly on shared machines.

## Configuration

The server reads its configuration from environment variables.

| Variable | Required | Description | Example |
| --- | --- | --- | --- |
| `MXROUTE_API_KEY` | Yes | API key. Send the complete key unchanged (no `keyid:` prefix). | `your-api-key` |
| `MXROUTE_SERVER` | Yes | Mail server hostname. | `eagle.mxlogin.com` |
| `MXROUTE_USERNAME` | Yes | DirectAdmin username. Resellers can send `reseller\|user` to act as an owned user. | `your-username` or `your-reseller\|your-user` |
| `MXROUTE_API_BASE` | No | API base URL override. | `https://api.mxroute.com` |

Where the values come from: create an API key at <https://panel.mxroute.com/api-keys.php>. The server hostname and username are shown on that same page. Send the complete key unchanged, including any colons; do not prepend the key ID — the legacy `keyid:password` parsing is no longer supported. Account passwords only work if DirectAdmin permits password-based API access (`api_with_password=yes` in the account's user.conf); login keys are unaffected — prefer API keys.

The server starts even without credentials (it prints a warning to stderr naming the missing variables) and `tools/list` works, but every tool call returns `CONFIG_MISSING` until all three required variables are set. Values are trimmed; a blank value counts as missing. `MXROUTE_API_BASE` defaults to `https://api.mxroute.com` and has trailing slashes removed.

### Reseller impersonation

A reseller can act as one of its owned ordinary users by setting `MXROUTE_USERNAME` to `reseller|user` — for example:

```json
"MXROUTE_USERNAME": "your-reseller|their-user"
```

Keep `MXROUTE_API_KEY` as the reseller's own complete key and `MXROUTE_SERVER` as the reseller's server (the equivalent API call is `X-Username: reseller|user` with the reseller's key, as in the API's own curl examples). Each name on either side of the pipe must be 1–16 characters of letters, digits, or underscores. Chained pipes and self-impersonation are rejected; use the plain username to manage the reseller's own account.

While impersonating, all account and domain operations apply to the target user. Reseller-only endpoints (the reseller users and packages tools) are unavailable and return `FORBIDDEN` — switch `MXROUTE_USERNAME` back to the plain reseller username to use them. Only ordinary user targets are supported; admin credentials and user-to-user impersonation are not. The reseller and all impersonated targets share the reseller's rate-limit bucket on that server.

### Security notes

- The API key is stored in plaintext wherever the MCP client keeps its config — `claude_desktop_config.json`, `~/.cursor/mcp.json`, or shell history with the CLI one-liner. Anyone who can read that file can administer the account.
- Driven by an agent, this server can perform destructive operations: deleting a domain, a mailbox with its stored mail, or a reseller user with everything under it. The destructive tools carry `destructiveHint: true` annotations; check how the MCP client surfaces approval prompts for annotated tools before letting an agent run unsupervised.
- `MXROUTE_API_BASE` sends the API key to whatever host it names. Only set it when you have a specific reason to redirect API traffic.
- The server never logs the key (or its length or contents) and writes all logging to stderr; stdout carries only the JSON-RPC protocol.

## Tool reference

Field order in each signature: required parameters first, then optional ones marked with `?`. Types are called out in prose where they are not obvious. Where the API documents no success body, the tool returns a success message instead of a payload.

### Account

#### get_verification_key
`get_verification_key()`

Returns the account's domain verification key plus the exact TXT record to publish: `{ key, record: { type, name, value }, description? }`. To add a new domain, create a TXT record at the registrar named `<key>.<yourdomain>` with value `domain-verified`, wait for DNS propagation (typically 5–15 minutes), then call `create_domain`.

### Domains

A domain must pass ownership verification before `create_domain` accepts it (see `get_verification_key`).

#### list_domains
`list_domains()`

Lists all domains on the account. Returns an array of domain names, e.g. `["example.com", "mydomain.org"]`. Use `get_domain` for the details of a single domain.

#### create_domain
`create_domain(domain)`

Adds a new domain to the account for email hosting. The verification TXT record must already exist and have propagated. Returns the created domain and its `ssl_enabled` status (or a success message when the API returns an empty body). A 409 `CONFLICT` means the domain already exists on the account.

#### get_domain
`get_domain(domain)`

Returns the details of one domain: `{ domain, mail_hosting?, ssl_enabled?, pointers? }`, where `pointers` lists the pointer domain names attached to it. Use `list_domains` to discover the domain names on the account.

#### delete_domain
`delete_domain(domain)`

Removes the domain from the account. Deletes the domain and everything configured under it — mailboxes and forwarders stop working and mail to the domain is no longer handled. Destructive and irreversible. Use `set_domain_mail_hosting` to pause mail service without deleting the domain. Returns a success message.

#### set_domain_mail_hosting
`set_domain_mail_hosting(domain, enabled)`

Enables or disables mail hosting for a domain. `enabled` is a boolean: true to have MXroute handle mail for the domain, false to pause mail hosting. Pure state change — the domain, its mailboxes, and their settings are kept. Returns a success message.

### Domain pointers

A domain pointer attaches a second domain to an existing one: an alias serves the same mailboxes as the target domain, a redirect forwards it elsewhere.

#### list_domain_pointers
`list_domain_pointers(domain)`

Lists the pointers (aliases and redirects) attached to a domain. Each entry has `{ pointer, type, target }`, where `type` is `"alias"` or `"redirect"` and `target` is the domain it serves.

#### create_domain_pointer
`create_domain_pointer(domain, pointer, alias?)`

Attaches a pointer domain to an existing domain. `alias` is a boolean, true by default (alias serving the same mailboxes); false makes it a redirect. Returns a success message.

#### delete_domain_pointer
`delete_domain_pointer(domain, pointer)`

Removes a pointer from a domain; the pointer domain stops serving the target domain's mailboxes and the target domain itself is unchanged. Returns a success message.

### Email accounts

Mailboxes live under a domain; the `username`, `user` parameters are the local part (the part before the @).

#### list_email_accounts
`list_email_accounts(domain)`

Lists the mailboxes under a domain. Each entry has `{ username, email, quota, usage, limit, sent, suspended }`: quota in MB (0 = unlimited), current usage in MB, daily send limit, messages sent today, and suspended status.

#### create_email_account
`create_email_account(domain, username, password, quota?, limit?)`

Creates a mailbox. `username` is the local part (before the @). Passwords are 8–72 characters plus the mail server's own character and strength rules (enforced server-side). `quota` in MB (integer, default 1024, 0 = unlimited); `limit` is the daily send cap (integer 0–9600, default 9600). Returns a success message.

#### get_email_account
`get_email_account(domain, user)`

Returns one mailbox's details, same shape as the `list_email_accounts` entries. `user` is the mailbox local part (the part before the @).

#### update_email_account
`update_email_account(domain, user, password?, quota?, limit?)`

Updates a mailbox's password, storage quota in MB, or daily send limit. At least one of the three fields must be provided; omitted fields keep their current values. The mailbox is looked up case-insensitively by local part. Password rejections return field-specific errors naming the password field. Returns a success message.

#### delete_email_account
`delete_email_account(domain, user)`

Deletes the mailbox and its stored mail — irreversible; the address immediately stops accepting mail. Read the exact username casing back from `list_email_accounts` or `get_email_account` before deleting: updates resolve the local part case-insensitively, but deletes should use the exact stored casing. Returns a success message.

### Forwarders

Forwarders route mail for an address without storing it in a mailbox.

#### list_forwarders
`list_forwarders(domain)`

Lists all forwarders on a domain. Each entry has `{ alias, email, destinations }`: the alias local part, the full forwarder address, and the destination addresses it forwards to.

#### create_forwarder
`create_forwarder(domain, alias, destinations)`

Creates a forwarder for an alias on a domain. `destinations` is a non-empty array of email addresses; the special values `:blackhole:` (silently discard mail) and `:fail:` (reject mail) are also accepted. Forwarding to Gmail, Yahoo, AOL, and similar providers automatically enables Expert Spam Filtering for the domain to protect its sending reputation. Returns a success message.

#### delete_forwarder
`delete_forwarder(domain, alias)`

Deletes a forwarder by its alias; mail sent to the alias is no longer forwarded. Read the alias's exact stored casing back from `list_forwarders` before deleting, and pass it unchanged. Returns a success message.

### Spam settings

Sender lists (whitelist and blacklist) are shared across all domains on the account. Entries match case-insensitively, so adding a duplicate returns 409 `CONFLICT`, and writes are serialized account-wide — a 503 means another update on the account is in progress.

#### get_spam_settings
`get_spam_settings(domain)`

Returns `{ high_score }`, the SpamAssassin-style score threshold (1–50) at which incoming mail is automatically deleted.

#### update_spam_settings
`update_spam_settings(domain, high_score)`

Sets the spam auto-deletion threshold. `high_score` is an integer 1–50; lower values delete more aggressively, higher values keep more mail. If the save fails (for example 503), re-read the settings before retrying. Returns a success message.

#### get_spam_whitelist
`get_spam_whitelist(domain)`

Lists the whitelist entries. Whitelisted senders bypass spam filtering. Entries support wildcards (for example `*@trusted.com`) and match case-insensitively. Returns the entry list.

#### add_spam_whitelist_entry
`add_spam_whitelist_entry(domain, entry)`

Adds an entry to the whitelist; supports wildcards such as `*@trusted.com`. A 409 means the entry already exists (entries match case-insensitively). Because sender lists are account-wide, this affects every domain on the account. Returns a success message.

#### remove_spam_whitelist_entry
`remove_spam_whitelist_entry(domain, entry)`

Removes an entry from the whitelist. Entries match case-insensitively, so the stored casing may differ. Affects every domain on the account. Returns a success message.

#### get_spam_blacklist
`get_spam_blacklist(domain)`

Lists the blacklist entries; blacklisted senders are always treated as spam. Entries support wildcards and match case-insensitively. An empty 200 response is treated as an empty list. Returns the entry list.

#### add_spam_blacklist_entry
`add_spam_blacklist_entry(domain, entry)`

Adds an entry to the blacklist; supports wildcards such as `*@example.com`. A 409 means the entry already exists (entries match case-insensitively). Affects every domain on the account. Returns a success message.

#### remove_spam_blacklist_entry
`remove_spam_blacklist_entry(domain, entry)`

Removes an entry from the blacklist. Entries match case-insensitively, so the stored casing may differ. Affects every domain on the account. Returns a success message.

### DNS

#### get_dns_records
`get_dns_records(domain)`

Read-only. Returns the DNS records to configure at the domain's registrar for MXroute mail delivery: `{ mx_records: [{ priority, hostname, description? }], spf: { type, name, value }, dkim, verification }`, where each TXT record is `{ type, name, value, description? }`. `dkim` and `verification` are null when the record does not apply to this domain.

### Catch-all

The catch-all decides what happens to mail addressed to nonexistent local parts on a domain.

#### get_catch_all
`get_catch_all(domain)`

Returns `{ type, address, description? }`: `type` is `"fail"` (reject), `"blackhole"` (silently discard), or `"address"` (forward); `address` holds the forwarding destination when type is `"address"`, otherwise null.

#### set_catch_all
`set_catch_all(domain, type, address?)`

Sets how the domain handles mail to nonexistent local parts: `fail` rejects the mail, `blackhole` silently discards it, `address` forwards it to a chosen mailbox or forwarder. `address` is an email address, required when `type` is `"address"` and must be omitted otherwise. Returns a success message.

### Quota

Both tools report data refreshed hourly, so values can lag recent changes by up to an hour. Sizes are in bytes.

#### get_disk_quota
`get_disk_quota()`

Returns account disk usage: `{ username, total_used, total_limit, percent_used, breakdown, grace_period, updated_at }` — totals in bytes (`total_limit` 0 = unlimited), a per-category breakdown in bytes (`email`, `web`, `databases`, `backups`, `other`), and the over-quota grace period (`{ days_remaining, deadline }`, null when not over quota).

#### get_email_usage
`get_email_usage()`

Returns per-mailbox disk usage for the account, largest mailbox first: `{ username, accounts: [{ email_address, size_bytes, updated_at }] }`. Useful for finding which mailboxes to trim when the account nears its quota.

### Reseller users

Reseller-only: every tool in this group must be called while authenticated as the reseller (plain reseller username), not while impersonating a user — they return 403 `FORBIDDEN` otherwise.

#### list_reseller_users
`list_reseller_users()`

Lists the usernames of all users under the reseller account. Returns an array of strings.

#### create_reseller_user
`create_reseller_user(username, email, password, package)`

Creates a user under the reseller account. `username` is 1–10 characters `[a-z0-9_]`; `password` has a minimum of 8 characters (no maximum); `email` is a contact email address; `package` is an existing package name (see `list_packages` — 422 means it does not exist). Returns a success message.

#### get_reseller_user
`get_reseller_user(username)`

Returns one user's details: `{ username, email, domain, package, suspended, quota }`, where `quota` is `{ limit, used, unlimited }` with `limit` in MB (null when unlimited). A 404 means the user does not exist.

#### update_reseller_user
`update_reseller_user(username, quota?, password?)`

Updates a user's disk quota and/or password; at least one of the two fields must be provided. `quota` is a digit string in MB or `"unlimited"`. `password` follows the reseller rule (minimum 8 characters). A 404 means the user does not exist. Returns a success message.

#### delete_reseller_user
`delete_reseller_user(username)`

Deletes the user and everything under it — irreversible. Per DirectAdmin behavior the deletion may fail or cascade, so double-check the username first. Returns a success message.

#### suspend_reseller_user
`suspend_reseller_user(username)`

Suspends a user, blocking their access without deleting data. Repeating the call is harmless. Returns a success message.

#### unsuspend_reseller_user
`unsuspend_reseller_user(username)`

Reverses a suspension, restoring the user's access. Repeating the call is harmless. Returns a success message.

#### set_reseller_user_package
`set_reseller_user_package(username, package)`

Moves a user to a different package and returns the updated user (same shape as `get_reseller_user`). Changing the package can change the quota and limits of every domain under the user. A 422 means the package does not exist.

### Reseller packages

Reseller-only, same as the user tools: unavailable while impersonating. Limit values are digit strings or the literal `"unlimited"`; the package `quota` is in GB.

#### list_packages
`list_packages()`

Lists the names of all packages defined under the reseller account. Returns an array of strings.

#### create_package
`create_package(name, quota?, domains?, email_accounts?, email_forwarders?, domain_pointers?)`

Creates a package that reseller users can be assigned to. `name` may contain letters, numbers, underscores, and hyphens. Each limit is a digit string or `"unlimited"`; `quota` is in GB. Unset limits take the API defaults: quota `1` GB, 1 domain, 100 email accounts, 100 email forwarders, 10 domain pointers. Returns a success message.

#### get_package
`get_package(name)`

Returns one package: `{ name, settings }` with `settings.quota_gb` (null when unlimited), `settings.quota_unlimited`, and the `domains`, `email_accounts`, `email_forwarders`, `domain_pointers` limits (null = unlimited; `email_accounts` excludes the system mailbox). A 404 means the package does not exist.

#### update_package
`update_package(name, quota?, domains?, email_accounts?, email_forwarders?, domain_pointers?)`

Updates a package's limits; at least one field must be provided, omitted fields keep their current values. `quota` is in GB here (the reseller user quota is in MB). Changes affect every user on the package. A 404 means the package does not exist. Returns a success message.

#### delete_package
`delete_package(name)`

Deletes a package. Fails with 422 while any user is still on the package; move affected users to another package first (`set_reseller_user_package`). Returns a success message.

### Input formats

Recurring input formats shared across tools:

| Input | Format and rules |
| --- | --- |
| `domain` | Hostname such as `example.com`; trimmed and lowercased before validation. Letters, digits, hyphens per label; no leading/trailing hyphen or dot; at least one dot; labels up to 63 characters; total up to 253. |
| Local part (`username`, `user`, `alias`) | 1–64 characters: letters, digits, dot, and the special characters `!#$%&'*+-/=?^_` plus backtick, braces, tilde, and vertical bar. Must not be `.` or `..`. |
| Mailbox password (`password`) | 8–72 characters, and must additionally pass the mail server's character and strength rules (enforced server-side). |
| Reseller user password | Minimum 8 characters, no maximum. |
| Spam entry (`entry`) | Up to 254 characters from letters, digits, and `@ . - _ * + =`; wildcards supported, e.g. `*@trusted.com`. Must not be `.` or `..`. Duplicate matching is case-insensitive. |
| `high_score` | Integer 1–50. |
| Mailbox `quota` | Integer number of MB, 0 or more; 0 = unlimited. |
| Mailbox `limit` | Integer 0–9600 (daily send cap). |
| Package/user limits | Digit string or the literal `"unlimited"`. Units: package `quota` is GB, reseller user `quota` is MB, the other fields are plain counts. |
| Catch-all `type` | One of `fail`, `blackhole`, `address`; `address` input required exactly when type is `address`. |
| Package `name` | Letters, numbers, underscores, and hyphens. |
| Reseller `username` | 1–10 characters, lowercase letters, digits, and underscores. |

## Rate limits

The API allows 200 reads per minute (GET), 60 writes per minute (POST, PATCH, DELETE), and 10 bulk/import requests per minute. Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` (a Unix timestamp) headers.

When a limit is hit, the tool returns a `RATE_LIMITED` error whose hint names the wait derived from the response's `Retry-After` header (falling back to `X-RateLimit-Reset`), e.g. `Wait 30s (Retry-After) before retrying.` The server does not auto-retry: writes are not idempotent, so a blind retry could duplicate a create — let the agent wait out the interval and retry deliberately. While impersonating, the reseller and all impersonated targets share the reseller's rate-limit bucket on that server.

## Error reference

Errors surface as tool results in the form `[CODE] message`, followed by `Field: <field>.` for validation errors and `Hint: <hint>.` with the actionable fix when one applies.

| Code | Meaning | What to do |
| --- | --- | --- |
| `VALIDATION_ERROR` | Invalid input; the API rejected a field, and the error names it in `Field:`. Also raised locally for path parameters that are `.` or `..`. | Fix the highlighted field and retry. |
| `UNAUTHORIZED` | Invalid or missing credentials. | Check `MXROUTE_API_KEY`, `MXROUTE_SERVER`, `MXROUTE_USERNAME`. Send the complete key unchanged, without the `keyid:` prefix. Create keys at <https://panel.mxroute.com/api-keys.php>. |
| `FORBIDDEN` | The credential lacks permission. | Reseller endpoints need reseller privileges and are unavailable while impersonating a user with `reseller\|user`. |
| `NOT_FOUND` | Resource not found. | Check that the name is spelled exactly and exists on this account/server. |
| `CONFLICT` | The resource already exists (spam entries match case-insensitively). | Inspect the existing resource instead of creating it again. |
| `BUSINESS_ERROR` | The request violates a business rule (e.g. a limit was reached). | See the message. |
| `RATE_LIMITED` | Too many requests. | Wait for the interval named in the hint (from `Retry-After`) before retrying. Limits: 200 reads/min, 60 writes/min, 10 bulk/min. |
| `SERVER_ERROR` | API internal error; also raised locally for a non-JSON response or an unexpected empty response from a documented endpoint. | Retry later; if it persists check MXroute status/discord. A 503 means another update may be in progress on this account — wait a few seconds, re-read the settings, then retry. |
| `CONFIG_MISSING` | Required environment variables are not set; the error hint lists all three required variables (the startup warning names only the missing ones). | Set the three variables in the MCP client's `env` block and restart the client. |
| `TIMEOUT` | The API request exceeded the 30-second per-request timeout. | Retry; if it persists, check network conditions. |
| `NETWORK_ERROR` | Could not reach the API base URL. | Check the network connection and `MXROUTE_API_BASE`. |

## Workflows

### Onboard a new domain

1. `get_verification_key` — returns the key and the exact TXT record to publish.
2. Add the TXT record at the registrar (outside this API): name `<key>.<yourdomain>`, value `domain-verified`.
3. Wait for DNS propagation — typically 5–15 minutes.
4. `create_domain` with `{ "domain": "example.com" }`.
5. `get_dns_records` for the domain — apply the returned MX, SPF, and DKIM records at the registrar.

### Create a mailbox

1. `create_email_account` with the domain, `username` (local part), and `password`. Optional: `quota` in MB (default 1024, 0 = unlimited) and `limit`, the daily send limit (0–9600, default 9600).
2. `get_email_account` or `list_email_accounts` to confirm.
3. `update_email_account` later to change password, quota, or limit; omitted fields stay unchanged.

### Forward an alias to Gmail

1. `create_forwarder` with the domain, `alias` (local part), and `destinations: ["user@gmail.com"]`.
2. Side effect: forwarding to Gmail (or Yahoo/AOL-like providers) auto-enables Expert Spam Filtering for the domain. Use `get_spam_settings` and `update_spam_settings` if the threshold needs adjusting.
3. `delete_forwarder` to remove the alias.

### Manage spam filtering

1. `add_spam_whitelist_entry` with `*@trusted.com` to whitelist a trusted sender — wildcards cover the whole domain. To block instead, use `add_spam_blacklist_entry`.
2. `get_spam_settings` to read the current `high_score`, then `update_spam_settings` to tune it — lower values delete more aggressively, higher values keep more mail (integer 1–50).
3. Remember the lists are account-wide: an entry added through one domain applies to every domain on the account, and duplicates match case-insensitively (409).

### Set a catch-all

1. `get_catch_all` to inspect the current setting.
2. `set_catch_all` to change it: `fail` rejects mail to unknown addresses, `blackhole` silently discards it, `address` forwards it to a chosen mailbox or forwarder. The `address` parameter is required exactly when the type is `address`.

### Run a reseller account

1. `create_package` to define the plan — unset limits default to quota 1 GB, 1 domain, 100 email accounts, 100 forwarders, 10 domain pointers.
2. `create_reseller_user` with the new package (the package must exist first; 422 otherwise).
3. `set_reseller_user_package` later to move a user to a different plan; `update_package` to change limits for everyone on a package.
4. `suspend_reseller_user` / `unsuspend_reseller_user` for non-payment-style scenarios — access blocked, data kept.
5. These tools require the plain reseller username; they return `FORBIDDEN` while impersonating a user.

### Investigate quota usage

1. `get_disk_quota` for account-level usage in bytes, including the per-category breakdown and any over-quota grace period.
2. `get_email_usage` to find the largest mailboxes.
3. Trim by lowering a mailbox's `quota` via `update_email_account` or removing unused mailboxes with `delete_email_account`. Both quota tools refresh hourly, so re-check after changes lag by up to an hour.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `UNAUTHORIZED` | Check `MXROUTE_API_KEY`, `MXROUTE_SERVER`, and `MXROUTE_USERNAME`. Send the complete key unchanged, without the `keyid:` prefix. Create keys at <https://panel.mxroute.com/api-keys.php>. |
| `CONFIG_MISSING` at call time | The environment variables were not passed to the server process. Check the `env` block in the MCP client config; the server itself starts without credentials. |
| `FORBIDDEN` | The credential lacks permission: reseller endpoints need reseller privileges, and they are unavailable while impersonating a user with `reseller\|user`. |
| `RATE_LIMITED` | Wait for the interval named in the error message (from `Retry-After`) before retrying. Limits: 200 reads/min, 60 writes/min, 10 bulk/min. |
| `CONFLICT` (409) | The resource already exists; spam list entries match case-insensitively. |
| `TIMEOUT` / `NETWORK_ERROR` | The request exceeded 30 seconds or the API base could not be reached. Check the network connection and `MXROUTE_API_BASE`; retry. |
| `SERVER_ERROR` with "unexpected empty response" | The API returned an empty or unexpected body for a documented endpoint. Retry the call; if it persists, the API contract may have changed. |
| 503 on settings or account updates | Another update on this account is in progress. Wait a few seconds, re-read the current settings, then retry. |
| Tools do not appear in the client | Restart the MCP client after changing its config. |

## Development

```bash
git clone <this repository>
cd mxroute-mcp
npm install
npm run build
npm test
npm run inspect
```

- `npm run build` — compile TypeScript to `build/`.
- `npm run typecheck` — type-check without emitting.
- `npm run typecheck:tests` — type-check the test files (and src) without emitting.
- `npm test` — run the vitest suite; tests run against a mocked `fetch`, so no credentials are needed.
- `npm run inspect` — start the server under the MCP Inspector for interactive testing.

Project structure:

```text
src/
  index.ts               Entry point: stdio transport, config load, tool registration
  client.ts              REST client: auth headers, 30s timeout, error mapping, path encoding
  config.ts              Environment-variable configuration loading
  errors.ts              ApiError type and MCP result formatting
  schemas.ts             Shared zod input validators with agent-facing descriptions
  types.ts               TypeScript types for the API payloads
  tools/
    account.ts           1 tool: verification key
    domains.ts           5 tools: domain list/create/get/delete, mail hosting toggle
    pointers.ts          3 tools: domain pointer list/create/delete
    emailAccounts.ts     5 tools: mailbox list/create/get/update/delete
    forwarders.ts        3 tools: forwarder list/create/delete
    spam.ts              8 tools: spam settings and sender lists
    dns.ts               1 tool: DNS records
    catchAll.ts          2 tools: catch-all get/set
    quota.ts             2 tools: disk quota and per-mailbox usage
    resellerUsers.ts     8 tools: reseller user management
    resellerPackages.ts  5 tools: reseller package management
tests/
  config.test.ts         Configuration loading
  schemas.test.ts        Input validators
  client.test.ts         Client behavior: errors, timeout, path encoding
  tools.test.ts          All 43 tools against a mocked fetch
```

The suite is 157 tests across four files, all running against a mocked `fetch` — no credentials or network access are needed. CI (GitHub Actions) runs on Node 20 and 22 with `npm ci`, `npm run build`, `npm run typecheck:tests`, and `npm test` on every push and pull request. Publishing: `prepublishOnly` builds before the package is packed, and the `files` field ships only the compiled `build/` directory (`bin.mxroute-mcp` points at `build/index.js`).

## License

MIT. See [LICENSE](LICENSE).
