/**
 * Shared vocabulary for `/ext/flags`. [dev-toolbar/ext/flags]
 *
 * Flags are **consumer-owned state**, like the session context
 * `/ext/environment` renders: this extension owns no flag store, integrates
 * no provider, reaches for no global. You hand it what your application
 * resolved, plus an optional typed adapter for local overrides.
 *
 * The one state it does own is the override map — a toolbar preference
 * nothing else in the app knows about — persisted via `api.storage` and
 * re-applied through your adapter.
 */
import { matchesQuery as matchesKitQuery } from "@nejcm/dev-toolbar/kit";
import type { CompactPresentationInput, Input, SeverityWithOverride } from "@nejcm/dev-toolbar/kit";

/** `null` is a real value ("unset variant"), not "no value". */
export type FlagValue = boolean | string | number | null;

export type FlagType = "boolean" | "string" | "number" | "variant";

/** Evaluation source. `"local-override"` is this extension's own doing. */
export type FlagSource =
  | "default"
  | "server-rule"
  | "cohort"
  | "workspace"
  | "local-override"
  | "unknown";

/**
 * What happens to the running application when this flag changes: `"live"`
 * re-reads and repaints, `"route-refresh"` remounts the route, `"full-reload"`
 * needs a page reload. Shown per row rather than assuming instant effect.
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
   * Never render or copy this flag's value. `redact()` already masks
   * credential-shaped keys/values automatically; this is the manual override
   * for a value only you know is sensitive.
   */
  sensitive?: boolean;
}

/**
 * One flag as your application currently resolves it.
 *
 * `value` is the value **before any toolbar override**. Getting this wrong is
 * survivable: the override badge comes from the extension's own override map,
 * never from comparing values.
 */
export interface FlagReading extends FeatureFlagDefinition {
  value?: FlagValue;
  /** Where `value` came from. Default `"unknown"` (or `"default"` if it equals `defaultValue`). */
  source?: FlagSource;
  /** Bubbles to the top of the list. */
  recentlyUsed?: boolean;
}

/**
 * The catalogue as an array, a getter (re-read every `pollMs`), or a `Readable`
 * / `{ getState, subscribe }` store (re-read when it notifies, never polled).
 * See `createSource` and `useSource` in `@nejcm/dev-toolbar/kit`.
 */
export type FlagsInput = Input<readonly FlagReading[]>;

/**
 * One flag pinned into the bar as its own control.
 *
 * The promotion window is checked against the clock; an expired promotion
 * falls back into the panel rather than disappearing.
 */
export interface PromotedFlag {
  flagKey: string;
  /** Bar label. Defaults to the flag's `label`, then its `key`. */
  label?: string;
  /**
   * A short glyph rendered before the label. Text, not an asset — deliberately
   * still `string`.
   *
   * Copied into the snapshot as {@link FlagView.promotedIcon}, and a snapshot
   * holds plain data: a `ReactNode` is a plain object, so the comparator walks
   * it — through `_owner` into a cyclic fiber in development, which exhausts the
   * stack — and it would leak a React element into what `diagnostics()`
   * serialises. Rich icons go on
   * {@link PromotedFlag.presentation} instead, which stays in the factory
   * closure and never reaches the store
   * (`docs/adr/ADR-004-per-extension-bar-presentation.md`).
   */
  icon?: string;
  /** ISO date. Before it, the flag is not promoted. */
  startAt?: string;
  /** ISO date. After it, the flag is not promoted. */
  expiresAt?: string;
  /** Promoted only for an actor in one of these. Empty/omitted means everybody. */
  audience?: readonly string[];
  /**
   * How *this* promoted control presents itself: a preset, your own icon, a
   * render callback and an accessible-name override. A bare preset is the
   * shorthand — `presentation: "icon"`. Lives here, next to the control,
   * rather than on `flags()` (which has its own `presentation` for the chip).
   *
   * Under `"default"`, a bare `icon` here is not a no-op like it is on the
   * chip: `presentation.icon` fills the same glyph slot {@link
   * PromotedFlag.icon} always has, as the upgrade path off that string field.
   *
   * Held in the factory closure; never copied into a snapshot (unlike `label`
   * and `icon`, which are — plus this entry's position, as
   * {@link FlagView.promotedIndex}, which is how the bar knows which entry's
   * presentation to use).
   */
  presentation?: CompactPresentationInput<FlagView>;
}

