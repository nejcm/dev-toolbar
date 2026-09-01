import type { DevToolbarExtension, ToolbarPosition, ToolbarStorage } from "./contract";
import { readJson, writeJson } from "./storage";

export const MIN_PANEL_HEIGHT = 160;
export const MAX_PANEL_HEIGHT = 800;
export const DEFAULT_PANEL_HEIGHT = 320;

export const STORAGE_KEYS = {
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
  /** Extensions registered at runtime through `useDevToolbar().register()`. */
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

  let state: ToolbarState = {
    visible: readJson(storage, STORAGE_KEYS.visible, options.defaultVisible ?? true, isBoolean),
    position: readJson(
      storage,
      STORAGE_KEYS.position,
      options.defaultPosition ?? "bottom",
      isPosition,
    ),
    activePanelId: readJson(
      storage,
      STORAGE_KEYS.activePanel,
      null as string | null,
      isStringOrNull,
    ),
    panelHeight: clampPanelHeight(
      readJson(
        storage,
        STORAGE_KEYS.panelHeight,
        options.defaultPanelHeight ?? DEFAULT_PANEL_HEIGHT,
        isNumber,
      ),
    ),
    registered: [],
  };

  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of [...listeners]) listener();
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
    state = {
      ...state,
      registered: [...state.registered.filter((item) => item.id !== extension.id), extension],
    };
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
