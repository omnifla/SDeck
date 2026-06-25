import { createEventBus } from "./bus";
import { createStateStore } from "./store";
import { createConfigManager } from "./config";
import { createPluginHost } from "./plugins/host";
import { startTransport } from "./transport/serial";
import { startServer } from "./transport/websocket";

const SERIAL_PORT = process.env.DECK_PORT ?? "/dev/ttyACM0";
const WS_PORT = Number(process.env.DECK_WS_PORT ?? 4242);
const PLUGINS_DIR = process.env.DECK_PLUGINS_DIR ?? "./plugins";
const PROFILES_DIR = process.env.DECK_PROFILES_DIR ?? "./profiles";

async function main() {
  console.log("── deck-daemon starting ──────────────────────────────");

  const bus = createEventBus();
  const store = createStateStore("./deck.db");
  const config = createConfigManager(PROFILES_DIR);
  const host = createPluginHost(PLUGINS_DIR, bus, store, config);

  // Start transport (USB serial to hardware)
  await startTransport(SERIAL_PORT, bus);

  // Start WebSocket server (for config UI)
  startServer(WS_PORT, bus, config);

  // Load all plugins from the plugins/ directory
  await host.loadAll();

  console.log("── deck-daemon ready ─────────────────────────────────");
  console.log(
    `   Plugins loaded : ${
      host
        .getLoaded()
        .map((p) => p.name)
        .join(", ") || "none"
    }`,
  );
  console.log(
    `   Active profile : ${config.getActiveProfile()?.name ?? "none"}`,
  );
  console.log(`   Config UI      : http://localhost:${WS_PORT}`);

  // Log errors from the bus
  bus.on("error", ({ source, error }) => {
    console.error(`[error] from ${source}:`, error);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
