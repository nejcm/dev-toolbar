import { createContext, useContext } from "react";
import type { ToolbarColorScheme, ToolbarDensity, ToolbarPosition } from "./contract";
import type { ExtensionSettingPatch, ExtensionSettings } from "./store";
import type { ToolbarSettingsSections } from "./useControlledToolbarState";

export interface ViewerSettingsContextValue {
  enabled: boolean;
  sections: ToolbarSettingsSections;
  extensionSettings: ExtensionSettings;
  position: ToolbarPosition;
  density: ToolbarDensity;
  colorScheme: ToolbarColorScheme;
  positionControlled: boolean;
  options: {
    position: ToolbarPosition;
    density: ToolbarDensity;
    colorScheme: ToolbarColorScheme;
  };
  setPosition(position: ToolbarPosition | undefined): void;
  setDensity(density: ToolbarDensity | undefined): void;
  setColorScheme(colorScheme: ToolbarColorScheme | undefined): void;
  setExtensionSetting(id: string, patch: ExtensionSettingPatch): void;
  resetSettings(): void;
}

export const ViewerSettingsContext = createContext<ViewerSettingsContextValue | null>(null);

export function useViewerSettings(): ViewerSettingsContextValue {
  const value = useContext(ViewerSettingsContext);
  if (!value) {
    throw new Error("[dev-toolbar] useViewerSettings() must be called inside <DevToolbar>.");
  }
  return value;
}
