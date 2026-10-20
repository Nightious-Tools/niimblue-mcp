import { it, expect } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";

it("NIIMBLUE_APP_URL: drops the hash (makeLink appends #load=), rejects non-http(s)", () => {
  expect(loadConfig({ NIIMBLUE_APP_URL: "https://x.test/app#a" }).appUrl).toBe("https://x.test/app");
  expect(() => loadConfig({ NIIMBLUE_APP_URL: "javascript:alert(1)" })).toThrow(/http/);
  expect(() => loadConfig({ NIIMBLUE_APP_URL: "niim.blue" })).toThrow(/NIIMBLUE_APP_URL=niim.blue: must be http/);
});

it("NIIMBLUE_TEMPLATES_DIR: defaults to ~/Documents/NiimBlue Templates", () => {
  expect(loadConfig({}).templatesDir).toBe(join(homedir(), "Documents", "NiimBlue Templates"));
  expect(loadConfig({ NIIMBLUE_TEMPLATES_DIR: "/x/t" }).templatesDir).toBe("/x/t");
});
