export { CONTRACT_VERSION } from "./core/contract";
export type {
  CompactSlotProps,
  DevToolbarClassNames,
  DevToolbarExtension,
  DiagnosticStatus,
  ExtensionDiagnostics,
  ExtensionRuntimeApi,
  OverlaySlotProps,
  PanelSlotProps,
  ToolbarAlign,
  ToolbarColorScheme,
  ToolbarCommand,
  ToolbarCommandsInput,
  ToolbarDensity,
  ToolbarPosition,
  ToolbarStorage,
} from "./core/contract";

export { DevToolbar, HEIGHT_VARIABLE } from "./core/DevToolbar";
export type { DevToolbarProps } from "./core/DevToolbar";
export { DevToolbarInset } from "./core/DevToolbarInset";
export type { DevToolbarInsetProps } from "./core/DevToolbarInset";

export { useDevToolbar, useToolbarCommands } from "./core/context";
export type { DevToolbarContextValue } from "./core/context";

// `collectCommands`, `resolveExtensionCommands` and `collectDiagnostics` are
// deliberately *not* exported. An extension reads the aggregation through
// `api.getCommands()` / `api.getDiagnostics()` and the host through
// `useToolbarCommands()` / `useDevToolbar().getCommands()`; both aggregate over
// the merged list — props plus dynamic registrations, with `hidden` extensions
// filtered out. A root-level aggregator would only ever see an array the caller
// assembled by hand, which is a different — and always staler — thing wearing
// the same name. `useDevToolbar().extensions` is the unfiltered list.
export { runCommand } from "./core/commands";

export {
  createLocalStorage,
  createMemoryStorage,
  createNullStorage,
  STORAGE_PREFIX,
} from "./core/storage";

export { CORE_CSS, ensureStyles } from "./core/styles";

export { DEFAULT_SHORTCUT } from "./core/shortcut";

export { DEFAULT_PANEL_HEIGHT, MAX_PANEL_HEIGHT, MIN_PANEL_HEIGHT } from "./core/store";
// `useDevToolbar().store.getSnapshot()` already hands consumers a `ToolbarState`
// through the exported `DevToolbarContextValue`; without this the type is
// reachable only through an indexed-access type on `DevToolbarContextValue`.
// `ToolbarStore` itself is deliberately left unexported for a later PR.
export type { ToolbarState } from "./core/store";
