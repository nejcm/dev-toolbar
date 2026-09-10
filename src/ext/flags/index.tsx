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
 *   can't reach the panel to remove.
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
  vetOverrides,
} from "./runtime";
import { writeClipboardTextOrThrow } from "../../runtime";
import { FlagsChip, FlagsPanel } from "./ui";
import { readInput, readStoredRecord, resolveStyleNonce } from "@nejcm/dev-toolbar/kit";
import type { FlagsRuntimeOptions } from "./runtime";
import type { FlagReading, FlagValue, FlagsInput } from "./types";
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
    ...runtimeOptions
  } = options;

  // Built here, not in start(api): slot functions run during the toolbar's
  // first render, which is before any effect fires.
  const runtime = createFlagsRuntime(runtimeOptions);

  /**
   * Rebuilt on every aggregation pass (the function form of `commands`) so a
   * flag the catalogue grows after mount gets a toggle command immediately.
   * Command identity is the `id`, so rebuilding costs nothing — `run` looks
   * the flag up live either way.
   *
   * Uses `peek()`, not `getSnapshot()`: the store coalesces publishes at 4 Hz
   * for the chip, and a lagging command list would make "the flag is in the
   * panel but not the palette" a timing question.
   *
   * Orphans get a row so they can be cleared, but no toggle command — offering
   * to turn on a flag the application doesn't have has no place in a palette.
   */
  /**
   * What `flags.set` takes. `value` absent means "clear the override and fall
   * back to the application's own value" — the same meaning `undefined` has in
   * `onOverride`. `null` cannot mean that: it is a real `FlagValue`, and for a
   * variant flag that lists it, a settable one.
   */
  const setInput: CommandInputSchema = {
    fields: {
      key: {
        type: "string",
        required: true,
        description: "The flag's key, exactly as the catalogue spells it.",
      },
      value: {
        // Genuinely polymorphic: the accepted type is whatever the named flag
        // declares, and refusing a mismatch is `run()`'s job, not the schema's.
        //
        // `null` is deliberately absent from this list. It is a real
        // `FlagValue`, but `applyOverride` refuses it for every boolean,
        // string and number flag — `valueMatchesFlagType` checks `typeof`, so
        // only a variant flag whose `variants` include `null` accepts one.
        // That refusal is correct (`vetOverrides` would discard such an
        // override on the next reload), so the schema says the same thing the
        // command does rather than advertising a value that always throws.
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
   * It does **not** replace the per-flag enumeration below. The two serve
   * different readers: `flags.toggle.<key>` is what a human finds by typing a
   * flag's name into `⌘K`, and `/ext/command-menu` skips every command that
   * carries `input` (contract v2), so shipping only this one would leave the
   * palette with no flag actions at all. The plan's objection was that the
   * enumeration is "wasteful as a tool schema" — which this fixes by adding
   * the schema, not by deleting the palette's rows
   * (`plans/agent-readable-toolbar.md` § Phase 2).
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
   * vetted the way `start()` vets it, so a value its flag's declared type
   * rejects is dropped here as the panel would drop it. Omit it and the map
   * is returned as parsed.
   */
  flags?: FlagsInput;
}

/**
 * Reads the persisted override map **without mounting anything**.
 *
 * On a reload the app boots with its own flag values, and the toolbar only
 * re-applies overrides once `start()` runs in an effect — everything rendered
 * before that is unoverridden. Call this at the top of your entry point and
 * seed your own override store from it so first paint agrees with the panel.
 *
 * Honours `?dtb-flags=reset`, same as `start()`: while the param is in the URL
 * this returns `{}` — the mounted runtime is about to clear the stored map and
 * tell your adapter about every key it dropped — and keeps returning `{}` for
 * as long as the param stays there. Pass `flags` and the result is vetted
 * against the catalogue too, so what you seed is what the panel will accept.
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
