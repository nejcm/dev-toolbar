/**
 * Everything `/ext/flags` owns that is not React. [dev-toolbar/ext/flags]
 *
 * Built by `flags()`, not by `start(api)` — slot functions run during the
 * toolbar's first render, before any effect fires, so the store the chip reads
 * has to exist by the time the factory returns. Same rule as `/ext/metrics` and
 * `/ext/environment`; this is the third time it is the first thing to know.
 *
 * Two things make this extension different from the two before it.
 *
 * **It mutates the application.** Metrics and environment observe. An override
 * here changes what the app does, it outlives the tab, and it is applied by
 * *consumer* code this extension calls. So: every call into consumer code is
 * wrapped, the failure is shown rather than swallowed, and there is a kill
 * switch (`?dtb-flags=reset`) that works before React mounts — because the
 * override that wedges the app is exactly the one you cannot reach the panel to
 * remove.
 *
 * **Flag keys and values can carry secrets.** Same rule `/ext/environment`
 * settled: `redact()` runs on the way *in*, once, and the panel and the
 * clipboard read the same redacted view. There is no path from a raw flag value
 * to an output that skips it.
 */
import { createThrottledStore, redact } from "../../runtime";
import type { RedactOptions, ThrottledStore } from "../../runtime";
import type { ExtensionRuntimeApi, ToolbarStorage } from "../../core/contract";
import { formatValue, inferType } from "./types";
import type {
  FlagReading,
  FlagValue,
  FlagView,
  FlagsInput,
  FlagsSnapshot,
  PromotedFlag,
} from "./types";

/** The key, inside the extension's own storage scope, the override map lives at. */
export const OVERRIDES_KEY = "overrides";

/** Query parameter that clears every override before it is applied. */
export const DEFAULT_RESET_PARAM = "dtb-flags";

export interface FlagsRuntimeOptions {
  /**
   * What your application resolved, **before local overrides**.
   *
   * Pass a function for values that change; it is re-read every `pollMs` and
   * on demand. If you fold the toolbar's overrides back into the same store you
   * read this from, nothing breaks: the override badge comes from this
   * extension's own map, not from comparing values.
   */
  flags?: FlagsInput;
  /**
   * Apply an override to your own flag state. `value === undefined` means the
   * flag no longer has a local override — fall back to your own resolution.
   *
   * Omit it and the panel is **read-only**: it lists, searches and copies, and
   * offers no editors at all. That is the honest degradation for a consumer who
   * has nowhere to put an override.
   */
  onOverride?(key: string, value: FlagValue | undefined): void;
  /** Re-read a function `flags` this often, in ms. Default `1000`. */
  pollMs?: number;
  /** Flags pinned into the bar as their own controls. See §7. */
  promoted?: PromotedFlag | readonly PromotedFlag[];
  /**
   * Audiences the current actor belongs to. A `PromotedFlag` with an `audience`
   * is promoted only when it intersects this. Consumer-computed, like `hidden`
   * — core has no identity to hand anybody and neither does this.
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
  /** `null` until `start(api)` runs. */
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

function toArray(
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

function isFlagValue(value: unknown): value is FlagValue {
  return (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  );
}

/** Parses a persisted override map, dropping anything that is not a flag value. */
export function parseOverrides(raw: string | null): Record<string, FlagValue> {
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  // Null prototype so a persisted `__proto__` key round-trips as data rather
  // than being dropped on the way in while surviving on the way out.
  const output: Record<string, FlagValue> = Object.create(null) as Record<string, FlagValue>;
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (isFlagValue(value)) output[key] = value;
  }
  return output;
}

/** A null-prototype copy. Every write to the override map goes through this. */
function cloneOverrides(source: Record<string, FlagValue>): Record<string, FlagValue> {
  return Object.assign(Object.create(null) as Record<string, FlagValue>, source);
}

const emptyOverrides = (): Record<string, FlagValue> =>
  Object.create(null) as Record<string, FlagValue>;

/**
 * True when the URL asks for every override to be dropped.
 *
 * This is the part of the design that exists because overrides *persist* and
 * *mutate the app*. An override that breaks the page badly enough also breaks
 * the toolbar you would use to remove it, and "clear your localStorage" is not
 * an escape hatch a developer can talk a colleague through over chat.
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

export function createFlagsRuntime(options: FlagsRuntimeOptions = {}): FlagsRuntime {
  const {
    flags,
    onOverride,
    pollMs = 1000,
    promoted,
    audience,
    redactOptions,
    resetParam = DEFAULT_RESET_PARAM,
    now = Date.now,
  } = options;

  const promotions = toArray(promoted);
  const writable = typeof onOverride === "function";

  let revision = 0;
  let storage: ToolbarStorage | null = null;
  let overrides: Record<string, FlagValue> = emptyOverrides();
  let reloadPending = new Set<string>();
  /**
   * Per key, not one slot. A single `adapterError` was erased by the next
   * successful call on any *other* key, which took the only warning off screen
   * while the failed row carried on claiming to be overridden.
   */
  const adapterErrors = new Map<string, string>();
  let readError: string | null = null;

