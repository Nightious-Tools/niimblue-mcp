import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChrome, splitFrames, runInChrome } from "../src/chrome.js";
import { CHROME } from "./helpers.js";

const has = (...paths: string[]) => (p: string) => paths.includes(p);

describe("findChrome", () => {
  it("prefers NIIMBLUE_CHROME and rejects a missing one", () => {
    expect(findChrome({ NIIMBLUE_CHROME: "/x/chrome", PATH: "/usr/bin" }, "linux", has("/x/chrome", "/usr/bin/google-chrome"))).toBe("/x/chrome");
    expect(() => findChrome({ NIIMBLUE_CHROME: "/x/chrome" }, "linux", has("/usr/bin/google-chrome"))).toThrow(expect.objectContaining({ code: "CHROME_NOT_FOUND", message: expect.stringContaining("/x/chrome") }));
  });
  it("linux: scans PATH, Chrome before Chromium before Edge", () => {
    const env = { PATH: "/a::/b" };
    expect(findChrome(env, "linux", has("/a/microsoft-edge", "/b/chromium", "/b/google-chrome"))).toBe("/b/google-chrome");
    expect(findChrome(env, "linux", has("/a/microsoft-edge", "/b/chromium-browser"))).toBe("/b/chromium-browser");
    expect(() => findChrome(env, "linux", has())).toThrow(expect.objectContaining({ code: "CHROME_NOT_FOUND" }));
  });
  it("darwin: /Applications then ~/Applications, Chrome first", () => {
    const chrome = "/Users/u/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    expect(findChrome({ HOME: "/Users/u" }, "darwin", has("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", chrome))).toBe(chrome);
  });
  it("win32: Program Files, x86, LocalAppData Chrome, then Edge", () => {
    const env = { ProgramFiles: "C:\\PF", "ProgramFiles(x86)": "C:\\PF86", LOCALAPPDATA: "C:\\U\\L" };
    expect(findChrome(env, "win32", has("C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\U\\L\\Google\\Chrome\\Application\\chrome.exe"))).toBe("C:\\U\\L\\Google\\Chrome\\Application\\chrome.exe");
    expect(findChrome(env, "win32", has("C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe"))).toBe("C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe");
  });
});

describe("splitFrames", () => {
  it("splits across chunk boundaries and keeps the tail", () => {
    let r = splitFrames("", '{"id":1}\0{"id"');
    expect(r).toEqual({ frames: ['{"id":1}'], rest: '{"id"' });
    r = splitFrames(r.rest, ':2}\0{"id":3}\0');
    expect(r).toEqual({ frames: ['{"id":2}', '{"id":3}'], rest: "" });
  });
});

describe("runInChrome", () => {
  it("maps a missing binary to CHROME_NOT_FOUND", async () => {
    await expect(runInChrome("/nonexistent/chrome", "", 0, { timeoutMs: 5000 })).rejects.toMatchObject({ code: "CHROME_NOT_FOUND" });
  });
  it.skipIf(process.platform === "win32")("maps an early exit to RENDER_FAILED", async () => {
    await expect(runInChrome("/bin/false", "", 0, { timeoutMs: 5000 })).rejects.toMatchObject({ code: "RENDER_FAILED", message: expect.stringContaining("exited (1) before replying") });
  });
});

// CI must have Chrome: there it fails rather than skips
describe.skipIf(!CHROME && !process.env.CI)("runInChrome (Chrome)", () => {
  let tmp = "";
  const profiles = () => readdirSync(tmp).filter((n) => n.startsWith("niimblue-"));
  beforeAll(() => { process.env.TMPDIR = tmp = mkdtempSync(join(tmpdir(), "ct-")); }); // isolates the profile dirs; short: Chrome's socket path limit
  afterAll(() => rmSync(tmp, { recursive: true, force: true })); // a SIGKILLed Chrome leaves its own com.google.Chrome.* dirs here
  const run = (pageJs: string, input: unknown = 0, timeoutMs = 20000, signal?: AbortSignal) => runInChrome(findChrome(), pageJs, input, { timeoutMs, signal });

  it("evaluates the page, awaits niimRender(input) and cleans up", async () => {
    expect(await run("niimRender = async (x) => x.a + 1", { a: 1 })).toBe(2);
    expect(profiles()).toEqual([]);
  });
  it("maps a page exception to RENDER_FAILED", async () => {
    await expect(run("niimRender = async () => { throw new Error('FONT_NOT_LOADED: 700') }")).rejects.toMatchObject({ code: "RENDER_FAILED", message: "Error: FONT_NOT_LOADED: 700" });
  });
  it("kills a hung render with RENDER_TIMEOUT, removes the profile, and the next call works", async () => {
    await expect(run("niimRender = () => new Promise(() => {})", 0, 3000)).rejects.toMatchObject({ code: "RENDER_TIMEOUT" });
    expect(profiles()).toEqual([]);
    const ac = new AbortController(); setTimeout(() => ac.abort(), 2000);
    await expect(run("niimRender = () => new Promise(() => {})", 0, 20000, ac.signal)).rejects.toMatchObject({ code: "RENDER_TIMEOUT" });
    expect(await run("niimRender = () => 1 + 1")).toBe(2);
    expect(profiles()).toEqual([]);
  });
});
