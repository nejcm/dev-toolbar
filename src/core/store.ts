import type { DevToolbarExtension, ToolbarPosition, ToolbarStorage } from "./contract";
import { readJson, writeJson } from "./storage";

export const MIN_PANEL_HEIGHT = 160;
export const MAX_PANEL_HEIGHT = 800;
export const DEFAULT_PANEL_HEIGHT = 320;

const STORAGE_KEYS = {
  visible: "visible",
  position: "position",
  activePanel: "activePanel",
  panelHeight: "panelHeight",
} as const;

export interface ToolbarState {
  visible: boolean;
  position: ToolbarPosition;
  activePanelId: string | null;
  panelHeight: number;
  /**
   * Extensions registered at runtime through `useDevToolbar().register()`.
   *
   * @internal Not part of the public surface despite `ToolbarState` being
   * exported. Holds *only* the dynamic registrations, never the `extensions`
   * prop, so reading it as "the extension list" is a bug — use
   * `useDevToolbar().extensions` for the merged list. May change shape or
   * disappear in a patch release.
   */
  registered: readonly DevToolbarExtension[];
}

export interface ToolbarStoreOptions {
  storage: ToolbarStorage;
  defaultVisible?: boolean;
  defaultPosition?: ToolbarPosition;
  defaultPanelHeight?: number;
}

export interface ToolbarStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ToolbarState;
  /**
   * The snapshot a server render sees: **the defaults**, resolved but never
   * read from storage.
   *
   * `useSyncExternalStore` requires the server snapshot and the first client
   * render to agree, and a server has no access to the browser's persisted
   * preferences — so returning the persisted state here is what made hydration
   * see `position: "top"` where the server HTML said `"bottom"`. Stable by
   * construction: one frozen object built once, so React never sees it change
   * identity mid-render.
   *
   * The consequence, deliberately: an SSR-side storage adapter is unsupported.
   * Preferences supplied through `storage` on the server would be ignored for
   * the server snapshot and then appear on the client, which is the mismatch
   * this exists to prevent. Pass `defaultVisible`/`defaultPosition`/
   * `defaultPanelHeight` instead — those *are* honoured on both sides.
   */
  getServerSnapshot(): ToolbarState;
  setVisible(visible: boolean): void;
  toggleVisible(): void;
  setPosition(position: ToolbarPosition): void;
  openPanel(id: string): void;
  closePanel(id?: string): void;
  togglePanel(id: string): void;
  setPanelHeight(height: number): void;
  register(extension: DevToolbarExtension): () => void;
}

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isPosition = (value: unknown): value is ToolbarPosition =>
  value === "bottom" || value === "top";
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isStringOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

export function clampPanelHeight(height: number): number {
  if (!Number.isFinite(height)) return DEFAULT_PANEL_HEIGHT;
  return Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, Math.round(height)));
}

export function createToolbarStore(options: ToolbarStoreOptions): ToolbarStore {
  const { storage } = options;

  /**
   * The single place `?? true` / `?? "bottom"` / `clampPanelHeight` resolve, so
   * the server snapshot and the storage fallbacks can never disagree about what
   * a default is. Clamped here too: `defaultPanelHeight: 5000` must not reach a
   * server render unclamped and then snap on the client.
   *
   * Built once, and never mutated — {@link ToolbarStore.getServerSnapshot}
   * hands this exact object back on every call, which is the identity stability
   * `useSyncExternalStore` requires of a server snapshot.
   */
  const defaults: ToolbarState = Object.freeze({
    visible: options.defaultVisible ?? true,
    position: options.defaultPosition ?? "bottom",
    activePanelId: null as string | null,
    panelHeight: clampPanelHeight(options.defaultPanelHeight ?? DEFAULT_PANEL_HEIGHT),
    registered: Object.freeze([]) as readonly DevToolbarExtension[],
  });

  let state: ToolbarState = {
    visible: readJson(storage, STORAGE_KEYS.visible, defaults.visible, isBoolean),
    position: readJson(storage, STORAGE_KEYS.position, defaults.position, isPosition),
    activePanelId: readJson(
      storage,
      STORAGE_KEYS.activePanel,
      defaults.activePanelId,
      isStringOrNull,
    ),
    panelHeight: clampPanelHeight(
      readJson(storage, STORAGE_KEYS.panelHeight, defaults.panelHeight, isNumber),
    ),
    registered: [],
  };

  const listeners = new Set<() => void>();

  const emit = () => {
    // Copied: a listener may unsubscribe itself while being notified.
    for (const listener of Array.from(listeners)) listener();
  };

  const set = (patch: Partial<ToolbarState>) => {
    let changed = false;
    for (const key of Object.keys(patch) as (keyof ToolbarState)[]) {
      if (patch[key] !== state[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    state = { ...state, ...patch };
    emit();
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const getSnapshot = () => state;
  const getServerSnapshot = () => defaults;

  const setVisible = (visible: boolean) => {
    if (visible === state.visible) return;
    writeJson(storage, STORAGE_KEYS.visible, visible);
    set({ visible });
  };

  const toggleVisible = () => setVisible(!state.visible);

  const setPosition = (position: ToolbarPosition) => {
    if (position === state.position) return;
    writeJson(storage, STORAGE_KEYS.position, position);
    set({ position });
  };

  const openPanel = (id: string) => {
    if (state.activePanelId === id) return;
    writeJson(storage, STORAGE_KEYS.activePanel, id);
    set({ activePanelId: id });
  };

  const closePanel = (id?: string) => {
    if (state.activePanelId === null) return;
    if (id !== undefined && state.activePanelId !== id) return;
    writeJson(storage, STORAGE_KEYS.activePanel, null);
    set({ activePanelId: null });
  };

  const togglePanel = (id: string) => {
    if (state.activePanelId === id) closePanel(id);
    else openPanel(id);
  };

  const setPanelHeight = (height: number) => {
    const next = clampPanelHeight(height);
    if (next === state.panelHeight) return;
    writeJson(storage, STORAGE_KEYS.panelHeight, next);
    set({ panelHeight: next });
  };

  const register = (extension: DevToolbarExtension) => {
    const existingIndex = state.registered.findIndex((item) => item.id === extension.id);
    const registered =
      existingIndex === -1
        ? [...state.registered, extension]
        : state.registered.map((item, index) => (index === existingIndex ? extension : item));
    state = { ...state, registered };
    emit();
    return () => {
      const next = state.registered.filter((item) => item !== extension);
      if (next.length === state.registered.length) return;
      state = { ...state, registered: next };
      emit();
    };
  };

  return {
    subscribe,
    getSnapshot,
    getServerSnapshot,
    setVisible,
    toggleVisible,
    setPosition,
    openPanel,
    closePanel,
    togglePanel,
    setPanelHeight,
    register,
  };
}
