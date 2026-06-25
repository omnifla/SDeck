import { watch } from "fs";
import { join } from "path";
import type { Profile } from "../types";

// Daemon config — stored in deck-config.json next to the profiles folder
export interface DaemonConfig {
  serial: {
    port: string;
    mock: boolean;
  };
  server: {
    wsPort: number;
  };
  plugins: {
    enabled: Record<string, boolean>; // pluginId → enabled
  };
  integrations: {
    homeAssistant: { url: string; token: string };
    obs: { url: string; password: string };
    spotify: { token: string };
  };
}

const CONFIG_PATH = "./deck-config.json";

const DEFAULTS: DaemonConfig = {
  serial: { port: "COM3", mock: false },
  server: { wsPort: 4242 },
  plugins: {
    enabled: { "home-assistant": true, obs: true, shell: true, spotify: false },
  },
  integrations: {
    homeAssistant: { url: "http://homeassistant.local:8123", token: "" },
    obs: { url: "ws://localhost:4455", password: "" },
    spotify: { token: "" },
  },
};

export async function loadDaemonConfig(): Promise<DaemonConfig> {
  try {
    const raw = await Bun.file(CONFIG_PATH).text();
    const parsed = JSON.parse(raw) as Partial<DaemonConfig>;

    // Deep merge with defaults so new fields appear automatically

    return deepMerge(DEFAULTS, parsed) as DaemonConfig;
  } catch {
    // First run — write defaults

    await Bun.file(CONFIG_PATH).write(JSON.stringify(DEFAULTS, null, 2));
    console.log(`[config] created ${CONFIG_PATH} with defaults`);
    return { ...DEFAULTS };
  }
}

export async function saveDaemonConfig(config: DaemonConfig): Promise<void> {
  await Bun.file(CONFIG_PATH).write(JSON.stringify(config, null, 2));
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (typeof base !== "object" || base === null) return override ?? base;
  if (typeof override !== "object" || override === null) return base;
  const result: Record<string, unknown> = {
    ...(base as Record<string, unknown>),
  };
  for (const key of Object.keys(override as Record<string, unknown>)) {
    result[key] = deepMerge(
      result[key],
      (override as Record<string, unknown>)[key],
    );
  }
  return result;
}
