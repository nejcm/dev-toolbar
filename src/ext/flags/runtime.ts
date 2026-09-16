/**
 * Everything `/ext/flags` owns that is not React. [dev-toolbar/ext/flags]
 *
 * Built by `flags()`, not by `start(api)` — slot functions run during the
 * toolbar's first render, before any effect fires, so the store the chip reads
 * must exist by the time the factory returns.
 *
 * This extension mutates the application (an override outlives the tab and is
 * applied by consumer code, so failures are shown, not swallowed, and
 * `?dtb-flags=reset` works before React mounts) and flag values can carry
 * secrets (`redact()` runs once on the way in; nothing reads a raw value).
 */
import { createDerivedStore, describeError, redact } from "../../runtime";
import {
  createPoller,
  isReadable,
  parseRecord,
  readInput,
  readPreferenceIfReadable,
  writePreference,
} from "@nejcm/dev-toolbar/kit";
import type { Preference } from "@nejcm/dev-toolbar/kit";
import type { RedactOptions, ThrottledStore } from "../../runtime";
import type { ExtensionRuntimeApi, ToolbarStorage } from "../../core/contract";
import { formatValue, inferType } from "./types";
import type {
  FlagReading,
  FlagType,
  FlagValue,
  FlagView,
  FlagsInput,
  FlagsSnapshot,
  PromotedFlag,
} from "./types";

/** The key, inside the extension's own storage scope, the override map lives at. */
export const OVERRIDES_KEY = "overrides";

/**
 * The override map as it is laid down in storage: the extension's own JSON,
 * stored byte-for-byte, so the raw-string encoding never changes what a
 * consumer already has persisted. The serialised empty map is the fallback,
 * which is what makes "no overrides left" remove the key.
 */
const OVERRIDES_PREFERENCE: Preference<string> = {
  key: OVERRIDES_KEY,
  encoding: "string",
  fallback: "{}",
  isValue: (value): value is string => typeof value === "string",
};

/** Query parameter that clears every override before it is applied. */
export const DEFAULT_RESET_PARAM = "dtb-flags";

export interface FlagsRuntimeOptions {
  /**
   * What your application resolved, **before local overrides**.
   *
   * Pass a function for values that change; it's re-read every `pollMs` and on
   * demand. Pass a `Readable` or a `{ getState, subscribe }` store and it is
   * re-read when that notifies instead, with no timer. The override badge
   * comes from this extension's own map, not from comparing values, so
   * nothing breaks if you fold overrides back into this same store.
   */
  flags?: FlagsInput;
  /**
   * Apply an override to your own flag state. `value === undefined` means the
   * flag no longer has a local override — fall back to your own resolution.
   *
   * Omit it *and* `onOverridesChange` and the panel is **read-only**: lists,
   * searches and copies, no editors.
   */
  onOverride?(key: string, value: FlagValue | undefined): void;
  /**
   * The complete, vetted override map after any change — the `start()` replay,
   * a `?dtb-flags=reset` load (an empty map), every edit and the `flags.set`
   * command. Called **after** the per-key `onOverride` calls of the same
   * synchronous change; a throw here is recorded as one map-wide `bulkError`.
   * Either adapter alone makes the panel writable.
   *
   * A fresh copy every time — mutating it changes nothing.
   */
  onOverridesChange?(overrides: Readonly<Record<string, FlagValue>>): void;
  /** Re-read a function `flags` this often, in ms. Default `1000`. Unused for a `Readable`. */
  pollMs?: number;
  /** Flags pinned into the bar as their own controls. */
  promoted?: PromotedFlag | readonly PromotedFlag[];
  /**
   * Audiences the current actor belongs to. A `PromotedFlag` with an
   * `audience` is promoted only when it intersects this. Consumer-computed,
   * like `hidden` — core has no identity to hand anybody.
   */
  audience?: readonly string[];
  /** Merged into every `redact()` call. `extraKeys` is the usual reason. */
  redactOptions?: RedactOptions;
  /**
   * Query parameter that clears every stored override on start. Default
   * `"dtb-flags"`, triggered by `?dtb-flags=reset`. `null` disables it.
   */
  resetParam?: string | null;
  /** Clock, injectable for tests. Default `Date.now`. */
  now?: () => number;
}

