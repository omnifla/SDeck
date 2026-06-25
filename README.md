# deck-daemon

Bun-powered daemon for a custom stream deck. Handles USB serial communication
with the firmware, routes key events to plugins, and serves a WebSocket API
for the config UI.

## Quick start

```bash
bun install
bun dev
```

## Environment variables

| Variable           | Default                    | Description                         |
|--------------------|----------------------------|-------------------------------------|
| `DECK_PORT`        | `/dev/ttyACM0`             | USB serial port path                |
| `DECK_WS_PORT`     | `4242`                     | WebSocket port for config UI        |
| `DECK_PLUGINS_DIR` | `./plugins`                | Directory to load plugins from      |
| `DECK_PROFILES_DIR`| `./profiles`               | Directory to load profiles from     |
| `SPOTIFY_TOKEN`    | —                          | Spotify Web API bearer token        |
| `HA_URL`           | `http://homeassistant.local:8123` | Home Assistant base URL      |
| `HA_TOKEN`         | —                          | HA long-lived access token          |

## Project structure

```
deck-daemon/
├── src/
│   ├── index.ts          # Entry point — wires everything together
│   ├── types.ts          # Shared types (DeckPlugin, KeyEvent, etc.)
│   ├── bus/              # Typed event bus
│   ├── transport/
│   │   ├── serial.ts     # USB serial ↔ firmware
│   │   └── websocket.ts  # Config UI WebSocket server
│   ├── plugins/
│   │   └── host.ts       # Plugin loader + hot-reload + event routing
│   ├── store/            # In-memory + SQLite state store
│   └── config/           # Profile loader with fs.watch hot-reload
├── plugins/              # Your plugin files (auto-loaded, hot-reloaded)
│   ├── spotify.ts
│   ├── home-assistant.ts
│   └── shell.ts
└── profiles/             # Button layout JSON files
    └── default.json
```

## Writing a plugin

A plugin is a `.ts` file in `plugins/` with a default export matching `DeckPlugin`:

```ts
import type { DeckPlugin } from "../src/types";

const plugin: DeckPlugin = {
  name: "my-plugin",
  actions: {
    async doSomething({ keyIndex, pushDisplay }) {
      // do stuff
      pushDisplay({ keyIndex, label: "Done", color: "#00FF00" });
    },
  },
};

export default plugin;
```

Drop it in `plugins/` — the daemon hot-reloads it instantly, no restart needed.

## Wire protocol (USB serial)

Firmware → daemon (newline-delimited JSON):
```json
{"t":"press","k":3}
{"t":"release","k":3}
```

Daemon → firmware:
```json
{"k":3,"label":"Play","color":"#1DB954","icon":""}
```