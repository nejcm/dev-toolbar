import { createContext, useContext } from "react";
import type {
  CompactPreset,
  DevToolbarExtension,
  ToolbarColorScheme,
  ToolbarDensity,
  ToolbarPosition,
} from "./contract";
import type { DevToolbarProps } from "./DevToolbar";
import type { ExtensionSettings, ToolbarState, ToolbarStore } from "./store";

/** Viewer Settings policy (ADR-006): precedence, section gating, clear-on-default, preset acceptance. */

export type ToolbarSettingsSections = Required<
  Exclude<DevToolbarProps["settings"], false | undefined>
>;

export interface ViewerSettingsOptions {
  sections: ToolbarSettingsSections;
  /** Controlled `position` prop. */
  position: ToolbarPosition | undefined;
  defaultPosition: ToolbarPosition;
  density: ToolbarDensity;
  colorScheme: ToolbarColorScheme;
}

export interface ResolvedViewerSettings {
  enabled: boolean;
  sections: ToolbarSettingsSections;
  position: ToolbarPosition;
  density: ToolbarDensity;
  colorScheme: ToolbarColorScheme;
  extensionSettings: ExtensionSettings;
}

const EMPTY_EXTENSION_SETTINGS: ExtensionSettings = Object.freeze({});

export function resolveSections(settings: DevToolbarProps["settings"]): ToolbarSettingsSections {
  if (settings === undefined) {
    return { position: true, density: true, colorScheme: true, extensions: true };
  }
  if (settings === false) {
    return { position: false, density: false, colorScheme: false, extensions: false };
  }
  return {
    position: settings.position === true,
    density: settings.density === true,
    colorScheme: settings.colorScheme === true,
    extensions: settings.extensions === true,
  };
}

/** A controlled prop wins, then a stored Setting, then the Option; an off section ignores storage. */
export function resolveViewerSettings(
  options: ViewerSettingsOptions,
  stored: Pick<ToolbarState, "position" | "density" | "colorScheme" | "extensionSettings">,
): ResolvedViewerSettings {
  const { sections } = options;
  return {
    enabled: sections.position || sections.density || sections.colorScheme || sections.extensions,
    sections,
    position: options.position ?? (sections.position ? stored.position : options.defaultPosition),
    density: sections.density ? (stored.density ?? options.density) : options.density,
    colorScheme: sections.colorScheme
      ? (stored.colorScheme ?? options.colorScheme)
      : options.colorScheme,
    extensionSettings: sections.extensions ? stored.extensionSettings : EMPTY_EXTENSION_SETTINGS,
  };
}

/** The stored preset, only while the extension still declares it. */
export function acceptedPreset(
  extension: DevToolbarExtension,
  extensionSettings: ExtensionSettings,
): CompactPreset | undefined {
  const preset = extensionSettings[extension.id]?.preset;
  return preset && extension.presets?.includes(preset) ? preset : undefined;
}

export function isShownInBar(
  extension: DevToolbarExtension,
  extensionSettings: ExtensionSettings,
): boolean {
  return extension.hidden !== true && extensionSettings[extension.id]?.shown !== false;
}

export interface ViewerSettingActions {
  setPosition(position: ToolbarPosition): void;
  setDensity(density: ToolbarDensity): void;
  setColorScheme(colorScheme: ToolbarColorScheme): void;
  setShown(id: string, shown: boolean): void;
  /** `undefined` is "Extension default". */
  setPreset(id: string, preset: CompactPreset | undefined): void;
  resetSettings(): void;
}

/**
 * Picking the Option's own value clears the stored Setting, so a later change to
 * the Consumer's default reaches this Viewer. `setControlledPosition` routes
 * through `onPositionChange` when `position` is controlled.
 */
export function createViewerSettingActions(
  store: ToolbarStore,
  options: Omit<ViewerSettingsOptions, "sections">,
  setControlledPosition: (position: ToolbarPosition) => void,
): ViewerSettingActions {
  return {
    setPosition: (position) => {
      if (options.position === undefined && position === options.defaultPosition) {
        store.setPosition(undefined);
      } else {
        setControlledPosition(position);
      }
    },
    setDensity: (density) => store.setDensity(density === options.density ? undefined : density),
    setColorScheme: (colorScheme) =>
      store.setColorScheme(colorScheme === options.colorScheme ? undefined : colorScheme),
    setShown: (id, shown) => store.setExtensionSetting(id, { shown: shown ? undefined : false }),
    setPreset: (id, preset) => store.setExtensionSetting(id, { preset }),
    resetSettings: store.resetSettings,
  };
}

export interface ViewerSettingsContextValue extends ResolvedViewerSettings, ViewerSettingActions {}

export const ViewerSettingsContext = createContext<ViewerSettingsContextValue | null>(null);

export function useViewerSettings(): ViewerSettingsContextValue {
  const value = useContext(ViewerSettingsContext);
  if (!value) {
    throw new Error("[dev-toolbar] useViewerSettings() must be called inside <DevToolbar>.");
  }
  return value;
}
