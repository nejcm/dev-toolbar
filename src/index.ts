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
  ExtensionErrorInfo,
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
// deliberately *not* exported: a root-level aggregator over a caller-assembled
// array could never replicate the props + dynamic-registration merge that
// `api.getCommands()`/`useToolbarCommands()` do internally.
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

export { ITEM_SELECTOR } from "./core/measurer";

export { DEFAULT_SHORTCUT } from "./core/shortcut";

export { DEFAULT_PANEL_HEIGHT, MAX_PANEL_HEIGHT, MIN_PANEL_HEIGHT } from "./core/store";
// Without this export, `ToolbarState` is reachable only via an indexed-access
// type on `DevToolbarContextValue`. `ToolbarStore` itself stays unexported.
export type { ToolbarState } from "./core/store";
