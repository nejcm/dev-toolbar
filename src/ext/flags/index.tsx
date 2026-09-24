/**
 * `@nejcm/dev-toolbar/ext/flags`
 *
 * Feature-flag controls, including a promoted flag pinned in the bar. Written
 * strictly as a consumer of the public extension contract: nothing here
 * imports a *value* from `src/core/*`, only types, which erase at build time.
 *
 * **Flags are yours.** This extension owns no flag store, integrates no
 * provider and reaches for no global — same rule `/ext/environment` follows.
 * You hand it what your application resolved and, optionally, a typed adapter
 * it calls when somebody asks for a local override.
 *
 * ```tsx
 * import { flags } from "@nejcm/dev-toolbar/ext/flags";
 *
 * // Build it ONCE, outside render.
 * const extensions = [
 *   flags({
 *     flags: () =>
 *       catalogue.map((definition) => ({
 *         ...definition,
 *         value: base[definition.key],   // BEFORE local overrides
 *         source: "server-rule",
 *       })),
 *     onOverride: (key, value) => {
 *       // `value === undefined` means "no local override any more".
 *       if (value === undefined) overrideStore.clear(key);
 *       else overrideStore.set(key, value);
 *     },
 *     promoted: { flagKey: "ui-facelift", label: "UI Facelift 2026" },
 *   }),
 * ];
 * ```
 *
 * Omit `onOverride` (and `onOverridesChange`, which hands you the whole vetted
 * map after every change instead) and the panel is read-only — it lists,
 * searches and copies and changes nothing. That's the honest degradation, not
 * a reason to invent a store.
 *
 * This is the first extension that **mutates the application** rather than
 * observing it, which is why:
 *
 * - **Overrides outlive the tab.** Persisted under
 *   `dtb:v1:<instanceId>:ext:<id>:overrides` and re-applied through your
 *   adapter on the next mount. The app boots with its own values first; call
 *   `readStoredOverrides()` before you render if you need them earlier.
 * - **There is a kill switch.** `?dtb-flags=reset` drops every stored override
 *   before it's applied — the override that breaks the app is the one you
 *   can't reach the panel to remove. The param is then removed from the URL.
 * - **An override is never quiet.** The bar counts them, every overridden row
 *   is marked, and the app's own value stays on screen next to the override.
 *
 * Flag keys and values reach a clipboard, so every value goes through
 * `redact()` once on the way in. The panel and the copy commands read the
 * same redacted snapshot; there's no unmasked path.
 */
import {
  createFlagsRuntime,
  DEFAULT_RESET_PARAM,
  OVERRIDES_KEY,
  isFlagValue,
  promotionsOf,
  vetOverrides,
} from "./runtime";
import { writeClipboardTextOrThrow } from "../../runtime";
import { FlagsChip, FlagsPanel } from "./ui";
import {
  readInput,
  readStoredRecord,
  resolvePresentation,
  resolveStyleNonce,
} from "@nejcm/dev-toolbar/kit";
import type { CompactPresentationInput, ResolvedCompactPresentation } from "@nejcm/dev-toolbar/kit";
import type { FlagsRuntimeOptions } from "./runtime";
import type { FlagReading, FlagValue, FlagView, FlagsInput, FlagsSnapshot } from "./types";
import type {
  CommandInputSchema,
  DevToolbarExtension,
  ExtensionRuntimeApi,
  ToolbarAlign,
  ToolbarCommand,
  ToolbarStorage,
} from "../../core/contract";

export interface FlagsOptions extends Pick<
  FlagsRuntimeOptions,
  | "flags"
  | "onOverride"
  | "onOverridesChange"
  | "pollMs"
  | "promoted"
  | "audience"
  | "redactOptions"
  | "resetParam"
  | "now"
> {
  /** Extension id. Default `"flags"`. */
  id?: string;
  /** Bar label, used by the error chip and the panel's accessible name. Default `"Flags"`. */
  label?: string;
  align?: ToolbarAlign;
  order?: number;
  /**
   * Overflow collapse order. Default `60` — higher than the metrics chips, so
   * a promoted flag survives a narrowing window longer than a memory readout.
   */
  priority?: number;
  hidden?: boolean;
  /** Keep the panel mounted after it closes, preserving the search box. Default `true`. */
  keepMounted?: boolean;
  /**
   * Inject this extension's stylesheet. Default `true`. Core's own
   * `injectStyles` prop is not visible to extensions, so if you turned that off
   * turn this off too and ship `FLAGS_CSS` yourself.
   */
  injectStyles?: boolean;
  /**
   * CSP nonce for this extension's stylesheet. Wins over the `styleNonce`
   * slot prop core forwards from `<DevToolbar>`.
   */
  styleNonce?: string;
  /**
   * How the **flags chip** presents itself: a preset, your own icon, a render
   * callback and an accessible-name override. A bare preset is the shorthand —
   * `presentation: "icon-value"`.
   *
   * This is the chip alone; a promoted flag configures its own on
   * {@link PromotedFlag.presentation}, next to that control.
   *
   * `render` supplies the children of the span carrying `data-dtb-overridden` —
   * state attributes, `aria-expanded`, `onClick` and `title` stay the
   * extension's; returning `undefined` falls through to the preset. `name`
   * overrides the trigger's `aria-label` (a whitespace-only return is ignored).
   *
   * `docs/adr/ADR-004-per-extension-bar-presentation.md`.
   */
  presentation?: CompactPresentationInput<FlagsSnapshot>;
}

