import type { DeckPlugin, EventBus } from "../src/types";

// ── OBS WebSocket v5 plugin ────────────────────────────────────────────────────
// Requires OBS 28+. Enable in OBS: Tools → WebSocket Server Settings
// Set OBS_WS_URL and OBS_WS_PASSWORD in your .env:
//   OBS_WS_URL=ws://localhost:4455
//   OBS_WS_PASSWORD=your_password   (leave blank if auth is disabled)
//
// Actions available:
//   toggleRecording, toggleStreaming, toggleVirtualCam
//   toggleMicMute, toggleDesktopMute, switchScene

const OBS_WS_URL = process.env.OBS_WS_URL ?? "ws://localhost:4455";
const OBS_WS_PASS = process.env.OBS_WS_PASSWORD ?? "";

// ── OBS WebSocket v5 client ───────────────────────────────────────────────────

type OBSResponse = { op: number; d: Record<string, unknown> };

class OBSClient {
  private ws: WebSocket | null = null;
  private msgId = 1;
  private pending = new Map<string, { resolve: Function; reject: Function }>();
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private onReady: (() => void) | null = null;

  async connect(onReady?: () => void) {
    this.onReady = onReady ?? null;
    this._connect();
  }

  private _connect() {
    this.ws = new WebSocket(OBS_WS_URL);

    this.ws.onopen = () => {
      console.log("[obs] WebSocket connected");
    };

    this.ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data as string) as OBSResponse;

      // Op 0 = Hello (server sends supported auth)
      if (msg.op === 0) {
        const hello = msg.d as {
          authentication?: { challenge: string; salt: string };
          rpcVersion: number;
        };
        const identify: Record<string, unknown> = { rpcVersion: 1 };

        if (hello.authentication && OBS_WS_PASS) {
          identify.authentication = await buildAuthString(
            OBS_WS_PASS,
            hello.authentication.challenge,
            hello.authentication.salt,
          );
        }

        this.ws!.send(JSON.stringify({ op: 1, d: identify }));
      }

      // Op 2 = Identified (auth succeeded, ready to send requests)
      if (msg.op === 2) {
        console.log("[obs] authenticated and ready");
        this.connected = true;
        this.onReady?.();
      }

      // Op 7 = RequestResponse
      if (msg.op === 7) {
        const res = msg.d as {
          requestId: string;
          requestStatus: { result: boolean; comment?: string };
          responseData?: unknown;
        };
        const p = this.pending.get(res.requestId);
        if (!p) return;
        this.pending.delete(res.requestId);
        if (res.requestStatus.result) {
          p.resolve(res.responseData ?? {});
        } else {
          p.reject(
            new Error(`OBS error: ${res.requestStatus.comment ?? "unknown"}`),
          );
        }
      }
    };

    this.ws.onerror = (e) => {
      console.warn(
        "[obs] WebSocket error — is OBS open with WebSocket server enabled?",
      );
    };

    this.ws.onclose = () => {
      this.connected = false;
      console.warn("[obs] disconnected, reconnecting in 5s");
      this.reconnectTimer = setTimeout(() => this._connect(), 5000);
    };
  }

  async request<T = Record<string, unknown>>(
    type: string,
    data: Record<string, unknown> = {},
  ): Promise<T> {
    if (!this.connected || !this.ws) throw new Error("OBS not connected");
    const requestId = String(this.msgId++);
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.ws!.send(
        JSON.stringify({
          op: 6,
          d: { requestType: type, requestId, requestData: data },
        }),
      );
      setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          reject(new Error(`OBS request "${type}" timed out`));
        }
      }, 5000);
    });
  }

  isConnected() {
    return this.connected;
  }

  destroy() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}

// OBS WebSocket v5 auth uses SHA256: base64(sha256(base64(sha256(pass + salt)) + challenge))
async function buildAuthString(
  password: string,
  challenge: string,
  salt: string,
): Promise<string> {
  const enc = new TextEncoder();

  async function sha256b64(data: string): Promise<string> {
    const hash = await crypto.subtle.digest("SHA-256", enc.encode(data));
    return btoa(String.fromCharCode(...new Uint8Array(hash)));
  }

  const secretHash = await sha256b64(password + salt);
  const responseHash = await sha256b64(secretHash + challenge);
  return responseHash;
}

