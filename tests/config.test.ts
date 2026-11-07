import { describe, expect, it } from "vitest";

import { loadConfig, REQUIRED_ENV_VARS } from "../src/config.js";

const FULL_ENV = {
  MXROUTE_API_KEY: " key ",
  MXROUTE_SERVER: " eagle.mxlogin.com ",
  MXROUTE_USERNAME: " johndoe ",
};

describe("loadConfig", () => {
  it("reports every required variable as missing when env is empty", () => {
    const { config, missing } = loadConfig({});
    expect(config).toBeNull();
    expect(missing).toEqual([...REQUIRED_ENV_VARS]);
  });

  it("reports blank values as missing, in declaration order", () => {
    const { config, missing } = loadConfig({
      MXROUTE_API_KEY: "key",
      MXROUTE_SERVER: "   ",
    });
    expect(config).toBeNull();
    expect(missing).toEqual(["MXROUTE_SERVER", "MXROUTE_USERNAME"]);
  });

  it("returns a trimmed config when all required variables are set", () => {
    const { config, missing } = loadConfig(FULL_ENV);
    expect(missing).toEqual([]);
    expect(config).toEqual({
      apiKey: "key",
      server: "eagle.mxlogin.com",
      username: "johndoe",
      baseUrl: "https://api.mxroute.com",
    });
  });

  it("uses MXROUTE_API_BASE and strips trailing slashes", () => {
    const { config } = loadConfig({
      ...FULL_ENV,
      MXROUTE_API_BASE: "https://staging.example.com///",
    });
    expect(config?.baseUrl).toBe("https://staging.example.com");
  });

  it("falls back to the default base URL when MXROUTE_API_BASE is blank", () => {
    const { config } = loadConfig({ ...FULL_ENV, MXROUTE_API_BASE: "///" });
    expect(config?.baseUrl).toBe("https://api.mxroute.com");
  });
});