  /* ------------------------------------------------------------------ */
  /* Reading the consumer's flags. Never throws.                          */
  /* ------------------------------------------------------------------ */

  const readFlags = (): readonly FlagReading[] => {
    try {
      const value = typeof flags === "function" ? flags() : flags;
      if (value === undefined || value === null) return [];
      if (!Array.isArray(value)) return [];
      return value as readonly FlagReading[];
    } catch (error) {
      // A consumer's getter throwing must not take down the bar: the slot is
      // inside an error boundary, but the factory and start()'s interval are
      // not. Same rule /ext/environment settled.
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
   * The value is handed to `redact()` **under its own key**, because `redact()`
   * matches key names: a flag called `checkout.apiToken` must mask, and it only
   * can if the key reaches the redactor. The rendered before/after pair is what
   * sets `masked`, so the badge can never be set by a formatting difference.
   */
  const render = (
    key: string,
    value: FlagValue | undefined,
    sensitive: boolean | undefined,
  ): { text: string; masked: boolean } => {
    if (value === undefined) return { text: "—", masked: false };
    if (sensitive) return { text: "[redacted]", masked: true };
    if (typeof value !== "string") {
      // Booleans and numbers cannot carry a credential, and masking them by key
      // name would make a flag called `session.newLogin` unreadable for no gain.
      return { text: formatValue(value), masked: false };
    }
    const before = formatValue(value);
    const bag = redact({ [key]: value }, redactOptions) as Record<string, unknown>;
    const after = formatValue(bag[key] as FlagValue);
    return { text: after, masked: after !== before };
  };

  /* ------------------------------------------------------------------ */
  /* Promotion window                                                     */
  /* ------------------------------------------------------------------ */

  const promotionFor = (key: string): PromotedFlag | null => {
    const at = now();
    for (const entry of promotions) {
      if (entry.flagKey !== key) continue;
      const startAt = parseDate(entry.startAt);
      if (startAt !== null && at < startAt) continue;
      const expiresAt = parseDate(entry.expiresAt);
      if (expiresAt !== null && at > expiresAt) continue;
      if (entry.audience && entry.audience.length > 0) {
        const actor = audience ?? [];
        if (!entry.audience.some((name) => actor.includes(name))) continue;
      }
      return entry;
    }
    return null;
  };

  /* ------------------------------------------------------------------ */
  /* Snapshot                                                             */
  /* ------------------------------------------------------------------ */

  const buildSnapshot = (): FlagsSnapshot => {
    const readings = readFlags();
    const at = now();
    const views: FlagView[] = [];
    const seen = new Set<string>();
    let maskedCount = 0;

    for (const reading of readings) {
      if (typeof reading?.key !== "string" || reading.key === "") continue;
      const key = reading.key;
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
        ...(reading.variants === undefined ? {} : { variants: reading.variants }),
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
              promotedLabel: promotion.label ?? reading.label ?? key,
              ...(promotion.icon === undefined ? {} : { promotedIcon: promotion.icon }),
            }),
      });
    }

    // Overrides whose flag the catalogue no longer lists. They are still being
    // applied to the running application on every mount, so leaving them out of
    // the snapshot made them invisible *and* unclearable: the chip counted
    // views, and "Clear all overrides (0)" disabled itself over a live
    // override. A renamed flag is the ordinary way to get here.
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

    // §3C: recently used first, then overridden, then alphabetical. The panel
    // does not re-sort; this order is the one every surface reads.
    const sorted = [...views].sort((a, b) => {
      if (a.recentlyUsed !== b.recentlyUsed) return a.recentlyUsed ? -1 : 1;
      if (a.overridden !== b.overridden) return a.overridden ? -1 : 1;
      return a.key.localeCompare(b.key);
    });

    // Bar order is the order the consumer declared the promotions in, not the
    // panel's order: a promoted flag's position in the bar should not move
    // because somebody overrode it.
    const promotedViews: FlagView[] = [];
    for (const entry of promotions) {
      const view = sorted.find(
        (candidate) => candidate.key === entry.flagKey && candidate.promoted,
      );
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
      readError,
    };
  };

  /**
   * Nothing here may propagate. The first `build()` runs inside `flags()` — at
   * factory time, before core has mounted anything — so a throw there does not
   * degrade to an error chip, it takes down the host application's render. The
   * later ones run inside a `setInterval`, where nobody can catch them at all.
   */
  const build = (): FlagsSnapshot => {
    try {
      return buildSnapshot();
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
        readError: "The flag list could not be read — it threw. See the console.",
      };
    }
  };

  const signature = (snapshot: FlagsSnapshot): string =>
    `${snapshot.readError ?? ""}|${snapshot.reloadPending.join(",")}|` +
    snapshot.flags
      .map(
        (view) =>
          `${view.key}=${view.effectiveText}:${view.baseText}:${view.defaultText}:${view.source}:${view.overridden ? 1 : 0}:${view.promoted ? 1 : 0}:${view.orphaned ? 1 : 0}:${view.applyError ?? ""}`,
      )
      .join("|");

  const store = createThrottledStore<FlagsSnapshot>(build(), {
    intervalMs: 250,
    equals: (a, b) => signature(a) === signature(b),
  });

  // `revision` advances when a snapshot is *published*, not when one is built:
  // `recipeText()` and `diagnostics()` build without publishing, and bumping
  // there made the revision a count of reads.
  const publish = () => {
    revision += 1;
    store.set(build());
  };

  /* ------------------------------------------------------------------ */
  /* Mutation                                                             */
  /* ------------------------------------------------------------------ */

  const persist = () => {
    if (storage === null) return;
    try {
      if (Object.keys(overrides).length === 0) {
        storage.removeItem(OVERRIDES_KEY);
      } else {
        storage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
      }
    } catch {
      // A custom adapter is consumer code. Losing persistence is survivable;
      // throwing out of a click handler is not.
    }
  };

  /**
   * Calls the consumer's adapter. It is consumer code running inside our click
   * handler, so it is wrapped — but the failure is *recorded*, not swallowed:
   * a panel that shows "overridden" while the app never heard about it is
   * exactly the lie `/ext/environment` §11.3 warns about.
   */
  const apply = (key: string, value: FlagValue | undefined): void => {
    if (!writable) return;
    try {
      onOverride?.(key, value);
      // Only this key's own failure clears, and only on its own success.
      adapterErrors.delete(key);
    } catch (error) {
      adapterErrors.set(
        key,
        `${
          error instanceof Error ? error.message : String(error)
        } — your application may not have picked this override up.`,
      );
      // eslint-disable-next-line no-console
      console.error(`[dev-toolbar/ext/flags] the onOverride adapter threw for "${key}".`, error);
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
        // `apply` clears the key's own error, and a *failed* clear must keep
        // one — the application is still running the override it was told to
        // drop. The row says "clear not applied" and grades `bad`.
        apply(key, undefined);
        markReload(key);
      }
      publish();
      store.flush();
    },

    toggle(key: string) {
      const view = store.peek().flags.find((candidate) => candidate.key === key);
      if (!view) return;
      const next = !(view.effective === true);
      // Toggling back to the application's own value removes the override
      // rather than pinning it, so "toggle twice" leaves no residue behind.
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

      // The kill switch runs before anything is applied, so a wedging override
      // never reaches the app on the reset load.
      if (resetRequested(resetParam)) {
        overrides = emptyOverrides();
        persist();
      } else {
        let raw: string | null = null;
        try {
          raw = api.storage.getItem(OVERRIDES_KEY);
        } catch {
          raw = null;
        }
        overrides = parseOverrides(raw);
        // Re-apply on every mount: the page reloaded with the application's own
        // values, and this is what makes an override outlive the tab. Applying
        // the same value twice is the consumer's problem to make idempotent,
        // which setting a flag inherently is.
        for (const [key, value] of Object.entries(overrides)) {
          apply(key, value);
        }
      }

      const timer =
        typeof flags === "function" ? setInterval(publish, Math.max(250, pollMs)) : null;
      const stopWatching = api.subscribeVisibility(() => publish());
      publish();
      store.flush();

      // The store belongs to the runtime, not to one start/stop cycle: React
      // StrictMode runs mount → cleanup → mount, and destroying it on the first
      // cleanup drops React's subscription and freezes the panel.
      const dispose = () => {
        if (timer !== null) clearInterval(timer);
        stopWatching();
      };
      api.signal.addEventListener("abort", dispose, { once: true });
      return dispose;
    },

    recipeText() {
      const snapshot = build();
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
      const snapshot = build();
      const payload = {
        generatedAt: new Date(now()).toISOString(),
        writable: snapshot.writable,
        overriddenCount: snapshot.overriddenCount,
        maskedCount: snapshot.maskedCount,
        reloadPending: snapshot.reloadPending,
        overrides: snapshot.flags
          .filter((view) => view.overridden)
          .map((view) => ({
            key: view.key,
            // The redacted display strings, never the raw values: a command is
            // a second front door onto the same data, and it must not be able
            // to fetch what the panel would not show.
            value: view.effectiveText,
            was: view.baseText,
            masked: view.masked,
            reloadBehavior: view.reloadBehavior,
          })),
      };
      // Values are already redacted; this second pass costs nothing and means
      // the dump stays safe if a field is added above and this is forgotten.
      return redact(payload, redactOptions);
    },
  };
}