/**
 * Builds the extension. Call it once — the returned object owns the store,
 * the override map and, once started, the timer.
 */
export function flags(options: FlagsOptions = {}): DevToolbarExtension {
  const {
    id = "flags",
    label = "Flags",
    align = "start",
    order = 0,
    priority = 60,
    hidden,
    keepMounted = true,
    injectStyles = true,
    styleNonce: optionNonce,
    presentation: presentationOption,
    resetParam = DEFAULT_RESET_PARAM,
    ...runtimeOptions
  } = options;

  // Resolved once, here, in the factory closure — the only place icons and
  // callbacks can live, since a `ReactNode` can't cross into this extension's
  // structurally compared store (see PromotedFlag.icon). Both resolved maps
  // travel to `ui.tsx` as props.
  const presentation = resolvePresentation(presentationOption);
  // Keyed by position in `promoted`, matching FlagView.promotedIndex — two
  // entries can name the same key, only the runtime knows which is live.
  const promotedPresentations = new Map<number, ResolvedCompactPresentation<FlagView>>();
  promotionsOf(runtimeOptions.promoted).forEach((promotion, index) => {
    promotedPresentations.set(index, resolvePresentation(promotion.presentation));
  });

  // Built here, not in start(api): slot functions run during the toolbar's
  // first render, which is before any effect fires.
  const runtime = createFlagsRuntime({ ...runtimeOptions, resetParam });

  // Rebuilt on every aggregation pass so a flag the catalogue grows after
  // mount gets a toggle command immediately; command identity is `id`, so
  // rebuilding costs nothing. Uses `peek()`, not `getSnapshot()` (the store
  // coalesces publishes at 4 Hz, and a lagging command list would desync from
  // the panel). Orphans get a row to clear but no toggle command.
  const setInput: CommandInputSchema = {
    fields: {
      key: {
        type: "string",
        required: true,
        description: "The flag's key, exactly as the catalogue spells it.",
      },
      value: {
        // `null` is deliberately absent: `applyOverride` refuses it for every
        // boolean/string/number flag (only a variant whose `variants` include
        // `null` accepts one), so the schema doesn't advertise a value that
        // always throws.
        type: ["boolean", "string", "number"],
        description:
          "The value to force. Must match the flag's own type. `null` is refused " +
          "unless the flag is a variant whose `variants` include it. Omit this " +
          "field to clear the override — omission, not `null`, is what clears.",
      },
    },
  };

  /**
   * The one call an agent needs: `runCommand("flags.set", { key, value })`.
   *
   * Does not replace the per-flag enumeration below: `flags.toggle.<key>` is
   * what a human finds by typing a flag's name into `⌘K`, and
   * `/ext/command-menu` skips every command that carries `input` (contract
   * v2), so shipping only this one would leave the palette with no flag
   * actions at all.
   */
  const setCommand: ToolbarCommand<{ key: string; value?: FlagValue }> = {
    id: `${id}.set`,
    label: "Set a feature flag override",
    description:
      "Overrides one flag by key, in one call, without opening the panel. Refuses a " +
      "value of the wrong type rather than coercing it, and refuses a key the " +
      "catalogue does not list. Omit `value` to clear the override; `null` is a " +
      "value, accepted only by a variant flag that lists it.",
    group: "Flags",
    keywords: ["flag", "override", "set", "value"],
    input: setInput,
    run: (input) => {
      if (input === null || typeof input !== "object") {
        throw new Error("`flags.set` takes `{ key, value? }`.");
      }
      runtime.applyOverride(input.key, input.value);
    },
  };

  const perFlagCommands = (): ToolbarCommand[] =>
    runtime.store
      .peek()
      .flags.filter((view) => view.type === "boolean" && !view.orphaned)
      .map((view) => ({
        id: `${id}.toggle.${view.key}`,
        label: `Toggle flag: ${view.label}`,
        group: "Flags",
        keywords: ["flag", "override", view.key],
        run: () => runtime.toggle(view.key),
      }));

  return {
    id,
    label,
    contractVersion: 2,
    align,
    order,
    priority,
    keepMounted,
    ...(hidden === undefined ? {} : { hidden }),

    start(api: ExtensionRuntimeApi) {
      return runtime.start(api);
    },

    compact: ({ isOverflowed, isPanelOpen, togglePanel, openPanel, styleNonce }) => (
      <FlagsChip
        runtime={runtime}
        label={label}
        presentation={presentation}
        promotedPresentations={promotedPresentations}
        isOverflowed={isOverflowed}
        isPanelOpen={isPanelOpen}
        injectStyles={injectStyles}
        styleNonce={resolveStyleNonce(optionNonce, styleNonce)}
        onToggle={togglePanel}
        onOpen={openPanel}
      />
    ),

    /** The redacted override list, for `/ext/diagnostics`. Display strings only, never raw values. */
    diagnostics: () => runtime.diagnostics(),

    panel: ({ styleNonce }) => (
      <FlagsPanel
        runtime={runtime}
        label={label}
        resetParam={resetParam}
        injectStyles={injectStyles}
        styleNonce={resolveStyleNonce(optionNonce, styleNonce)}
      />
    ),

    commands: () => [
      setCommand,
      ...perFlagCommands(),
      {
        id: `${id}.clearOverrides`,
        label: "Clear all local flag overrides",
        group: "Flags",
        keywords: ["reset", "revert", "override"],
        run: () => runtime.clearAll(),
      },
      {
        id: `${id}.copyRecipe`,
        label: "Copy flag override recipe",
        group: "Flags",
        keywords: ["clipboard", "share", "override"],
        // Same redacted snapshot the panel renders — a command must not be a
        // way around the UI's masks. `writeClipboardTextOrThrow` throws on
        // failure so the palette can report it.
        run: async () => {
          await writeClipboardTextOrThrow(runtime.recipeText());
        },
      },
      {
        id: `${id}.copyJson`,
        label: "Copy flag overrides as JSON",
        group: "Flags",
        keywords: ["diagnostics", "json", "override"],
        run: async () => {
          await writeClipboardTextOrThrow(JSON.stringify(runtime.diagnostics(), null, 2));
        },
      },
      {
        id: `${id}.refresh`,
        label: "Re-read feature flags",
        group: "Flags",
        keywords: ["reload", "refresh"],
        run: () => runtime.refresh(),
      },
    ],
  };
}

