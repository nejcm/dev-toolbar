import { useId, useRef } from "react";
import type { ChangeEvent, ReactNode } from "react";
import type {
  CompactPreset,
  DevToolbarExtension,
  ToolbarColorScheme,
  ToolbarDensity,
  ToolbarPosition,
} from "./contract";
import { cx, useDevToolbar } from "./context";
import { useDisclosure } from "./useDisclosure";
import { useViewerSettings } from "./viewerSettingsContext";

const PRESET_LABELS: Record<CompactPreset, string> = {
  default: "Default",
  icon: "Icon",
  "icon-value": "Icon and value",
  "icon-label": "Icon and label",
  label: "Label",
  value: "Value",
};

interface RadioGroupProps<T extends string> {
  legend: string;
  name: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange(value: T): void;
}

function RadioGroup<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: RadioGroupProps<T>): ReactNode {
  return (
    <fieldset data-dtb-part="settings-section">
      <legend>{legend}</legend>
      <div data-dtb-part="settings-options">
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const presentExtensions = (extensions: readonly DevToolbarExtension[]) =>
  extensions.filter((extension) => extension.hidden !== true);

export function SettingsMenu(): ReactNode {
  const toolbar = useDevToolbar();
  const settings = useViewerSettings();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { open, setOpen } = useDisclosure(buttonRef, menuRef);
  const id = useId();
  const menuId = `dtb-settings-menu-${id}`;

  const extensions = presentExtensions(toolbar.extensions);
  const setPosition = (next: ToolbarPosition) =>
    settings.setPosition(
      !settings.positionControlled && next === settings.options.position ? undefined : next,
    );
  const setDensity = (next: ToolbarDensity) =>
    settings.setDensity(next === settings.options.density ? undefined : next);
  const setColorScheme = (next: ToolbarColorScheme) =>
    settings.setColorScheme(next === settings.options.colorScheme ? undefined : next);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-dtb-part="settings-button"
        className={cx(toolbar.classNames.settingsButton)}
        aria-label="Toolbar settings"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">{"⚙"}</span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          data-dtb-part="settings-menu"
          className={cx(toolbar.classNames.settingsMenu)}
          role="group"
          aria-label="Toolbar settings"
          tabIndex={-1}
        >
          {settings.sections.position ? (
            <RadioGroup
              legend="Position"
              name={`${menuId}-position`}
              value={settings.position}
              options={[
                { value: "top", label: "Top" },
                { value: "bottom", label: "Bottom" },
              ]}
              onChange={setPosition}
            />
          ) : null}
          {settings.sections.density ? (
            <RadioGroup
              legend="Density"
              name={`${menuId}-density`}
              value={settings.density}
              options={[
                { value: "compact", label: "Compact" },
                { value: "comfortable", label: "Comfortable" },
              ]}
              onChange={setDensity}
            />
          ) : null}
          {settings.sections.colorScheme ? (
            <RadioGroup
              legend="Colour scheme"
              name={`${menuId}-color-scheme`}
              value={settings.colorScheme}
              options={[
                { value: "system", label: "System" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
              onChange={setColorScheme}
            />
          ) : null}
          {settings.sections.extensions && extensions.length > 0 ? (
            <fieldset data-dtb-part="settings-section">
              <legend>Extensions</legend>
              <div data-dtb-part="settings-extensions">
                {extensions.map((extension) => {
                  const value = settings.extensionSettings[extension.id];
                  const preset =
                    value?.preset && extension.presets?.includes(value.preset) ? value.preset : "";
                  return (
                    <div key={extension.id} data-dtb-part="settings-extension">
                      <label>
                        <input
                          type="checkbox"
                          checked={value?.shown !== false}
                          onChange={(event) =>
                            settings.setExtensionSetting(extension.id, {
                              shown: event.currentTarget.checked ? undefined : false,
                            })
                          }
                        />
                        <span>{`${extension.label} shown in bar`}</span>
                      </label>
                      {extension.presets && extension.presets.length > 0 ? (
                        <select
                          aria-label={`${extension.label} presentation preset`}
                          value={preset}
                          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                            settings.setExtensionSetting(extension.id, {
                              preset:
                                event.currentTarget.value === ""
                                  ? undefined
                                  : (event.currentTarget.value as CompactPreset),
                            })
                          }
                        >
                          <option value="">Extension default</option>
                          {extension.presets.map((option) => (
                            <option key={option} value={option}>
                              {PRESET_LABELS[option]}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </fieldset>
          ) : null}
          <button type="button" data-dtb-part="settings-reset" onClick={settings.resetSettings}>
            Reset toolbar settings
          </button>
        </div>
      ) : null}
    </>
  );
}
