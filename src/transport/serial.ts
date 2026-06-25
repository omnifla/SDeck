import type { EventBus, KeyDisplay } from "../types";

// Wire protocol (firmware sends newline-delimited JSON):
// → {"t":"press","k":3}
// → {"t":"release","k":3}
// ← {"k":3,"label":"Play","color":"#1DB954"}

const BAUD_RATE = 115200;

export async function startTransport(portPath: string, bus: EventBus) {
  console.log(`[transport] opening ${portPath} @ ${BAUD_RATE}`);

  // Bun.openSerial is available in Bun >= 1.1 — gracefully fall back to a
  // mock in dev if the port isn't available (e.g. running without hardware).
  let port: { write: (data: Uint8Array) => void; close: () => void } | null =
    null;

  try {
    // @ts-expect-error — Bun.openSerial types may not be in bun-types yet
    port = await Bun.openSerial({
      path: portPath,
      baudRate: BAUD_RATE,
    });
  } catch {
    console.warn(
      "[transport] could not open serial port — running in mock mode",
    );
    port = mockPort(bus);
  }

  if (!port) return;

  // ── Inbound: firmware → daemon ──────────────────────────────────────────────
  // @ts-expect-error
  const reader = port.readable?.getReader();
  if (reader) {
    (async () => {
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const raw = JSON.parse(trimmed) as { t: string; k: number };
            bus.emit("keyEvent", {
              type:
                raw.t === "press"
                  ? "press"
                  : raw.t === "hold"
                    ? "hold"
                    : "release",
              keyIndex: raw.k,
              timestamp: Date.now(),
            });
          } catch {
            console.warn("[transport] bad frame:", trimmed);
          }
        }
      }
    })();
  }

  // ── Outbound: daemon → firmware ─────────────────────────────────────────────
  bus.on("displayUpdate", (update: KeyDisplay) => {
    const frame =
      JSON.stringify({
        k: update.keyIndex,
        label: update.label ?? "",
        color: update.color ?? "#000000",
        icon: update.icon ?? "",
      }) + "\n";
    port?.write(new TextEncoder().encode(frame));
  });

  console.log("[transport] ready");
  return port;
}

// ── Mock port for development without hardware ──────────────────────────────

function mockPort(bus: EventBus) {
  console.log("[transport] mock port active — press Ctrl+C to stop");

  // Simulate a key press every 10 s so you can test the pipeline
  const interval = setInterval(() => {
    const keyIndex = Math.floor(Math.random() * 6);
    bus.emit("keyEvent", { type: "press", keyIndex, timestamp: Date.now() });
    setTimeout(
      () =>
        bus.emit("keyEvent", {
          type: "release",
          keyIndex,
          timestamp: Date.now(),
        }),
      80,
    );
  }, 10_000);

  return {
    write: (data: Uint8Array) => {
      const text = new TextDecoder().decode(data).trim();
      console.log("[transport → mock hw]", text);
    },
    close: () => clearInterval(interval),
  };
}
