import { describe, expect, it } from "vitest";

import {
  catchAllSchema,
  domainSchema,
  limitValueSchema,
  localPartSchema,
  passwordSchema,
  resellerPasswordSchema,
  resellerUsernameSchema,
  spamEntrySchema,
} from "../src/schemas.js";

/** Hostname built from labels of `n` "a" chars joined with dots. */
function domainOf(...labelLengths: number[]): string {
  return labelLengths.map((n) => "a".repeat(n)).join(".");
}

describe("domainSchema", () => {
  it("normalizes case and surrounding whitespace", () => {
    expect(domainSchema.parse("  EXAMPLE.COM ")).toBe("example.com");
    expect(domainSchema.parse("Example.COM")).toBe("example.com");
  });

  it("accepts valid hostnames, including 63-char labels and 253-char totals", () => {
    const maxLabel = domainOf(63) + ".com";
    const maxLength = domainOf(63, 63, 63, 61); // 63*3 + 61 + 3 dots = 253
    expect(maxLength).toHaveLength(253);
    for (const good of ["example.com", "my-domain.co.uk", "sub.example.com", maxLabel, maxLength]) {
      expect(domainSchema.safeParse(good).success, good.slice(0, 20)).toBe(true);
    }
  });

  it("rejects malformed hostnames", () => {
    for (const bad of [
      "-bad.com",
      "example",
      "a..b",
      "a.b.c-",
      ".example.com",
      "example.com.",
      domainOf(64) + ".com", // label over 63 chars
      domainOf(63, 63, 63, 62), // 254 chars total
      "under_score.example.com", // underscores are not valid hostname labels
    ]) {
      expect(domainSchema.safeParse(bad).success, bad.slice(0, 20)).toBe(false);
    }
  });
});

describe("localPartSchema", () => {
  it("accepts dot-atom local parts with plus tags", () => {
    expect(localPartSchema.parse("first.last+tag")).toBe("first.last+tag");
    for (const good of ["your_mailbox", "a+b", "u!#$%&'*+-/=?^_`{|}~."]) {
      expect(localPartSchema.safeParse(good).success, good).toBe(true);
    }
  });

  it("rejects empty parts, spaces, @, and over-64-char parts", () => {
    for (const bad of ["", "first last", "a@b", `${"a".repeat(65)}`]) {
      expect(localPartSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("rejects the bare dot segments '.' and '..' (URL path traversal)", () => {
    for (const bad of [".", ".."]) {
      const res = localPartSchema.safeParse(bad);
      expect(res.success, bad).toBe(false);
      if (!res.success) {
        expect(res.error.issues.map((issue) => issue.message)).toContain("Must not be '.' or '..'");
      }
    }
  });
});

describe("passwordSchema", () => {
  it("enforces the 8-72 character bounds", () => {
    expect(passwordSchema.safeParse("1234567").success).toBe(false); // 7
    expect(passwordSchema.safeParse("12345678").success).toBe(true); // 8
    expect(passwordSchema.safeParse("x".repeat(72)).success).toBe(true); // 72
    expect(passwordSchema.safeParse("x".repeat(73)).success).toBe(false); // 73
  });
});

describe("resellerPasswordSchema", () => {
  it("enforces the 8-character minimum but sets no maximum (spec has none)", () => {
    expect(resellerPasswordSchema.safeParse("1234567").success).toBe(false); // 7
    expect(resellerPasswordSchema.safeParse("12345678").success).toBe(true); // 8
    expect(resellerPasswordSchema.safeParse("x".repeat(73)).success).toBe(true); // 73
    expect(resellerPasswordSchema.safeParse("x".repeat(500)).success).toBe(true); // 500
  });
});

describe("spamEntrySchema", () => {
  it("accepts wildcard and plain address entries", () => {
    expect(spamEntrySchema.parse("*@trusted.com")).toBe("*@trusted.com");
    expect(spamEntrySchema.parse("user@dom.com")).toBe("user@dom.com");
  });

  it("rejects slashes, spaces, and empty entries", () => {
    for (const bad of ["foo/bar", "foo bar", ""]) {
      expect(spamEntrySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("rejects the bare dot segments '.' and '..' (URL path traversal)", () => {
    for (const bad of [".", ".."]) {
      const res = spamEntrySchema.safeParse(bad);
      expect(res.success, bad).toBe(false);
      if (!res.success) {
        expect(res.error.issues.map((issue) => issue.message)).toContain("Must not be '.' or '..'");
      }
    }
  });
});

describe("catchAllSchema", () => {
  it("requires an address exactly when type is address (both directions)", () => {
    for (const good of [
      { type: "fail" },
      { type: "blackhole" },
      { type: "address", address: "me@example.com" },
    ]) {
      expect(catchAllSchema.safeParse(good).success, JSON.stringify(good)).toBe(true);
    }

    const missing = catchAllSchema.safeParse({ type: "address" });
    expect(missing.success).toBe(false);
    if (missing.success) throw new Error("expected the schema to reject");
    expect(missing.error.issues.map((issue) => issue.message)).toContain(
      'address is required when type is "address"',
    );

    const extra = catchAllSchema.safeParse({ type: "blackhole", address: "me@example.com" });
    expect(extra.success).toBe(false);
    if (extra.success) throw new Error("expected the schema to reject");
    expect(extra.error.issues.map((issue) => issue.message)).toContain(
      'address must be omitted unless type is "address"',
    );
  });

  it("rejects unknown types and non-address values", () => {
    expect(catchAllSchema.safeParse({ type: "discard" }).success).toBe(false);
    expect(catchAllSchema.safeParse({ type: "address", address: "not-an-email" }).success).toBe(false);
  });
});

describe("limitValueSchema", () => {
  it("accepts whole numbers, zero, and the literal unlimited", () => {
    expect(limitValueSchema.parse("1024")).toBe("1024");
    expect(limitValueSchema.parse("0")).toBe("0");
    expect(limitValueSchema.parse("unlimited")).toBe("unlimited");
  });

  it("rejects anything that is not digits or the literal unlimited", () => {
    for (const bad of ["10gb", "-1", "1.5", "", " 1024", "UNLIMITED", "1024 "]) {
      expect(limitValueSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("resellerUsernameSchema", () => {
  it("accepts 1-10 char lowercase/digit/underscore usernames", () => {
    expect(resellerUsernameSchema.parse("johndoe")).toBe("johndoe");
    expect(resellerUsernameSchema.safeParse("johndoe_1").success).toBe(true); // 9 chars
    expect(resellerUsernameSchema.safeParse("j").success).toBe(true);
  });

  it("rejects uppercase, 11+ chars, hyphens, and empty strings", () => {
    for (const bad of ["JohnDoe", "abcdefghijk", "john-doe", ""]) {
      expect(resellerUsernameSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