export interface ReadStoredOverridesOptions {
  /** The `instanceId` you pass to `<DevToolbar>`. Default `"default"`. */
  instanceId?: string;
  /** The extension id you passed to `flags()`. Default `"flags"`. */
  id?: string;
  /** Storage to read. Default `localStorage`. */
  storage?: ToolbarStorage;
  /** Reset query parameter, matching what you passed to `flags()`. `null` disables it. */
  resetParam?: string | null;
  /**
   * The catalogue, in any shape `flags()` accepts. When given, the map is
   * vetted the way `start()` vets it. Omit it and the map is returned as parsed.
   */
  flags?: FlagsInput;
}

/**
 * Reads the persisted override map **without mounting anything**.
 *
 * On a reload the app boots with its own flag values, and the toolbar only
 * re-applies overrides once `start()` runs in an effect. Call this at the top
 * of your entry point and seed your own override store from it so first paint
 * agrees with the panel.
 *
 * Honours `?dtb-flags=reset`, same as `start()`: while the param is in the URL
 * this returns `{}`. `start()` removes the param after applying the reset.
 */
export function readStoredOverrides(
  options: ReadStoredOverridesOptions = {},
): Record<string, FlagValue> {
  const {
    instanceId = "default",
    id = "flags",
    storage,
    resetParam = DEFAULT_RESET_PARAM,
    flags,
  } = options;
  // The kit owns the key template, the kill switch and the plain-object copy;
  // `isFlagValue` is the same entry guard `start()` parses the map with.
  const parsed = readStoredRecord(
    { instanceId, extensionId: id, key: OVERRIDES_KEY, storage, resetParam },
    isFlagValue,
  );
  if (flags === undefined) return parsed;
  // `vetOverrides` builds a null-prototype map; copied back before it crosses the public API.
  return { ...vetOverrides(parsed, readCatalogue(flags)) };
}

// Mirrors the runtime's `readFlags()`: a throwing or non-array catalogue vets nothing out.
function readCatalogue(flags: FlagsInput): readonly FlagReading[] {
  try {
    const value = readInput(flags);
    return Array.isArray(value) ? (value as readonly FlagReading[]) : [];
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      "[dev-toolbar/ext/flags] the flags getter passed to readStoredOverrides() threw. " +
        "Returning the stored map unvetted.",
      error,
    );
    return [];
  }
}

export { FLAGS_CSS, ensureFlagsStyles } from "./css";
export {
  createFlagsRuntime,
  DEFAULT_RESET_PARAM,
  OVERRIDES_KEY,
  parseOverrides,
  resetRequested,
  vetOverrides,
} from "./runtime";
export type { FlagsRuntime, FlagsRuntimeOptions } from "./runtime";
export { formatValue, inferType, matchesQuery, parseValue, severityFor } from "./types";
export type {
  FeatureFlagDefinition,
  FlagReading,
  FlagSeverity,
  FlagSource,
  FlagType,
  FlagValue,
  FlagView,
  FlagsInput,
  FlagsSnapshot,
  PromotedFlag,
  ReloadBehavior,
} from "./types";