export interface FlagsRuntime {
  readonly store: ThrottledStore<FlagsSnapshot>;
  /**
   * `null` until `start(api)` runs.
   *
   * @deprecated Nothing in the package reads it any more; use
   * `readPreferenceIfReadable`/`readPreference`/`writePreference` from
   * `@nejcm/dev-toolbar/kit` with `api.storage` instead. Removal waits for the
   * next major.
   */
  storage(): ToolbarStorage | null;
  start(api: ExtensionRuntimeApi): () => void;
  /** Re-read the flags and publish. */
  refresh(): void;
  /** The current override map. A copy; mutating it does nothing. */
  overrides(): Record<string, FlagValue>;
  /** Sets a local override and calls the consumer's adapter. */
  setOverride(key: string, value: FlagValue): void;
  /** Removes one override and tells the adapter to fall back. */
  clearOverride(key: string): void;
  /** Removes every override. The escape hatch the panel and a command both use. */
  clearAll(): void;
  /** Flips a boolean flag's effective value. Used by the per-flag commands. */
  toggle(key: string): void;
  /**
   * The validated door `flags.set` uses. Refuses rather than coerces, and
   * **throws** the reason — the caller is a command, and a command's only
   * feedback channel is a rejection the palette or `/ext/agent` reports.
   *
   * `value === undefined` clears the override, the same meaning it has in
   * `onOverride`. `null` is a value, not an absence, so it cannot mean "clear".
   */
  applyOverride(key: string, value?: FlagValue): void;
  /** Forgets the "reload required" markers without reloading. */
  acknowledgeReload(): void;
  /** §3C's shareable override recipe. Redacted. */
  recipeText(): string;
  /** JSON-safe, redacted. Same source as the recipe. */
  diagnostics(): unknown;
}

const monotonic = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

/**
 * The `promoted` option as a list. Exported for `index.tsx`, which walks the
 * same entries to resolve each `PromotedFlag.presentation` — closure state
 * that never reaches a snapshot.
 */
export function promotionsOf(
  promoted: PromotedFlag | readonly PromotedFlag[] | undefined,
): readonly PromotedFlag[] {
  if (promoted === undefined) return [];
  return Array.isArray(promoted)
    ? (promoted as readonly PromotedFlag[])
    : [promoted as PromotedFlag];
}

