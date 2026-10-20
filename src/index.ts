#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";
import { loadConfig } from "./config.js";
import { Logger } from "./util/log.js";

async function main() {
  const cfg = loadConfig();
  const log = new Logger(cfg.logLevel);
  // one McpServer per connection (plus a discarded discover probe): the factory is cheap, Chrome starts per render
  const handle = serveStdio(() => createServer({ cfg, logger: log }), { onerror: (e) => log.error("transport error", { message: e.message }) });
  log.info(`${SERVER_NAME} v${SERVER_VERSION} ready on stdio`, { appUrl: cfg.appUrl, chrome: cfg.chromePath ?? "auto" });
  const shutdown = async () => { await handle.close().catch(() => {}); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  process.stderr.write(`fatal: ${e?.stack ?? e}\n`);
  process.exit(1);
});