// ── Plugin ────────────────────────────────────────────────────────────────────

const obs = new OBSClient();

const plugin: DeckPlugin = {
  name: "obs",

  actions: {
    async toggleRecording({ keyIndex, pushDisplay }) {
      if (!obs.isConnected()) {
        pushDisplay({ keyIndex, label: "No OBS", color: "#F44336" });
        return;
      }
      const status = await obs.request<{ outputActive: boolean }>(
        "GetRecordStatus",
      );
      if (status.outputActive) {
        await obs.request("StopRecord");
        pushDisplay({ keyIndex, label: "Rec off", color: "#607D8B" });
      } else {
        await obs.request("StartRecord");
        pushDisplay({ keyIndex, label: "REC", color: "#F44336" });
      }
    },

    async toggleStreaming({ keyIndex, pushDisplay }) {
      if (!obs.isConnected()) {
        pushDisplay({ keyIndex, label: "No OBS", color: "#F44336" });
        return;
      }
      const status = await obs.request<{ outputActive: boolean }>(
        "GetStreamStatus",
      );
      if (status.outputActive) {
        await obs.request("StopStream");
        pushDisplay({ keyIndex, label: "Off air", color: "#607D8B" });
      } else {
        await obs.request("StartStream");
        pushDisplay({ keyIndex, label: "LIVE", color: "#E91E63" });
      }
    },

    async toggleVirtualCam({ keyIndex, pushDisplay }) {
      if (!obs.isConnected()) {
        pushDisplay({ keyIndex, label: "No OBS", color: "#F44336" });
        return;
      }
      const status = await obs.request<{ outputActive: boolean }>(
        "GetVirtualCamStatus",
      );
      if (status.outputActive) {
        await obs.request("StopVirtualCam");
        pushDisplay({ keyIndex, label: "Cam off", color: "#607D8B" });
      } else {
        await obs.request("StartVirtualCam");
        pushDisplay({ keyIndex, label: "Cam on", color: "#2196F3" });
      }
    },

    async toggleMicMute({ keyIndex, pushDisplay, state }) {
      if (!obs.isConnected()) {
        pushDisplay({ keyIndex, label: "No OBS", color: "#F44336" });
        return;
      }
      const inputName =
        state.get<string>(`obs.key.${keyIndex}.inputName`) ?? "Mic/Aux";
      const current = await obs.request<{ inputMuted: boolean }>(
        "GetInputMute",
        { inputName },
      );
      const newMuted = !current.inputMuted;
      await obs.request("SetInputMute", { inputName, inputMuted: newMuted });
      pushDisplay({
        keyIndex,
        label: newMuted ? "Mic off" : "Mic on",
        color: newMuted ? "#F44336" : "#4CAF50",
      });
    },

    async toggleDesktopMute({ keyIndex, pushDisplay, state }) {
      if (!obs.isConnected()) {
        pushDisplay({ keyIndex, label: "No OBS", color: "#F44336" });
        return;
      }
      const inputName =
        state.get<string>(`obs.key.${keyIndex}.inputName`) ?? "Desktop Audio";
      const current = await obs.request<{ inputMuted: boolean }>(
        "GetInputMute",
        { inputName },
      );
      const newMuted = !current.inputMuted;
      await obs.request("SetInputMute", { inputName, inputMuted: newMuted });
      pushDisplay({
        keyIndex,
        label: newMuted ? "Desk off" : "Desk on",
        color: newMuted ? "#FF9800" : "#4CAF50",
      });
    },

    async switchScene({ keyIndex, pushDisplay, state }) {
      if (!obs.isConnected()) {
        pushDisplay({ keyIndex, label: "No OBS", color: "#F44336" });
        return;
      }
      const sceneName = state.get<string>(`obs.key.${keyIndex}.sceneName`);
      if (!sceneName) {
        console.warn(`[obs] no sceneName configured for key ${keyIndex}`);
        return;
      }
      await obs.request("SetCurrentProgramScene", { sceneName });
      pushDisplay({ keyIndex, label: sceneName.slice(0, 8), color: "#9C27B0" });
    },
  },

  subscribe(_bus: EventBus) {
    obs.connect(() => {
      console.log("[obs] plugin ready");
    });
  },

  destroy() {
    obs.destroy();
  },
};

export default plugin;