/** ISO date → epoch ms, or `null` for anything unparseable. Never throws. */
function parseDate(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function isFlagValue(value: unknown): value is FlagValue {
  return (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  );
}

const emptyOverrides = (): Record<string, FlagValue> =>
  Object.create(null) as Record<string, FlagValue>;

const warnedDuplicateCatalogueKeys = new Set<string>();

function warnDuplicateCatalogueKey(key: string): void {
  if (warnedDuplicateCatalogueKeys.has(key)) return;
  warnedDuplicateCatalogueKeys.add(key);
  // eslint-disable-next-line no-console
  console.warn(`[dev-toolbar/ext/flags] duplicate catalogue key "${key}" — first wins.`);
}

/** Test seam: duplicate-key warnings are per process and would leak between cases. */
export function resetDuplicateCatalogueKeyWarnings(): void {
  warnedDuplicateCatalogueKeys.clear();
}

function valueMatchesFlagType(
  value: FlagValue,
  type: FlagType,
  variants: readonly FlagValue[] | undefined,
): boolean {
  if (type === "boolean") return typeof value === "boolean";
  if (type === "number") return typeof value === "number";
  if (type === "string") return typeof value === "string";
  if (type === "variant") {
    if (variants === undefined || variants.length === 0) return false;
    return variants.some((candidate) => Object.is(candidate, value));
  }
  return false;
}

/** Drops overrides whose value does not match the catalogue entry's declared type. */
export function vetOverrides(
  parsed: Record<string, FlagValue>,
  catalogue: readonly FlagReading[],
): Record<string, FlagValue> {
  const byKey = new Map<string, FlagReading>();
  for (const reading of catalogue) {
    if (typeof reading?.key !== "string" || reading.key === "") continue;
    if (!byKey.has(reading.key)) byKey.set(reading.key, reading);
  }
  const output = emptyOverrides();
  for (const [key, value] of Object.entries(parsed)) {
    const reading = byKey.get(key);
    if (reading === undefined) {
      output[key] = value;
      continue;
    }
    const type = inferType(reading);
    if (!valueMatchesFlagType(value, type, reading.variants)) continue;
    output[key] = value;
  }
  return output;
}

/** Parses a persisted override map, dropping anything that is not a flag value. */
export function parseOverrides(raw: string | null): Record<string, FlagValue> {
  return parseRecord(raw, isFlagValue);
}

/** A null-prototype copy. Every write to the override map goes through this. */
function cloneOverrides(source: Record<string, FlagValue>): Record<string, FlagValue> {
  return Object.assign(Object.create(null) as Record<string, FlagValue>, source);
}

/**
 * True when the URL asks for every override to be dropped.
 *
 * Exists because an override that breaks the page badly enough also breaks
 * the toolbar you'd use to remove it.
 */
export function resetRequested(param: string | null): boolean {
  if (param === null) return false;
  try {
    if (typeof location === "undefined" || typeof location.search !== "string") {
      return false;
    }
    const value = new URLSearchParams(location.search).get(param);
    return value === "reset" || value === "clear" || value === "off";
  } catch {
    return false;
  }
}

/** The row's markers, matching the `data-dtb-tag` values `ui.tsx` renders. */
function tagsFor(view: FlagView, reloadPending: ReadonlySet<string>): string[] {
  const tags: string[] = [];
  if (view.overridden) tags.push("override");
  if (view.applyError !== undefined) tags.push("not-applied");
  if (view.orphaned) tags.push("orphaned");
  if (view.promoted) tags.push("promoted");
  if (view.masked) tags.push("masked");
  if (view.expired) tags.push("expired");
  if (reloadPending.has(view.key)) tags.push("reload");
  return tags;
}

export function createFlagsRuntime(options: FlagsRuntimeOptions = {}): FlagsRuntime {
  const {
    flags,
    onOverride,
    onOverridesChange,
    pollMs = 1000,
    promoted,
    audience,
    redactOptions,
    resetParam = DEFAULT_RESET_PARAM,
    now = Date.now,
  } = options;

  const promotions = promotionsOf(promoted);
  const writable = typeof onOverride === "function" || typeof onOverridesChange === "function";

  let storage: ToolbarStorage | null = null;
  let overrides: Record<string, FlagValue> = emptyOverrides();
  let reloadPending = new Set<string>();
  // Per key, not one slot — a single `adapterError` would be erased by the
  // next successful call on any *other* key, hiding a still-failing row.
  const adapterErrors = new Map<string, string>();
  // The whole-map adapter fails or recovers as a whole, so it gets its own slot.
  let bulkError: string | null = null;
  let readError: string | null = null;

  /* ------------------------------------------------------------------ */
  /* Reading the consumer's flags. Never throws.                          */
  /* ------------------------------------------------------------------ */

  const readFlags = (): readonly FlagReading[] => {
    try {
      const value = readInput(flags);
      if (value === undefined || value === null) return [];
      if (!Array.isArray(value)) return [];
      return value as readonly FlagReading[];
    } catch (error) {
      // A consumer's getter throwing must not take down the bar: the slot is
      // inside an error boundary, but the factory and start()'s interval are not.
      // eslint-disable-next-line no-console
      console.error(
        "[dev-toolbar/ext/flags] the supplied flags getter threw. " + "Showing an empty list.",
        error,
      );
      return [];
    }
  };

  /* ------------------------------------------------------------------ */
  /* Redaction — once, on the way in.                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Renders one flag value as the single line every surface shows.
   *
   * The value is handed to `redact()` under its own key, since `redact()`
   * matches key names. `masked` is set by comparing the before/after render,
   * so a formatting difference alone can never trip the badge.
   */
  const render = (
    key: string,
    value: FlagValue | undefined,
    sensitive: boolean | undefined,
  ): { text: string; masked: boolean } => {
    if (value === undefined) return { text: "—", masked: false };
    if (sensitive) return { text: "[redacted]", masked: true };
    if (typeof value !== "string") {
      // Booleans and numbers can't carry a credential.
      return { text: formatValue(value), masked: false };
    }
    const before = formatValue(value);
    const bag = redact({ [key]: value }, redactOptions) as Record<string, unknown>;
    const after = formatValue(bag[key] as FlagValue);
    return { text: after, masked: after !== before };
  };

  /* Promotion window */

  /**
   * The promotion in force for a key right now, and where in `promoted` it
   * sits. Two entries can name the same key with different windows or
   * audiences, so "which entry won" isn't answerable from the key alone —
   * the index is published as {@link FlagView.promotedIndex} so `index.tsx`
   * can match the chosen entry's `presentation` rather than the wrong one's.
   * A number is plain data, which is what keeps it snapshot state at all.
   */
  const promotionFor = (key: string): { entry: PromotedFlag; index: number } | null => {
    const at = now();
    for (let index = 0; index < promotions.length; index += 1) {
      const entry = promotions[index] as PromotedFlag;
      if (entry.flagKey !== key) continue;
      const startAt = parseDate(entry.startAt);
      if (startAt !== null && at < startAt) continue;
      const expiresAt = parseDate(entry.expiresAt);
      if (expiresAt !== null && at > expiresAt) continue;
      if (entry.audience && entry.audience.length > 0) {
        const actor = audience ?? [];
        if (!entry.audience.some((name) => actor.includes(name))) continue;
      }
      return { entry, index };
    }
    return null;
  };

  /* Snapshot */

  const buildSnapshot = (revision: number): FlagsSnapshot => {
    const readings = readFlags();
    const at = now();
    const views: FlagView[] = [];
    const seen = new Set<string>();
    let maskedCount = 0;

    for (const reading of readings) {
      if (typeof reading?.key !== "string" || reading.key === "") continue;
      const key = reading.key;
      if (seen.has(key)) {
        warnDuplicateCatalogueKey(key);
        continue;
      }
      seen.add(key);
      const type = inferType(reading);
      const base = reading.value !== undefined ? reading.value : (reading.defaultValue ?? null);
      const defaultValue = reading.defaultValue ?? null;
      const hasOverride = Object.prototype.hasOwnProperty.call(overrides, key);
      const override = hasOverride ? overrides[key] : undefined;
      const effective = hasOverride ? (override as FlagValue) : base;

      const effectiveRender = render(key, effective, reading.sensitive);
      const baseRender = render(key, base, reading.sensitive);
      const defaultRender = render(key, defaultValue, reading.sensitive);
      const masked = effectiveRender.masked || baseRender.masked || defaultRender.masked;
      if (masked) maskedCount += 1;

      const expiresAtMs = parseDate(reading.expiresAt);
      const promotion = promotionFor(key);

      views.push({
        key,
        label: reading.label ?? key,
        ...(reading.description === undefined ? {} : { description: reading.description }),
        ...(reading.owner === undefined ? {} : { owner: reading.owner }),
        type,
        ...(reading.variants === undefined
          ? {}
          : {
              variants: [...reading.variants],
              // Variants get their own trip through render(): `masked` above
              // covers only effective/base/defaultValue, so a raw credential
              // would otherwise leak into the dropdown. Masked ones are
              // numbered so N `[redacted]` rows stay distinguishable.
              variantTexts: reading.variants.map((variant, index) => {
                const rendered = render(key, variant, reading.sensitive);
                return rendered.masked ? `variant ${index + 1} (masked)` : rendered.text;
              }),
            }),
        reloadBehavior: reading.reloadBehavior ?? "live",
        ...(reading.projectUrl === undefined ? {} : { projectUrl: reading.projectUrl }),
        ...(reading.expiresAt === undefined ? {} : { expiresAt: reading.expiresAt }),
        expired: expiresAtMs !== null && expiresAtMs < at,
        recentlyUsed: reading.recentlyUsed === true,

        effective,
        base,
        defaultValue,
        ...(hasOverride ? { override: override as FlagValue } : {}),
        overridden: hasOverride,
        source: hasOverride
          ? "local-override"
          : (reading.source ?? (base === defaultValue ? "default" : "unknown")),

        effectiveText: effectiveRender.text,
        baseText: baseRender.text,
        defaultText: defaultRender.text,
        masked,
        orphaned: false,
        ...(adapterErrors.has(key) ? { applyError: adapterErrors.get(key) as string } : {}),
        promoted: promotion !== null,
        ...(promotion === null
          ? {}
          : {
              promotedIndex: promotion.index,
              promotedLabel: promotion.entry.label ?? reading.label ?? key,
              ...(promotion.entry.icon === undefined ? {} : { promotedIcon: promotion.entry.icon }),
            }),
      });
    }

    // Overrides whose flag the catalogue no longer lists (a renamed flag,
    // usually). Still applied on every mount, so kept visible and clearable.
    for (const key of Object.keys(overrides)) {
      if (seen.has(key)) continue;
      const value = overrides[key] as FlagValue;
      const rendered = render(key, value, undefined);
      if (rendered.masked) maskedCount += 1;
      views.push({
        key,
        label: key,
        type:
          typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : "string",
        reloadBehavior: "live",
        expired: false,
        recentlyUsed: false,
        effective: value,
        base: null,
        defaultValue: null,
        override: value,
        overridden: true,
        source: "local-override",
        effectiveText: rendered.text,
        // There is no application value to show: nothing claims this flag.
        baseText: "—",
        defaultText: "—",
        masked: rendered.masked,
        orphaned: true,
        ...(adapterErrors.has(key) ? { applyError: adapterErrors.get(key) as string } : {}),
        promoted: false,
      });
    }

    // Recently used first, then overridden, then alphabetical.
    const sorted = [...views].sort((a, b) => {
      if (a.recentlyUsed !== b.recentlyUsed) return a.recentlyUsed ? -1 : 1;
      if (a.overridden !== b.overridden) return a.overridden ? -1 : 1;
      return a.key.localeCompare(b.key);
    });

    // Bar order follows the consumer's declared promotion order, not the
    // panel's, so a promoted flag's bar position doesn't move on override.
    //
    // Matched on promotedIndex, not flagKey: two entries can name the same
    // key, and matching by name pushed every one of them as duplicate views
    // (duplicate buttons, React's same-key error). Each promoted view has
    // exactly one index, ascending with `promotions`.
    const promotedViews: FlagView[] = [];
    for (let index = 0; index < promotions.length; index += 1) {
      const view = sorted.find((candidate) => candidate.promotedIndex === index);
      if (view) promotedViews.push(view);
    }

    return {
      revision,
      at: monotonic(),
      flags: sorted,
      promoted: promotedViews,
      overriddenCount: sorted.filter((view) => view.overridden).length,
      maskedCount,
      supplied: readings.length > 0,
      writable,
      reloadPending: [...reloadPending],
      adapterErrors: Object.fromEntries(adapterErrors),
      bulkError,
      readError,
    };
  };

  // Nothing here may propagate: the first build() runs at factory time,
  // before core mounts anything, so a throw would take down the host app's
  // render rather than degrade to an error chip. Later calls run inside a
  // setInterval, where nothing could catch them at all.
  const build = (revision: number): FlagsSnapshot => {
    try {
      return buildSnapshot(revision);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        "[dev-toolbar/ext/flags] building the flag snapshot threw. " +
          "Showing an empty list; a getter on a flag reading is the usual cause.",
        error,
      );
      return {
        revision,
        at: monotonic(),
        flags: [],
        promoted: [],
        overriddenCount: 0,
        maskedCount: 0,
        supplied: true,
        writable,
        reloadPending: [],
        adapterErrors: Object.fromEntries(adapterErrors),
        bulkError,
        readError: "The flag list could not be read — it threw. See the console.",
      };
    }
  };

  const store = createDerivedStore<FlagsSnapshot>(build, {
    intervalMs: 250,
    // Counters that change on every build, and the promotion presentation the
    // consumer passes as config — a change to it alone never publishes.
    ignorePaths: [
      ["revision"],
      ["at"],
      ["flags", "promotedLabel"],
      ["flags", "promotedIcon"],
      ["promoted", "promotedLabel"],
      ["promoted", "promotedIcon"],
    ],
  });

  const publish = store.rebuild;

  /* Mutation */

  const persist = () => {
    writePreference(storage, OVERRIDES_PREFERENCE, JSON.stringify(overrides));
  };

  // Calls the consumer's adapter. A failure is recorded, not swallowed — a
  // panel that shows "overridden" while the app never heard about it is a lie.
  const apply = (key: string, value: FlagValue | undefined): void => {
    if (!writable) return;
    try {
      onOverride?.(key, value);
      adapterErrors.delete(key);
    } catch (error) {
      // Rendered as a row `title`, so the message is masked under the
      // consumer's own redactOptions before this sentence is built.
      adapterErrors.set(
        key,
        `${describeError(error, redactOptions).message} — your application may not have picked this override up.`,
      );
      // eslint-disable-next-line no-console
      console.error(`[dev-toolbar/ext/flags] the onOverride adapter threw for "${key}".`, error);
    }
  };

  const notifyOverrides = (): void => {
    if (typeof onOverridesChange !== "function") return;
    try {
      onOverridesChange({ ...overrides });
      bulkError = null;
    } catch (error) {
      bulkError = `${describeError(error, redactOptions).message} — your application may not have picked the override map up.`;
      // eslint-disable-next-line no-console
      console.error("[dev-toolbar/ext/flags] the onOverridesChange adapter threw.", error);
    }
  };

  const markReload = (key: string) => {
    const view = store.peek().flags.find((candidate) => candidate.key === key);
    const behavior = view?.reloadBehavior ?? "live";
    if (behavior !== "live") reloadPending.add(key);
  };

  const write = (key: string, value: FlagValue): void => {
    if (!writable) return;
    overrides = cloneOverrides(overrides);
    overrides[key] = value;
    persist();
    apply(key, value);
    notifyOverrides();
    markReload(key);
    publish();
    store.flush();
  };

  const drop = (key: string): void => {
    if (!writable) return;
    if (!Object.prototype.hasOwnProperty.call(overrides, key)) return;
    const next = cloneOverrides(overrides);
    delete next[key];
    overrides = next;
    persist();
    apply(key, undefined);
    notifyOverrides();
    markReload(key);
    publish();
    store.flush();
  };

  return {
    store,
    storage: () => storage,
    refresh: publish,
    overrides: () => ({ ...overrides }),
    setOverride: write,
    clearOverride: drop,

    clearAll() {
      if (!writable) return;
      const keys = Object.keys(overrides);
      if (keys.length === 0) return;
      overrides = emptyOverrides();
      persist();
      for (const key of keys) {
        // No explicit `adapterErrors.delete` here or in `drop`: a successful
        // `apply` clears its own error, but a *failed* clear must keep one —
        // the app is still running the override it was told to drop.
        apply(key, undefined);
        markReload(key);
      }
      notifyOverrides();
      publish();
      store.flush();
    },

    applyOverride(key: string, value?: FlagValue) {
      if (typeof key !== "string" || key === "") {
        throw new Error("`key` is required and must be a non-empty string.");
      }
      if (!writable) {
        throw new Error(
          `This toolbar's flags are read-only — no \`onOverride\` or \`onOverridesChange\` ` +
            `adapter was supplied, so "${key}" cannot be overridden.`,
        );
      }
      if (value === undefined) {
        if (!Object.prototype.hasOwnProperty.call(overrides, key)) return;
        drop(key);
        return;
      }
      if (!isFlagValue(value)) {
        throw new Error(
          `"${key}" was given a ${typeof value}. A flag value is a boolean, string, number or null.`,
        );
      }
      const reading = readFlags().find(
        (candidate) => typeof candidate?.key === "string" && candidate.key === key,
      );
      // An unknown key is a typo far more often than a deliberate orphan, and
      // an orphan created by a command is invisible until the panel is opened.
      if (reading === undefined && !Object.prototype.hasOwnProperty.call(overrides, key)) {
        throw new Error(
          `No flag named "${key}". The catalogue lists: ` +
            `${readFlags()
              .map((candidate) => candidate?.key)
              .filter((candidate): candidate is string => typeof candidate === "string")
              .join(", ")}.`,
        );
      }
      // Same rule `vetOverrides` applies to a persisted override: a command
      // cannot write a value a reload would then discard.
      if (reading !== undefined) {
        const type = inferType(reading);
        if (!valueMatchesFlagType(value, type, reading.variants)) {
          throw new Error(
            `"${key}" is a ${type} flag; ${JSON.stringify(value)} is not a valid ${type} value` +
              `${
                reading.variants === undefined
                  ? ""
                  : // Rendered, not raw: a credential mid-sentence would not match
                    // the agent bridge's anchored redaction shapes.
                    ` (variants: ${JSON.stringify(
                      reading.variants.map(
                        (variant) => render(key, variant, reading.sensitive).text,
                      ),
                    )})`
              }.`,
          );
        }
      }
      write(key, value);
    },

    toggle(key: string) {
      const view = store.peek().flags.find((candidate) => candidate.key === key);
      if (!view) return;
      const next = !(view.effective === true);
      // Toggling back to the app's own value drops the override rather than
      // pinning it, so "toggle twice" leaves no residue.
      if (view.overridden && next === view.base) drop(key);
      else write(key, next);
    },

    acknowledgeReload() {
      if (reloadPending.size === 0) return;
      reloadPending = new Set();
      publish();
      store.flush();
    },

    start(api: ExtensionRuntimeApi) {
      storage = api.storage;

      // Before anything is applied, so a wedging override never reaches the app on the reset load.
      if (resetRequested(resetParam)) {
        const stored = readPreferenceIfReadable(storage, OVERRIDES_PREFERENCE);
        const previous = stored.readable ? parseOverrides(stored.value) : emptyOverrides();
        const resetKeys = new Set([...Object.keys(previous), ...Object.keys(overrides)]);
        overrides = emptyOverrides();
        for (const key of resetKeys) apply(key, undefined);
        persist();
        notifyOverrides();
      } else if (writable) {
        const stored = readPreferenceIfReadable(storage, OVERRIDES_PREFERENCE);
        // Keep unreadable session entries: they are already applied, and the map is the toolbar's handle for clearing them.
        if (stored.readable) {
          overrides = vetOverrides(parseOverrides(stored.value), readFlags());
        }
        // Re-apply on every mount — this is what makes an override outlive
        // the tab. Applying the same value twice is fine; setting a flag is
        // inherently idempotent.
        for (const [key, value] of Object.entries(overrides)) {
          apply(key, value);
        }
        notifyOverrides();
      }

      // A `Readable` says when it changed; only a bare getter needs the timer.
      const live = isReadable(flags);
      const stopListening = live ? flags.subscribe(() => publish()) : () => {};
      const stopPolling =
        typeof flags === "function" && !live
          ? createPoller(publish, {
              intervalMs: pollMs,
              fallbackMs: 1000,
              signal: api.signal,
            })
          : () => {};
      const stopWatching = api.subscribeVisibility(() => publish());
      publish();
      store.flush();

      // The store belongs to the runtime, not to one start/stop cycle: React
      // StrictMode runs mount -> cleanup -> mount, and destroying it on the
      // first cleanup would drop React's subscription and freeze the panel.
      let disposed = false;
      const dispose = () => {
        // Idempotent: core aborts the signal and then calls the returned cleanup,
        // and a consumer's unsubscribe need not tolerate a second call.
        if (disposed) return;
        disposed = true;
        stopPolling();
        stopWatching();
        try {
          stopListening();
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error("[dev-toolbar/ext/flags] the supplied flags' unsubscribe threw.", error);
        }
      };
      api.signal.addEventListener("abort", dispose, { once: true });
      return dispose;
    },

    recipeText() {
      const snapshot = store.read();
      const active = snapshot.flags.filter((view) => view.overridden);
      if (active.length === 0) return "No local flag overrides are active.";
      const lines = active.map(
        (view) => `${view.key} = ${view.effectiveText} (was ${view.baseText})`,
      );
      if (snapshot.maskedCount > 0) {
        lines.push(
          `(${snapshot.maskedCount} value${snapshot.maskedCount === 1 ? "" : "s"} masked before copying)`,
        );
      }
      return lines.join("\n");
    },

    diagnostics() {
      const snapshot = store.read();
      const pending = new Set(snapshot.reloadPending);
      const payload = {
        generatedAt: new Date(now()).toISOString(),
        writable: snapshot.writable,
        supplied: snapshot.supplied,
        overriddenCount: snapshot.overriddenCount,
        maskedCount: snapshot.maskedCount,
        reloadPending: snapshot.reloadPending,
        readError: snapshot.readError,
        bulkError: snapshot.bulkError,
        /** Every catalogued row, so a reader can compare base and effective values. */
        flags: snapshot.flags.map((view) => ({
          key: view.key,
          type: view.type,
          source: view.source,
          overridden: view.overridden,
          masked: view.masked,
          reloadBehavior: view.reloadBehavior,
          // Preserve typed values while unmasked. Masked rows use the same
          // redacted display strings as the panel.
          effective: view.masked ? view.effectiveText : view.effective,
          base: view.masked ? view.baseText : view.base,
          default: view.masked ? view.defaultText : view.defaultValue,
          tags: tagsFor(view, pending),
        })),
        overrides: snapshot.flags
          .filter((view) => view.overridden)
          .map((view) => ({
            key: view.key,
            // Never expose raw values that the panel would not show.
            value: view.effectiveText,
            was: view.baseText,
            masked: view.masked,
            reloadBehavior: view.reloadBehavior,
          })),
      };
      // Keep a second pass in case a field is added above without redaction.
      return redact(payload, redactOptions);
    },
  };
}
