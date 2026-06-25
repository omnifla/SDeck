import { Elysia, t } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import type { EventBus } from "../types";
import type { ConfigManager } from "../config";
import {
  loadDaemonConfig,
  saveDaemonConfig,
  type DaemonConfig,
} from "../config/manager";

// WebSocket message protocol
// Client → Daemon:  { type: "getConfig" | "saveConfig" | "getProfiles" | "setProfile" | "ping", ...payload }
// Daemon → Client:  { type: "config" | "configSaved" | "profiles" | "displayUpdate" | "pluginStatus" | "error" | "pong", ...payload }

export function startServer(
  port: number,
  bus: EventBus,
  config: ConfigManager,
) {
  const app = new Elysia()
    // ── Serve config UI ─────────────────────────────────────────────────────
    .use(
      staticPlugin({
        assets: "ui",
        prefix: "/",
        indexHTML: true,
      }),
    )

    // ── WebSocket ────────────────────────────────────────────────────────────
    .ws("/ws", {
      // Declare messages as strings so Elysia doesn't auto-parse JSON
      body: t.String(),

      open(ws) {
        // Send current state on connect
        ws.send(JSON.stringify({ type: "config", data: loadDaemonConfig() }));
        ws.send(
          JSON.stringify({ type: "profiles", data: config.getAllProfiles() }),
        );
      },

      message(ws, raw) {
        try {
          // Elysia auto-parses JSON messages, so raw may already be an object
          const msg = (typeof raw === "string" ? JSON.parse(raw) : raw) as {
            type: string;
            [k: string]: unknown;
          };

          switch (msg.type) {
            case "getConfig":
              ws.send(
                JSON.stringify({ type: "config", data: loadDaemonConfig() }),
              );
              break;

            case "saveConfig": {
              const incoming = msg.data as DaemonConfig;
              saveDaemonConfig(incoming);

              // Hot-apply integration credentials so restart isn't always needed
              const { homeAssistant, obs, spotify } = incoming.integrations;
              if (homeAssistant.url) process.env.HA_URL = homeAssistant.url;
              if (homeAssistant.token)
                process.env.HA_TOKEN = homeAssistant.token;
              if (obs.url) process.env.OBS_WS_URL = obs.url;
              if (obs.password) process.env.OBS_WS_PASSWORD = obs.password;
              if (spotify.token) process.env.SPOTIFY_TOKEN = spotify.token;

              ws.send(JSON.stringify({ type: "configSaved" }));
              // Broadcast updated config to all clients
              app.server?.publish(
                "deck",
                JSON.stringify({ type: "config", data: incoming }),
              );
              break;
            }

            case "getProfiles":
              ws.send(
                JSON.stringify({
                  type: "profiles",
                  data: config.getAllProfiles(),
                }),
              );
              break;

            case "setProfile":
              config.setActiveProfile(msg.name as string);
              app.server?.publish(
                "deck",
                JSON.stringify({
                  type: "profiles",
                  data: config.getAllProfiles(),
                }),
              );
              break;

            case "ping":
              ws.send(JSON.stringify({ type: "pong" }));
              break;
          }
        } catch (err) {
          ws.send(JSON.stringify({ type: "error", message: String(err) }));
        }
      },

      close() {},
    })

    .listen(port);

  // ── Forward bus events to all WS clients via pub/sub ────────────────────
  bus.on("displayUpdate", (update) =>
    app.server?.publish(
      "deck",
      JSON.stringify({ type: "displayUpdate", data: update }),
    ),
  );
  bus.on("pluginLoaded", ({ name }) =>
    app.server?.publish(
      "deck",
      JSON.stringify({ type: "pluginStatus", data: { [name]: true } }),
    ),
  );
  bus.on("pluginUnloaded", ({ name }) =>
    app.server?.publish(
      "deck",
      JSON.stringify({ type: "pluginStatus", data: { [name]: false } }),
    ),
  );

  console.log(`[server] config UI → http://localhost:${port}`);
  console.log(`[server] WebSocket  → ws://localhost:${port}/ws`);

  return app;
}
