import { Database } from "bun:sqlite";
import type { StateStore } from "../types";

// In-memory Map for fast reads, Bun's built-in SQLite for persistence.
// No native modules needed — bun:sqlite is built into the runtime.

export function createStateStore(dbPath = "deck.db"): StateStore {
  const memory = new Map<string, unknown>();

  const db = new Database(dbPath, { create: true });
  db.exec(`
    CREATE TABLE IF NOT EXISTS state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Hydrate memory from disk on startup
  const rows = db.query<{ key: string; value: string }, []>("SELECT key, value FROM state").all();
  for (const row of rows) {
    try { memory.set(row.key, JSON.parse(row.value)); } catch {}
  }
  console.log(`[store] loaded ${rows.length} keys from SQLite (${dbPath})`);

  const upsert = db.prepare("INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)");
  const del    = db.prepare("DELETE FROM state WHERE key = ?");

  return {
    get<T>(key: string): T | undefined {
      return memory.get(key) as T | undefined;
    },
    set<T>(key: string, value: T): void {
      memory.set(key, value);
      upsert.run(key, JSON.stringify(value));
    },
    delete(key: string): void {
      memory.delete(key);
      del.run(key);
    },
  };
}