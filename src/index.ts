export { CONTRACT_VERSION } from "./core/contract";
export type {
  AnyToolbarCommand,
  CommandInputEnumField,
  CommandInputField,
  CommandInputPrimitiveField,
  CommandInputSchema,
  CommandInputType,
  CommandInputValue,
  CommandInvocation,
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
// deliberately *not* exported. Extensions read the aggregation via
// `api.getCommands()`/`api.getDiagnostics()`, hosts via `useToolbarCommands()`/
// `useDevToolbar().getCommands()` — both merge props plus dynamic
// registrations with `hidden` extensions filtered out, which a root-level
// aggregator over a caller-assembled array could never do correctly.
// `useDevToolbar().extensions` is the unfiltered list.
export { invokeCommand, runCommand } from "./core/commands";
export type { InvokeCommandOptions } from "./core/commands";

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
