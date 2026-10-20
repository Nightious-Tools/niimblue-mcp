import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { NbError } from "./util/errors.js";

const INSTALL = "install Google Chrome or Microsoft Edge (NiimBlue needs one to print anyway) or set NIIMBLUE_CHROME";
const LINUX = ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser", "microsoft-edge-stable", "microsoft-edge"];
const MAC = ["Google Chrome.app/Contents/MacOS/Google Chrome", "Chromium.app/Contents/MacOS/Chromium", "Microsoft Edge.app/Contents/MacOS/Microsoft Edge"];
// --no-sandbox always: the page is our own bundle with schema-bounded input and no network; avoids root/container/AppArmor failures.
// --disable-gpu: identical pixels on Linux and macOS, and no GPU start-up in the render path (a cold Windows run read back blank)
const ARGS = ["--headless", "--remote-debugging-pipe", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
  "--disable-background-networking", "--disable-sync", "--mute-audio", "--force-device-scale-factor=1", "--force-color-profile=srgb", "--disable-gpu"];

/** NIIMBLUE_CHROME, else the platform's usual Chrome/Chromium/Edge paths; none found → NbError CHROME_NOT_FOUND. */
export function findChrome(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = existsSync): string {
  const set = env.NIIMBLUE_CHROME;
  if (set) { if (exists(set)) return set; throw new NbError("CHROME_NOT_FOUND", `NIIMBLUE_CHROME=${set} does not exist: fix the path or unset it`); }
  const pf = [env.ProgramFiles, env["ProgramFiles(x86)"]].filter(Boolean);
  const paths = platform === "win32"
    ? [...[...pf, env.LOCALAPPDATA].filter(Boolean).map((d) => `${d}\\Google\\Chrome\\Application\\chrome.exe`), ...pf.map((d) => `${d}\\Microsoft\\Edge\\Application\\msedge.exe`)]
    : platform === "darwin"
      ? MAC.flatMap((a) => [`/Applications/${a}`, `${env.HOME}/Applications/${a}`])
      : LINUX.flatMap((n) => (env.PATH ?? "").split(":").filter(Boolean).map((d) => join(d, n)));
  const hit = paths.find(exists);
  if (hit) return hit;
  throw new NbError("CHROME_NOT_FOUND", `No Chrome, Chromium or Edge found: ${INSTALL}`);
}

/** Splits CDP `\0`-terminated frames; `rest` is the unterminated tail to prepend to the next chunk. */
export function splitFrames(rest: string, chunk: string): { frames: string[]; rest: string } {
  const frames = (rest + chunk).split("\0");
  return { frames, rest: frames.pop()! };
}

/** One headless Chrome over --remote-debugging-pipe: evaluate `pageJs`, then `niimRender(input)`. */
// shortcut: one Chrome per render (≈0.5–1 s cold), keep one warm if latency matters
export async function runInChrome(bin: string, pageJs: string, input: unknown, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<unknown> {
  if (opts.signal?.aborted) throw new NbError("RENDER_TIMEOUT", "Render aborted");
  const dir = await mkdtemp(join(tmpdir(), "niimblue-"));
  const child = spawn(bin, [...ARGS, `--user-data-dir=${dir}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  const closed = new Promise<void>((r) => child.once("close", () => r()));
  let fail!: (e: NbError) => void;
  const failed = new Promise<never>((_, rej) => { fail = rej; });
  failed.catch(() => {}); // late failures (exit after Browser.close) are expected
  // shortcut: SIGKILL leaves Chrome's own com.google.Chrome.* temp dirs in os.tmpdir() (TMPDIR can't move them: unix socket path limit); try Browser.close first if they pile up
  const kill = (e: NbError) => { child.kill("SIGKILL"); fail(e); };
  const timer = setTimeout(() => kill(new NbError("RENDER_TIMEOUT", `Render took over ${opts.timeoutMs / 1000} s: simplify the label`)), opts.timeoutMs);
  const onAbort = () => kill(new NbError("RENDER_TIMEOUT", "Render aborted"));
  opts.signal?.addEventListener("abort", onAbort);

  let stderr = "";
  child.stderr!.setEncoding("utf8").on("data", (d: string) => { stderr = (stderr + d).slice(-1024); });
  child.on("error", (e: NodeJS.ErrnoException) => fail(e.code === "ENOENT" || e.code === "EACCES"
    ? new NbError("CHROME_NOT_FOUND", `Cannot run ${bin} (${e.code}): ${INSTALL}`)
    : new NbError("RENDER_FAILED", `Cannot start Chrome: ${e.message}`)));
  child.on("exit", (code, sig) => fail(new NbError("RENDER_FAILED", `Chrome exited (${sig ?? code}) before replying: ${stderr.trim()}`)));

  const [, , , toChrome, fromChrome] = child.stdio as [unknown, unknown, unknown, Writable, Readable];
  toChrome.on("error", () => {}); // EPIPE when Chrome dies; the exit handler reports it
  const pending = new Map<number, (m: any) => void>();
  let rest = "", id = 0;
  fromChrome.setEncoding("utf8").on("data", (chunk: string) => {
    const r = splitFrames(rest, chunk); rest = r.rest;
    for (const f of r.frames) { const m = JSON.parse(f); pending.get(m.id)?.(m); pending.delete(m.id); }
  });
  const call = (method: string, params: object = {}, sessionId?: string) => Promise.race([failed, new Promise<any>((res, rej) => {
    pending.set(++id, (m) => m.error ? rej(new NbError("RENDER_FAILED", `${method}: ${m.error.message}`)) : res(m.result));
    toChrome.write(JSON.stringify({ id, method, params, sessionId }) + "\0");
  })]);

  try {
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    const evaluate = async (expression: string, more = {}) => {
      const r = await call("Runtime.evaluate", { expression, ...more }, sessionId);
      if (r.exceptionDetails) throw new NbError("RENDER_FAILED", String(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).split("\n")[0]);
      return r.result.value;
    };
    await evaluate(pageJs);
    const value = await evaluate(`niimRender(${JSON.stringify(input)})`, { awaitPromise: true, returnByValue: true });
    await call("Browser.close").catch(() => {});
    await closed; // graceful exit before rm; the timer still SIGKILLs a Chrome that hangs on close
    return value;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await closed;
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

/** The default `Deps.render`: findChrome + runInChrome(__PAGE_JS__). */
export async function renderLabel(input: PageInput, signal?: AbortSignal): Promise<PageResult> {
  return await runInChrome(findChrome(), __PAGE_JS__, input, { timeoutMs: 30_000, signal }) as PageResult;
}