/** Chip/dot colour. Same vocabulary and tokens `/ext/metrics` and `/ext/environment` use. */
export type FlagSeverity = SeverityWithOverride;

/** One row, fully derived and already redacted. Shared by the panel and the clipboard. */
export interface FlagView {
  key: string;
  label: string;
  description?: string;
  owner?: string;
  type: FlagType;
  /**
   * The raw variant values, for committing an override. Not a display surface —
   * render {@link FlagView.variantTexts} instead, and address a variant by its
   * index into this array.
   */
  variants?: readonly FlagValue[];
  /**
   * Display strings for {@link FlagView.variants}, same length and order, each
   * already through the same redaction the value rows get. A variant that masks
   * reads `variant N (masked)` so the options stay tellable apart.
   */
  variantTexts?: readonly string[];
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
   * consumer's catalogue no longer does (a renamed or deleted flag). The
   * override still applies on every mount, so orphans stay rendered, counted
   * and clearable rather than becoming invisible and stuck.
   */
  orphaned: boolean;
  /** Set when this key's own `onOverride` call threw. Cleared by its own success. */
  applyError?: string;
  /** True when the flag is promoted into the bar right now. */
  promoted: boolean;
  /**
   * Which entry of the `promoted` option is the one in force, as an index
   * into that array. Set exactly when {@link FlagView.promoted} is true.
   *
   * Two entries can name the same key with different windows, so "which
   * entry won" isn't answerable from the key alone — this tells the UI which
   * one to pull {@link PromotedFlag.presentation} from. A number is plain
   * snapshot data; the presentation itself never enters a snapshot.
   */
  promotedIndex?: number;
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
  /** False when neither `onOverride` nor `onOverridesChange` was supplied — the panel is read-only. */
  writable: boolean;
  /**
   * Keys whose override is waiting on a reload/route refresh. Cleared by
   * `acknowledgeReload()` or by the reload itself.
   */
  reloadPending: readonly string[];
  /**
   * Per key, the last failure from the consumer's adapter, cleared only by that
   * key's own success — a shared single slot would let an unrelated key's
   * success erase a still-failing row's error banner.
   */
  adapterErrors: Readonly<Record<string, string>>;
  /**
   * Set when the last `onOverridesChange` call threw — the app may be running a
   * stale map. Cleared by the next call that returns; independent of `adapterErrors`.
   */
  bulkError: string | null;
  /** Set when the flag list itself could not be read. Distinct from an adapter failure. */
  readError: string | null;
  /**
   * Set when a kill-switch load cleared the override map, naming how many.
   * `null` until that happens.
   */
  notice: string | null;
}

/* Small pure helpers, shared by the runtime and the UI. */

export function inferType(reading: FeatureFlagDefinition & { value?: FlagValue }): FlagType {
  if (reading.type) return reading.type;
  if (reading.variants && reading.variants.length > 0) return "variant";
  const probe = reading.value !== undefined ? reading.value : reading.defaultValue;
  if (typeof probe === "boolean") return "boolean";
  if (typeof probe === "number") return "number";
  return "string";
}

/** One value as one line. `null` is spelled out — it is a value, not an absence. */
export function formatValue(value: FlagValue | undefined): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/**
 * Parses what an editor holds back into the flag's own type, or `undefined`
 * when it isn't a valid value of that type.
 *
 * `undefined` rather than a fallback on purpose: coercing `"abc"` to `0` would
 * silently override the flag to zero and apply it to the running application.
 * A refused edit is recoverable; a wrong one that looks deliberate is not.
 */
export function parseValue(type: FlagType, raw: string): FlagValue | undefined {
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

/** Matches key, label, description and owner. */
export function matchesQuery(view: FlagView, query: string): boolean {
  return matchesKitQuery([view.key, view.label, view.description, view.owner], query);
}

/** Severity for a row: an active override outranks everything else. */
export function severityFor(view: FlagView): FlagSeverity {
  // An override the app never received is loudest: row says "overridden", app disagrees.
  if (view.applyError !== undefined) return "bad";
  // Checked before `overridden` (which orphans always are too): a stale
  // override with no matching flag is cleanup, not a deliberate override, and
  // grading it the same accent as a live one would hide that difference.
  if (view.orphaned || view.expired) return "warn";
  if (view.overridden) return "override";
  return "unknown";
}
