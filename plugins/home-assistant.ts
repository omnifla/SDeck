import type { DeckPlugin, EventBus } from "../src/types";

// ── Home Assistant plugin ──────────────────────────────────────────────────────
// Uses the HA WebSocket API for real-time state push.
// Set HA_URL and HA_TOKEN env vars:
//   HA_URL=http://homeassistant.local:8123
//   HA_TOKEN=<your long-lived access token>

const HA_URL   = process.env.HA_URL   ?? "http://homeassistant.local:8123";
const HA_TOKEN = process.env.HA_TOKEN ?? "";

async function callService(domain: string, service: string, data: object) {
  const res = await fetch(`${HA_URL}/api/services/${domain}/${service}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`HA ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getState(entityId: string): Promise<{ state: string; attributes: Record<string, unknown> }> {
  const res = await fetch(`${HA_URL}/api/states/${entityId}`, {
    headers: { Authorization: `Bearer ${HA_TOKEN}` },
  });
  if (!res.ok) throw new Error(`HA ${res.status}`);
  return res.json() as Promise<{ state: string; attributes: Record<string, unknown> }>;
}

let ws: WebSocket | null = null;
let msgId = 1;

function connectWebSocket(bus: EventBus) {
  ws = new WebSocket(`${HA_URL.replace("http", "ws")}/api/websocket`);

  ws.onopen = () => {
    console.log("[home-assistant] WebSocket connected");
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data as string) as Record<string, unknown>;

    if (msg.type === "auth_required") {
      ws!.send(JSON.stringify({ type: "auth", access_token: HA_TOKEN }));
    } else if (msg.type === "auth_ok") {
      // Subscribe to all state_changed events
      ws!.send(JSON.stringify({ id: msgId++, type: "subscribe_events", event_type: "state_changed" }));
    } else if (msg.type === "event") {
      const data = (msg.event as Record<string, unknown>)?.data as Record<string, unknown>;
      if (!data) return;
      // Emit a generic HA state change — plugins or the host can react
      bus.emit("displayUpdate", {
        keyIndex: -1,  // broadcast; the state store should map entity → key
        label: `${data.entity_id}: ${(data.new_state as Record<string, unknown>)?.state}`,
        color: "#03A9F4",
      });
    }
  };

  ws.onclose = () => {
    console.warn("[home-assistant] WebSocket closed, reconnecting in 5s");
    setTimeout(() => connectWebSocket(bus), 5000);
  };
}

const plugin: DeckPlugin = {
  name: "home-assistant",

  actions: {
    async toggleLight({ keyIndex, pushDisplay, state }) {
      const entityId = state.get<string>(`ha.key.${keyIndex}.entityId`) ?? "light.living_room";
      const current = await getState(entityId);
      const isOn = current.state === "on";

      await callService("light", isOn ? "turn_off" : "turn_on", { entity_id: entityId });

      pushDisplay({
        keyIndex,
        label: isOn ? "Off" : "On",
        color: isOn ? "#333333" : "#FFD700",
      });
    },

    async toggleSwitch({ keyIndex, pushDisplay, state }) {
      const entityId = state.get<string>(`ha.key.${keyIndex}.entityId`) ?? "switch.desk_fan";
      const current = await getState(entityId);
      const isOn = current.state === "on";

      await callService("switch", isOn ? "turn_off" : "turn_on", { entity_id: entityId });

      pushDisplay({
        keyIndex,
        label: isOn ? "Off" : "On",
        color: isOn ? "#333333" : "#4CAF50",
      });
    },

    async runScene({ keyIndex, state, pushDisplay }) {
      const sceneId = state.get<string>(`ha.key.${keyIndex}.sceneId`) ?? "scene.evening";
      await callService("scene", "turn_on", { entity_id: sceneId });
      pushDisplay({ keyIndex, label: "Scene", color: "#9C27B0" });
    },
  },

  subscribe(bus: EventBus) {
    connectWebSocket(bus);
  },

  destroy() {
    ws?.close();
    ws = null;
  },
};

export default plugin;