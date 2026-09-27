import type {
  CompactPreset,
  DevToolbarExtension,
  ToolbarColorScheme,
  ToolbarDensity,
  ToolbarPosition,
  ToolbarStorage,
} from "./contract";
import { readJson, removeItem, writeJson } from "./storage";

export const MIN_PANEL_HEIGHT = 160;
export const MAX_PANEL_HEIGHT = 800;
export const DEFAULT_PANEL_HEIGHT = 320;

const STORAGE_KEYS = {
  visible: "visible",
  position: "position",
  density: "density",
  colorScheme: "colorScheme",
  extensionSettings: "extensionSettings",
  activePanel: "activePanel",
  panelHeight: "panelHeight",
} as const;

interface ExtensionSetting {
  shown?: false;
  preset?: CompactPreset;
}

export type ExtensionSettings = Readonly<Record<string, Readonly<ExtensionSetting>>>;

export interface ExtensionSettingPatch {
  shown?: false | undefined;
  preset?: CompactPreset | undefined;
}

export interface ToolbarState {
  visible: boolean;
  position: ToolbarPosition;
  density: ToolbarDensity | undefined;
  colorScheme: ToolbarColorScheme | undefined;
  extensionSettings: ExtensionSettings;
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

export interface PublicToolbarStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ToolbarState;
  /**
   * The snapshot a server render sees: **the defaults**, resolved but never
   * read from storage — `useSyncExternalStore` requires the server snapshot
   * to agree with the first client render, and a server has no access to
   * persisted preferences, so returning persisted state here caused hydration
   * to see `position: "top"` where the server HTML said `"bottom"`. One
   * frozen object built once, so identity never changes mid-render.
   *
   * Deliberate consequence: an SSR-side storage adapter is unsupported. Use
   * `defaultVisible`/`defaultPosition`/`defaultPanelHeight` instead — those
   * *are* honoured on both sides.
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

export interface ToolbarStore extends Omit<PublicToolbarStore, "setPosition"> {
  setPosition(position: ToolbarPosition | undefined): void;
  setDensity(density: ToolbarDensity | undefined): void;
  setColorScheme(colorScheme: ToolbarColorScheme | undefined): void;
  setExtensionSetting(id: string, patch: ExtensionSettingPatch): void;
  resetSettings(): void;
}

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isPosition = (value: unknown): value is ToolbarPosition =>
  value === "bottom" || value === "top";
const isDensity = (value: unknown): value is ToolbarDensity =>
  value === "compact" || value === "comfortable";
const isColorScheme = (value: unknown): value is ToolbarColorScheme =>
  value === "light" || value === "dark" || value === "system";
const isCompactPreset = (value: unknown): value is CompactPreset =>
  value === "default" ||
  value === "icon" ||
  value === "icon-value" ||
  value === "icon-label" ||
  value === "label" ||
  value === "value";
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isStringOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === "string";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function readExtensionSettings(
  storage: ToolbarStorage,
  fallback: ExtensionSettings,
): ExtensionSettings {
  const stored = readJson(storage, STORAGE_KEYS.extensionSettings, {}, isRecord);
  const entries: [string, ExtensionSetting][] = [];

  for (const [id, value] of Object.entries(stored)) {
    if (!isRecord(value)) continue;
    if (Object.hasOwn(value, "shown") && value["shown"] !== false) continue;
    if (Object.hasOwn(value, "preset") && !isCompactPreset(value["preset"])) continue;

    const setting: ExtensionSetting = {};
    if (value["shown"] === false) setting.shown = false;
    if (isCompactPreset(value["preset"])) setting.preset = value["preset"];
    if (setting.shown !== undefined || setting.preset !== undefined) entries.push([id, setting]);
  }

  return entries.length === 0 ? fallback : Object.fromEntries(entries);
}

export function clampPanelHeight(height: number): number {
  if (!Number.isFinite(height)) return DEFAULT_PANEL_HEIGHT;
  return Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, Math.round(height)));
}

export function createToolbarStore(options: ToolbarStoreOptions): ToolbarStore {
  const { storage } = options;

  /**
   * The single place `?? true` / `?? "bottom"` / `clampPanelHeight` resolve, so
   * the server snapshot and the storage fallbacks can never disagree about what
   * a default is. Built once and never mutated — {@link ToolbarStore.getServerSnapshot}
   * hands this exact object back every call, the identity stability
   * `useSyncExternalStore` requires of a server snapshot.
   */
  const defaults: ToolbarState = Object.freeze({
    visible: options.defaultVisible ?? true,
    position: options.defaultPosition ?? "bottom",
    density: undefined,
    colorScheme: undefined,
    extensionSettings: Object.freeze({}) as ExtensionSettings,
    activePanelId: null as string | null,
    panelHeight: clampPanelHeight(options.defaultPanelHeight ?? DEFAULT_PANEL_HEIGHT),
    registered: Object.freeze([]) as readonly DevToolbarExtension[],
  });

