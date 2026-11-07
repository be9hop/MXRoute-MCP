# mxroute-mcp

`mxroute-mcp` is an MCP (Model Context Protocol) stdio server that wraps the MXroute Email Hosting REST API (`https://api.mxroute.com`). It lets AI agents manage MXroute email hosting end to end: domains, mailboxes, forwarders, spam settings, DNS records, quotas, and reseller users and packages. It exposes 43 tools and is designed to be run by an MCP client such as Claude Desktop or Cursor. Requires Node.js 20 or newer.

## Tools

### Account

| Tool | Description |
| --- | --- |
| `get_verification_key` | Returns the account verification key to add as a DNS TXT record before adding new domains. |

### Domains

| Tool | Description |
| --- | --- |
| `list_domains` | Lists all domains on the account. |
| `create_domain` | Adds a new domain (the verification TXT record must already exist). |
| `get_domain` | Gets details for one domain. |
| `delete_domain` | Deletes a domain. |
| `set_domain_mail_hosting` | Enables or disables mail hosting for a domain. |

### Domain pointers

Domain pointers alias one domain onto another (alias) or redirect it.

| Tool | Description |
| --- | --- |
| `list_domain_pointers` | Lists pointers configured for a domain. |
| `create_domain_pointer` | Adds a pointer; `alias` defaults to true. |
| `delete_domain_pointer` | Removes a pointer. |

### Email accounts

| Tool | Description |
| --- | --- |
| `list_email_accounts` | Lists mailboxes on a domain. |
| `create_email_account` | Creates a mailbox from a local part and password; optional `quota` (MB, default 1024, 0 = unlimited) and `limit` (daily send limit, 0-9600, default 9600). |
| `get_email_account` | Gets one mailbox. |
| `update_email_account` | Updates password, quota, or send limit; omitted fields are unchanged. |
| `delete_email_account` | Deletes a mailbox. |

### Email forwarders

| Tool | Description |
| --- | --- |
| `list_forwarders` | Lists forwarders on a domain. |
| `create_forwarder` | Creates a forwarder for a local part with one or more destinations; `:blackhole:` and `:fail:` are accepted as destinations. Forwarding to Gmail, Yahoo, AOL, or similar providers auto-enables Expert Spam Filtering. |
| `delete_forwarder` | Deletes a forwarder. |

### Spam settings

Sender lists are shared across the account's domains. Entries match case-insensitively; duplicates return 409.

| Tool | Description |
| --- | --- |
| `get_spam_settings` | Gets the spam score threshold (`high_score`). |
| `update_spam_settings` | Sets `high_score` (1-50). |
| `get_spam_whitelist` | Lists whitelisted senders. |
| `add_spam_whitelist_entry` | Adds a whitelist entry. |
| `remove_spam_whitelist_entry` | Removes a whitelist entry. |
| `get_spam_blacklist` | Lists blacklisted senders. |
| `add_spam_blacklist_entry` | Adds a blacklist entry. |
| `remove_spam_blacklist_entry` | Removes a blacklist entry. |

### DNS

| Tool | Description |
| --- | --- |
| `get_dns_records` | Read-only: returns the MX, SPF, DKIM, and verification records to configure at the registrar. |

### Catch-all

| Tool | Description |
| --- | --- |
| `get_catch_all` | Gets the catch-all setting for a domain. |
| `set_catch_all` | Sets the catch-all to `fail`, `blackhole`, or `address` (an address is required for the `address` type). |

### Quota

Both endpoints return data refreshed hourly.

| Tool | Description |
| --- | --- |
| `get_disk_quota` | Gets account disk usage. |
| `get_email_usage` | Gets per-mailbox usage, largest first. |

### Reseller users

Reseller-only. Not available while impersonating a user (see `reseller|user` under Configuration).

| Tool | Description |
| --- | --- |
| `list_reseller_users` | Lists usernames owned by the reseller. |
| `create_reseller_user` | Creates a user: username 1-10 characters `[a-z0-9_]`, password minimum 8 characters, plus email and package. |
| `get_reseller_user` | Gets one user. |
| `update_reseller_user` | Updates quota (digits in MB or `unlimited`) and/or password. |
| `delete_reseller_user` | Deletes a user. |
| `suspend_reseller_user` | Suspends a user. |
| `unsuspend_reseller_user` | Unsuspends a user. |
| `set_reseller_user_package` | Assigns a package to a user (422 when the package does not exist). |

