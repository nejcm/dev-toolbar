/**
 * Shared vocabulary for `/ext/flags`. [dev-toolbar/ext/flags]
 *
 * Flags are **consumer-owned state**, exactly like the session context
 * `/ext/environment` renders. This extension owns no flag store, integrates no
 * provider and reaches for no global. You hand it what your application
 * resolved, and — if you want the panel to do more than read — a typed adapter
 * it can call when somebody asks for a local override.
 *
 * The one piece of state it *does* own is the override map, because that is a
 * toolbar preference and nothing else in the app knows about it. It is
 * persisted through `api.storage` and re-applied through your adapter.
 */

/** §3C's value domain. `null` is a real value ("unset variant"), not "no value". */
export type FlagValue = boolean | string | number | null;

export type FlagType = "boolean" | "string" | "number" | "variant";

/** §3C's evaluation source. `"local-override"` is this extension's own doing. */
export type FlagSource =
  | "default"
  | "server-rule"
  | "cohort"
  | "workspace"
  | "local-override"
  | "unknown";

/**
 * What happens to the running application when this flag changes.
 *
 * `"live"` — the app re-reads it and repaints. `"route-refresh"` — the current
 * route has to remount. `"full-reload"` — it was read once at boot and the page
 * has to reload. The panel says so per row, per §3C, rather than pretending
 * every override takes effect immediately.
 */
export type ReloadBehavior = "live" | "route-refresh" | "full-reload";

export interface FeatureFlagDefinition {
  key: string;
  /** Human name. Defaults to `key`. */
  label?: string;
  description?: string;
  owner?: string;
  /** Defaults to the shape of `value`/`defaultValue`, or `"string"`. */
  type?: FlagType;
  defaultValue?: FlagValue;
  /** Allowed values for `type: "variant"`. Rendered as a `<select>`. */
  variants?: readonly FlagValue[];
  /** Default `"live"`. */
  reloadBehavior?: ReloadBehavior;
  /** ISO date. A past date is called out — a stale flag is technical debt. */
  expiresAt?: string;
  /** Link to the project/issue tracking this flag's removal. */
  projectUrl?: string;
  /**
   * Never render or copy this flag's value, whatever it is.
   *
   * `redact()` already masks credential-shaped keys and values on the way in;
   * this is the manual override for a value only you know is sensitive.
   */
  sensitive?: boolean;
}

/**
 * One flag as your application currently resolves it.
 *
 * `value` is the value **before any toolbar override** — see the note on
 * `FlagsOptions.flags`. Getting this wrong is survivable: the override badge is
 * driven by the extension's own override map, never by comparing values.
 */
export interface FlagReading extends FeatureFlagDefinition {
  value?: FlagValue;
  /** Where `value` came from. Default `"unknown"` (or `"default"` if it equals `defaultValue`). */
  source?: FlagSource;
  /** Bubbles to the top of the list, per §3C's "recently used". */
  recentlyUsed?: boolean;
}

export type FlagsInput =
  | readonly FlagReading[]
  | (() => readonly FlagReading[]);

/**
 * One flag pinned into the bar as its own control, per `plans/dev-bar.md` §7.
 *
 * The promotion window is checked against the clock; an expired promotion falls
 * back into the panel rather than disappearing. `audience` is consumer-computed
 * the same way `hidden` is — see `FlagsOptions.audience`.
 */
export interface PromotedFlag {
  flagKey: string;
  /** Bar label. Defaults to the flag's `label`, then its `key`. */
  label?: string;
  /** A short glyph rendered before the label. Text, not an asset. */
  icon?: string;
  /** ISO date. Before it, the flag is not promoted. */
  startAt?: string;
  /** ISO date. After it, the flag is not promoted. */
  expiresAt?: string;
  /** Promoted only for an actor in one of these. Empty/omitted means everybody. */
  audience?: readonly string[];
}

/** Chip/dot colour. Same vocabulary and tokens `/ext/metrics` and `/ext/environment` use. */
export type FlagSeverity = "unknown" | "ok" | "warn" | "bad" | "override";

/** One row, fully derived and already redacted. The panel and the clipboard share it. */
export interface FlagView {
  key: string;
  label: string;
  description?: string;
  owner?: string;
  type: FlagType;
  variants?: readonly FlagValue[];
  reloadBehavior: ReloadBehavior;
  projectUrl?: string;
  expiresAt?: string;
  /** True when `expiresAt` is in the past. */
  expired: boolean;
  recentlyUsed: boolean;

