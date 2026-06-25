// ─── Key events (hardware → daemon) ───────────────────────────────────────────

export type KeyEventType = "press" | "release" | "hold";

export interface KeyEvent {
  type: KeyEventType;
  keyIndex: number; // 0-based, matces physical position
  timestamp: number; // ms since epoch
}

// ─── Display updates (daemon → hardware) ──────────────────────────────────────

export interface KeyDisplay {
  keyIndex: number;
  label?: string; // text rendered on key
  color?: string; // hex e.g. "#ff0000"
  icon?: string; // base64 PNG or named icon token
}

// ─── Plugin contract ──────────────────────────────────────────────────────────

export interface ActionContext {
  keyIndex: number;
  eventType: KeyEventType;
  state: StateStore;
  pushDisplay: (update: KeyDisplay) => void;
}

export interface DeckPlugin {
  name: string;
  /** Actions keyed by action ID — assigned to keys in profile JSON */
  actions: Record<string, (ctx: ActionContext) => Promise<void>>;
  /** Optional: subscribe to the bus for push-state updates (e.g. HA events) */
  subscribe?: (bus: EventBus) => void;
  /** Called when plugin is unloaded (hot-reload) */
  destroy?: () => void;
}

// ─── Event bus ────────────────────────────────────────────────────────────────

export type BusEventMap = {
  keyEvent: KeyEvent;
  displayUpdate: KeyDisplay;
  pluginLoaded: { name: string };
  pluginUnloaded: { name: string };
  error: { source: string; error: unknown };
};

export interface EventBus {
  emit<K extends keyof BusEventMap>(event: K, payload: BusEventMap[K]): void;
  on<K extends keyof BusEventMap>(
    event: K,
    handler: (payload: BusEventMap[K]) => void,
  ): () => void;
  off<K extends keyof BusEventMap>(
    event: K,
    handler: (payload: BusEventMap[K]) => void,
  ): void;
}

// ─── State store ──────────────────────────────────────────────────────────────

export interface StateStore {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  delete(key: string): void;
}

// ─── Config / profiles ───────────────────────────────────────────────────────

export interface KeyBinding {
  actionId: string; // e.g. "toggleLight"
  pluginId: string; // e.g. "home-assistant"
  label?: string;
  color?: string;
  icon?: string;
  // Home Assistant shortcuts
  entityId?: string; // e.g. "light.desk_lamp"
  sceneId?: string; // e.g. "scene.evening"
  // Generic plugin params - available via state.get(`pluginId.key.N.options`)
  options?: Record<string, unknown>;
}

export interface Profile {
  name: string;
  keys: Record<number, KeyBinding>; // keyIndex → binding
}