  let state: ToolbarState = {
    visible: readJson(storage, STORAGE_KEYS.visible, defaults.visible, isBoolean),
    position: readJson(storage, STORAGE_KEYS.position, defaults.position, isPosition),
    density: readJson(storage, STORAGE_KEYS.density, defaults.density, isDensity),
    colorScheme: readJson(storage, STORAGE_KEYS.colorScheme, defaults.colorScheme, isColorScheme),
    extensionSettings: readExtensionSettings(storage, defaults.extensionSettings),
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

  const setPosition = (position: ToolbarPosition | undefined) => {
    if (position === undefined) removeItem(storage, STORAGE_KEYS.position);
    const next = position ?? defaults.position;
    if (next === state.position) return;
    if (position !== undefined) writeJson(storage, STORAGE_KEYS.position, position);
    set({ position: next });
  };

  const setDensity = (density: ToolbarDensity | undefined) => {
    if (density === undefined) removeItem(storage, STORAGE_KEYS.density);
    if (density === state.density) return;
    if (density !== undefined) writeJson(storage, STORAGE_KEYS.density, density);
    set({ density });
  };

  const setColorScheme = (colorScheme: ToolbarColorScheme | undefined) => {
    if (colorScheme === undefined) removeItem(storage, STORAGE_KEYS.colorScheme);
    if (colorScheme === state.colorScheme) return;
    if (colorScheme !== undefined) writeJson(storage, STORAGE_KEYS.colorScheme, colorScheme);
    set({ colorScheme });
  };

  const setExtensionSetting = (id: string, patch: ExtensionSettingPatch) => {
    const current = state.extensionSettings[id];
    const shown = Object.hasOwn(patch, "shown") ? patch.shown : current?.shown;
    const preset = Object.hasOwn(patch, "preset") ? patch.preset : current?.preset;
    if (shown === current?.shown && preset === current?.preset) return;

    const setting: ExtensionSetting = {};
    if (shown === false) setting.shown = false;
    if (preset !== undefined) setting.preset = preset;

    const entries = Object.entries(state.extensionSettings).filter(([key]) => key !== id);
    if (setting.shown !== undefined || setting.preset !== undefined) entries.push([id, setting]);
    const extensionSettings =
      entries.length === 0 ? defaults.extensionSettings : Object.fromEntries(entries);

    if (entries.length === 0) removeItem(storage, STORAGE_KEYS.extensionSettings);
    else writeJson(storage, STORAGE_KEYS.extensionSettings, extensionSettings);
    set({ extensionSettings });
  };

  const resetSettings = () => {
    removeItem(storage, STORAGE_KEYS.position);
    removeItem(storage, STORAGE_KEYS.density);
    removeItem(storage, STORAGE_KEYS.colorScheme);
    removeItem(storage, STORAGE_KEYS.extensionSettings);
    set({
      position: defaults.position,
      density: defaults.density,
      colorScheme: defaults.colorScheme,
      extensionSettings: defaults.extensionSettings,
    });
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
    setDensity,
    setColorScheme,
    setExtensionSetting,
    resetSettings,
    openPanel,
    closePanel,
    togglePanel,
    setPanelHeight,
    register,
  };
}