### Reseller packages

Reseller-only. Limit values are digit strings or the literal `unlimited`; package quota is in GB.

| Tool | Description |
| --- | --- |
| `list_packages` | Lists package names. |
| `create_package` | Creates a package; defaults: quota `1` GB, 1 domain, 100 email accounts, 100 forwarders, 10 domain pointers. |
| `get_package` | Gets one package. |
| `update_package` | Updates package limits. |
| `delete_package` | Deletes a package (422 while any user is on it). |

## Configuration

The server reads its configuration from environment variables.

| Variable | Required | Description | Example |
| --- | --- | --- | --- |
| `MXROUTE_API_KEY` | Yes | API key. Send the complete key unchanged (no `keyid:` prefix). | `your-api-key` |
| `MXROUTE_SERVER` | Yes | Mail server hostname. | `eagle.mxlogin.com` |
| `MXROUTE_USERNAME` | Yes | DirectAdmin username. Resellers can send `reseller|user` to act as an owned user. | `your-username` or `your-reseller\|your-user` |
| `MXROUTE_API_BASE` | No | API base URL override. | `https://api.mxroute.com` |

Where to get the values: create an API key at https://panel.mxroute.com/api-keys.php. The server hostname and username are shown on that same page. Account passwords only work if DirectAdmin permits password-based API access (`api_with_password=yes` in the account's user.conf); login keys are unaffected — prefer API keys.

Notes:

- The server starts even without credentials (it prints a warning to stderr) and `tools/list` works, but every tool call returns `CONFIG_MISSING` until all three required variables are set.
- While impersonating with `reseller|user`, reseller endpoints are unavailable.
- Rate limits: 200 reads/min, 60 writes/min, 10 bulk/min. On `RATE_LIMITED` the error message includes the wait from the `Retry-After` header.

## Install and connect

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

## Common workflows

### Onboard a new domain

1. `get_verification_key` — returns the key for the DNS TXT record.
2. Add the TXT record at the registrar (outside this API).
3. `create_domain` with `{ "domain": "example.com" }`.
4. `get_dns_records` for the domain — apply the returned MX, SPF, and DKIM records at the registrar.

### Create a mailbox

1. `create_email_account` with the domain, `username` (local part), and `password`. Optional: `quota` in MB (default 1024, 0 = unlimited) and `limit`, the daily send limit (0-9600, default 9600).
2. `get_email_account` or `list_email_accounts` to confirm.
3. `update_email_account` later to change password, quota, or limit; omitted fields stay unchanged.

### Forward an alias to Gmail

1. `create_forwarder` with the domain, `alias` (local part), and `destinations: ["user@gmail.com"]`.
2. Side effect: forwarding to Gmail (or Yahoo/AOL-like providers) auto-enables Expert Spam Filtering for the domain. Use `get_spam_settings` and `update_spam_settings` if the threshold needs adjusting.
3. `delete_forwarder` to remove the alias.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `UNAUTHORIZED` | Check `MXROUTE_API_KEY`, `MXROUTE_SERVER`, and `MXROUTE_USERNAME`. Send the complete key unchanged, without the `keyid:` prefix. Create keys at https://panel.mxroute.com/api-keys.php. |
| `CONFIG_MISSING` at call time | The environment variables were not passed to the server process. Check the `env` block in the MCP client config; the server itself starts without credentials. |
| `FORBIDDEN` | The credential lacks permission: reseller endpoints need reseller privileges, and they are unavailable while impersonating a user with `reseller\|user`. |
| `RATE_LIMITED` | Wait for the interval named in the error message (from `Retry-After`) before retrying. Limits: 200 reads/min, 60 writes/min, 10 bulk/min. |
| `CONFLICT` (409) | The resource already exists; spam list entries match case-insensitively. |
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

## License

MIT. See [LICENSE](LICENSE).
