import { watch, readFileSync } from "fs";
import { join } from "path";
import type { Profile } from "../types";

export interface ConfigManager {
  getActiveProfile(): Profile | null;
  setActiveProfile(name: string): void;
  getAllProfiles(): Record<string, Profile>;
}

export function createConfigManager(profilesDir: string): ConfigManager {
  let profiles: Record<string, Profile> = {};
  let activeProfileName: string | null = null;

  function loadProfiles() {
    const glob = new Bun.Glob("*.json");
    profiles = {};
    for (const file of glob.scanSync(profilesDir)) {
      try {
        const parsed = JSON.parse(
          readFileSync(join(profilesDir, file), "utf-8"),
        ) as Profile;
        profiles[parsed.name] = parsed;
        console.log(`[config] loaded profile: ${parsed.name}`);
      } catch (err) {
        console.warn(`[config] failed to load ${file}:`, err);
      }
    }

    // Auto-select first profile if none active
    if (!activeProfileName || !profiles[activeProfileName]) {
      activeProfileName = Object.keys(profiles)[0] ?? null;
      if (activeProfileName)
        console.log(`[config] active profile: ${activeProfileName}`);
    }
  }

  loadProfiles();

  // Watch for changes and hot-reload
  watch(profilesDir, { recursive: false }, (event, filename) => {
    if (filename?.endsWith(".json")) {
      console.log(`[config] change detected (${filename}), reloading profiles`);
      loadProfiles();
    }
  });

  return {
    getActiveProfile() {
      return activeProfileName ? (profiles[activeProfileName] ?? null) : null;
    },
    setActiveProfile(name: string) {
      if (!profiles[name]) throw new Error(`Profile "${name}" not found`);
      activeProfileName = name;
      console.log(`[config] switched to profile: ${name}`);
    },
    getAllProfiles() {
      return profiles;
    },
  };
}
