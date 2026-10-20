/** Runtime configuration, read from environment variables (see .env.example). */

export type LogLevel = "silent" | "error" | "info" | "debug";

export interface Config {
  chromePath?: string; // unset: findChrome() searches the platform's usual install paths
  appUrl: string;      // link base; http(s), no hash (makeLink appends "#load=")
  logLevel: LogLevel;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const lvl = (env.NIIMBLUE_LOG_LEVEL ?? "info") as LogLevel;
  const raw = env.NIIMBLUE_APP_URL || "https://niim.blue/", u = URL.canParse(raw) ? new URL(raw) : null;
  if (!u || (u.protocol !== "http:" && u.protocol !== "https:")) throw new Error(`Invalid NIIMBLUE_APP_URL=${env.NIIMBLUE_APP_URL}: must be http(s)`);
  u.hash = "";
  return {
    chromePath: env.NIIMBLUE_CHROME || undefined,
    appUrl: u.href,
    logLevel: ["silent", "error", "info", "debug"].includes(lvl) ? lvl : "info",
  };
}