  /** `override ?? base`, i.e. what this extension believes the app sees. */
  effective: FlagValue;
  /** The application's own value, ignoring the override. */
  base: FlagValue;
  defaultValue: FlagValue;
  /** The local override, or `undefined` when there is none. */
  override?: FlagValue;
  overridden: boolean;
  /** `"local-override"` when overridden, otherwise the reading's own source. */
  source: FlagSource;

  /** Display strings. Already redacted — there is no unmasked path to the UI. */
  effectiveText: string;
  baseText: string;
  defaultText: string;
  /**
   * True when `redact()` or `sensitive: true` changed what this row shows. The
   * editor refuses to round-trip a masked value; it takes a new one instead.
   */
  masked: boolean;
  /**
   * True when this row exists only because a stored override names it — the
   * consumer's catalogue no longer does.
   *
   * A renamed or deleted flag leaves its override behind, and that override is
   * still applied to the application on every mount. A row the panel does not
   * render is a row nobody can clear, so orphans are rendered, counted and
   * clearable like any other override.
   */
  orphaned: boolean;
  /** Set when this key's own `onOverride` call threw. Cleared by its own success. */
  applyError?: string;
  /** True when the flag is promoted into the bar right now. */
  promoted: boolean;
  promotedLabel?: string;
  promotedIcon?: string;
}

export interface FlagsSnapshot {
  revision: number;
  at: number;
  flags: readonly FlagView[];
  /** Bar order. Empty when nothing is promoted right now. */
  promoted: readonly FlagView[];
  overriddenCount: number;
  maskedCount: number;
  /** True when the consumer supplied no flags at all. */
  supplied: boolean;
  /** False when no `onOverride` adapter was supplied — the panel is read-only. */
  writable: boolean;
  /**
   * Keys whose override is waiting on a reload/route refresh. Cleared by
   * `acknowledgeReload()` or by the reload itself.
   */
  reloadPending: readonly string[];
  /**
   * Per key, the last failure from the consumer's adapter, cleared only by that
   * key's own success.
   *
   * It was one slot; any later success anywhere erased it, which is the same
   * lie the badge is supposed to prevent — row still says "overridden", app
   * never heard about it, banner gone.
   */
  adapterErrors: Readonly<Record<string, string>>;
  /** Set when the flag list itself could not be read. Distinct from an adapter failure. */
  readError: string | null;
}

/* -------------------------------------------------------------------------- */
/* Small pure helpers, shared by the runtime and the UI.                       */
/* -------------------------------------------------------------------------- */

export function inferType(reading: FeatureFlagDefinition & { value?: FlagValue }): FlagType {
  if (reading.type) return reading.type;
  if (reading.variants && reading.variants.length > 0) return "variant";
  const probe = reading.value !== undefined ? reading.value : reading.defaultValue;
  if (typeof probe === "boolean") return "boolean";
  if (typeof probe === "number") return "number";
  return "string";
}

/** One value as one line. `null` is spelled out; it is a value, not an absence. */
export function formatValue(value: FlagValue | undefined): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/**
 * Parses what an editor holds back into the flag's own type, or `undefined`
 * when it is not a value of that type.
 *
 * `undefined` rather than a fallback on purpose: coercing `"abc"` to `0` in a
 * number editor silently overrides the flag to zero, persists it and applies it
 * to the running application. A refused edit is recoverable; a wrong one that
 * looks deliberate is not.
 */
export function parseValue(
  type: FlagType,
  raw: string,
): FlagValue | undefined {
  const trimmed = raw.trim();
  if (type === "boolean") {
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    return undefined;
  }
  if (type === "number") {
    if (trimmed === "") return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (trimmed === "null") return null;
  return raw;
}

/** §3C's searchable list. Matches key, label, description and owner. */
export function matchesQuery(view: FlagView, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return [view.key, view.label, view.description, view.owner]
    .filter((part): part is string => typeof part === "string")
    .some((part) => part.toLowerCase().includes(needle));
}

/** Severity for a row: an active override outranks everything, per §7's colour table. */
export function severityFor(view: FlagView): FlagSeverity {
  // An override the application never received is the loudest thing here: the
  // row says "overridden" and the app disagrees.
  if (view.applyError !== undefined) return "bad";
  // Orphans are checked *before* `overridden`, which they always are — putting
  // the general case first made this branch unreachable. An override whose flag
  // no longer exists is stale state to clean up, not a deliberate override, and
  // grading it the same accent as a live one hides exactly that difference.
  if (view.orphaned || view.expired) return "warn";
  if (view.overridden) return "override";
  return "unknown";
}
