import { it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

it("NIIMBLUE_APP_URL: drops the hash (makeLink appends #load=), rejects non-http(s)", () => {
  expect(loadConfig({ NIIMBLUE_APP_URL: "https://x.test/app#a" }).appUrl).toBe("https://x.test/app");
  expect(() => loadConfig({ NIIMBLUE_APP_URL: "javascript:alert(1)" })).toThrow(/http/);
  expect(() => loadConfig({ NIIMBLUE_APP_URL: "niim.blue" })).toThrow(/NIIMBLUE_APP_URL=niim.blue: must be http/);
});
