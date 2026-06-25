import { watch } from "fs";
import { join, resolve } from "path";
import type { DeckPlugin, EventBus, StateStore, KeyDisplay } from "../types";
import type { ConfigManager } from "../config";

export function createPluginHost(
  pluginsDir: string,
  bus: EventBus,
  store: StateStore,
  config: ConfigManager,
) {
  const loaded = new Map<string, DeckPlugin>();

  async function loadPlugin(filePath: string) {
    const absPath = resolve(filePath);
    try {
      const mod = await import(`${absPath}?t=${Date.now()}`);
      const plugin: DeckPlugin = mod.default;

      if (!plugin?.name || !plugin?.actions) {
        console.warn(`[plugins] ${filePath} has no valid default export`);
        return;
      }

      const old = loaded.get(plugin.name);
      old?.destroy?.();

      loaded.set(plugin.name, plugin);
      plugin.subscribe?.(bus);
      bus.emit("pluginLoaded", { name: plugin.name });
      console.log(`[plugins] loaded: ${plugin.name}`);
    } catch (err) {
      console.error(`[plugins] failed to load ${filePath}:`, err);
      bus.emit("error", { source: filePath, error: err });
    }
  }

  async function loadAll() {
    const glob = new Bun.Glob("*.ts");
    for (const file of glob.scanSync(pluginsDir)) {
      await loadPlugin(join(pluginsDir, file));
    }
  }

  function pushDisplay(update: KeyDisplay) {
    bus.emit("displayUpdate", update);
  }

  bus.on("keyEvent", async (event) => {
    const profile = config.getActiveProfile();
    if (!profile) return;

    const binding = profile.keys[event.keyIndex];
    if (!binding || event.type !== "press") return;

    const plugin = loaded.get(binding.pluginId);
    if (!plugin) {
      console.warn(`[plugins] no plugin loaded for "${binding.pluginId}"`);
      return;
    }

    const action = plugin.actions[binding.actionId];
    if (!action) {
      console.warn(
        `[plugins] no action "${binding.actionId}" in plugin "${binding.pluginId}"`,
      );
      return;
    }

    // Inject profile options into state so plugins can read them without
    // needing direct access to the config manager.
    if (binding.options) {
      store.set(
        `${binding.pluginId}.key.${event.keyIndex}.options`,
        binding.options,
      );
    }

    // Also store entity/scene IDs for HA plugin convenience
    if (binding.entityId)
      store.set(`ha.key.${event.keyIndex}.entityId`, binding.entityId);
    if (binding.sceneId)
      store.set(`ha.key.${event.keyIndex}.sceneId`, binding.sceneId);

    try {
      await action({
        keyIndex: event.keyIndex,
        eventType: event.type,
        state: store,
        pushDisplay,
      });
    } catch (err) {
      console.error(
        `[plugins] action error [${binding.pluginId}.${binding.actionId}]:`,
        err,
      );
      bus.emit("error", {
        source: `${binding.pluginId}.${binding.actionId}`,
        error: err,
      });
    }
  });

  watch(pluginsDir, { recursive: false }, async (event, filename) => {
    if (filename?.endsWith(".ts")) {
      console.log(`[plugins] change detected (${filename}), reloading`);
      await loadPlugin(join(pluginsDir, filename));
    }
  });

  return {
    loadAll,
    getLoaded: () => [...loaded.values()],
  };
}
