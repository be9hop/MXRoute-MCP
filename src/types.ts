/**
 * TypeScript interfaces for the MXroute Email Hosting API payloads, derived
 * from the OpenAPI schemas (components.schemas plus inline response schemas).
 *
 * Most endpoints wrap payloads in the standard envelope `ApiEnvelope<T>`;
 * the quota endpoints (DiskQuota, EmailUsage) return their data at the top
 * level WITHOUT an envelope.
 */

/** Standard success envelope used by most endpoints. */
export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

/** `components.schemas.Domain` */
export interface Domain {
  domain: string;
  mail_hosting?: boolean;
  ssl_enabled?: boolean;
  /** Domain pointers (aliases) attached to this domain. */
  pointers?: string[];
}

/** `components.schemas.EmailAccount` */
export interface EmailAccount {
  username: string;
  email: string;
  /** Quota in MB (0 = unlimited). */
  quota: number;
  /** Current usage in MB. */
  usage: number;
  /** Daily send limit. */
  limit: number;
  /** Emails sent today. */
  sent: number;
  suspended: boolean;
}

/** `components.schemas.Forwarder` */
export interface Forwarder {
  alias: string;
  email: string;
  destinations: string[];
}

/** `components.schemas.DomainPointer` */
export interface DomainPointer {
  pointer: string;
  type: "alias" | "redirect";
  target: string;
}

/** A single MX record (part of DnsInfo). */
export interface MxRecord {
  priority: number;
  hostname: string;
  description?: string;
}

/** A DNS TXT record (SPF / DKIM / verification). */
export interface DnsRecord {
  type: string;
  name: string;
  value: string;
  description?: string;
}

/** `components.schemas.DnsInfo` — records to configure at the registrar. */
export interface DnsInfo {
  mx_records: MxRecord[];
  spf: DnsRecord;
  dkim: DnsRecord | null;
  verification: DnsRecord | null;
}

/** `components.schemas.CatchAll` */
export interface CatchAll {
  type: "fail" | "blackhole" | "address";
  address: string | null;
  description?: string;
}

/** Nested quota object on ResellerUser. */
export interface ResellerUserQuota {
  limit: number | null;
  used: number;
  unlimited: boolean;
}

/** `components.schemas.ResellerUser` */
export interface ResellerUser {
  username: string;
  email: string;
  domain: string;
  package: string;
  suspended: boolean;
  quota: ResellerUserQuota;
}

/** Nested settings object on Package. */
export interface PackageSettings {
  quota_gb: number | null;
  quota_unlimited: boolean;
  domains: number | null;
  /** Usable customer mailbox limit; excludes the system mailbox. Null = unlimited. */
  email_accounts: number | null;
  email_forwarders: number | null;
  domain_pointers: number | null;
}

/** `components.schemas.Package` */
export interface Package {
  name: string;
  settings: PackageSettings;
}

/** Nested TXT record in VerificationKeyResponse. */
export interface VerificationKeyRecord {
  type: string;
  name: string;
  value: string;
}

/** `GET /verification-key` data (format: `_da-verify-{32 hex chars}`). */
export interface VerificationKeyResponse {
  key: string;
  record: VerificationKeyRecord;
  description?: string;
}

/** `GET /quota` breakdown — usage by category in bytes. */
export interface DiskQuotaBreakdown {
  email: number;
  web: number;
  databases: number;
  backups: number;
  other: number;
}

/** Present when the account has exceeded quota. */
export interface GracePeriod {
  days_remaining: number;
  deadline: string;
}

/**
 * `GET /quota` — overall disk usage. NOT enveloped (username sits at the top
 * level of the response). Data is refreshed hourly.
 */
export interface DiskQuota {
  username: string;
  /** Total bytes used. */
  total_used: number;
  /** Quota limit in bytes (0 = unlimited). */
  total_limit: number;
  percent_used: number;
  breakdown: DiskQuotaBreakdown;
  grace_period: GracePeriod | null;
  updated_at: string;
}

/** One entry in the per-email usage list. */
export interface EmailUsageEntry {
  email_address: string;
  size_bytes: number;
  updated_at: string;
}

/**
 * `GET /quota/email` — per-mailbox disk usage, largest first. NOT enveloped.
 * Data is refreshed hourly.
 */
export interface EmailUsage {
  username: string;
  accounts: EmailUsageEntry[];
}
