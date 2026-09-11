/**
 * Everything `/ext/environment` owns that is not React.
 * [dev-toolbar/ext/environment]
 *
 * Built by `environment()`, not `start(api)`: slot functions run before any
 * effect fires, so the store a chip reads must exist when the factory returns.
 *
 * Every value goes through `redact()` once, on the way in — the panel and
 * clipboard read the same redacted snapshot, and the raw bag is never stored.
 */
import { createDerivedStore, redact, redactUrl } from "../../runtime";
import { createPoller, isReadable, readInput } from "@nejcm/dev-toolbar/kit";
import type { Input } from "@nejcm/dev-toolbar/kit";
import type { RedactOptions, ThrottledStore } from "../../runtime";
import type { ExtensionRuntimeApi, ToolbarStorage } from "../../core/contract";
import { FIELD_SPECS, normaliseKind, severityForKind } from "./types";
import type {
  EnvironmentContext,
  EnvironmentFieldId,
  EnvironmentFieldView,
  EnvironmentSnapshot,
  ImpersonationContext,
} from "./types";

/**
 * The context as an object, a getter (re-read every `pollMs`), or a `Readable`
 * / `{ getState, subscribe }` store (re-read when it notifies). See
 * `createSource` and `useSource` in `@nejcm/dev-toolbar/kit`.
 */
export type EnvironmentContextInput = Input<EnvironmentContext>;

export interface EnvironmentRuntimeOptions {
  context?: EnvironmentContextInput;
  /**
   * Re-read a function `context` this often, in ms. Default `4000`. A
   * `Readable` context is not polled for its own sake — it notifies — but the
   * same timer still runs while `detect` is on, for the route.
   */
  pollMs?: number;
  /**
   * Restrict the panel to these fields (allowlist) — everything else is
   * dropped outright, never rendered or copied. `extra` entries are named
   * `extra:<key>` and follow the same allowlist.
   */
  fields?: readonly (EnvironmentFieldId | `extra:${string}`)[];
  /** Read route/viewport/connection from the browser. Default `true`. */
  detect?: boolean;
  /** Mask email-shaped values everywhere. Default `true`. */
  maskPii?: boolean;
  /** Merged into every `redact()` call — `extraKeys` is the usual reason. */
  redactOptions?: RedactOptions;
}

export interface EnvironmentRuntime {
  readonly store: ThrottledStore<EnvironmentSnapshot>;
  /**
   * `null` until `start(api)` runs.
   *
   * @deprecated Nothing in the package reads it any more: every persisted
   * preference goes through `readPreference`/`writePreference` from
   * `@nejcm/dev-toolbar/kit`, which guard the adapter for you. Use those with
   * `api.storage` instead. Removal is a published-API change and waits for the
   * next major.
   */
  storage(): ToolbarStorage | null;
  start(api: ExtensionRuntimeApi): () => void;
  /** Re-read the context and publish. */
  refresh(): void;
  /** §3B's copyable block, built from the redacted snapshot. */
  snapshotText(): string;
  /** JSON-safe, redacted. Same source as the text form. */
  diagnostics(): unknown;
}

const now = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

// Detection — the browser's own answers, never the deployment's.

interface ConnectionLike {
  effectiveType?: string;
  downlink?: number;
  saveData?: boolean;
}

/**
 * The route, query included — an OAuth implicit callback puts `access_token=…`
 * in the address bar, and this row is headed for a clipboard.
 *
 * This is a relative reference, so `redact()`'s own URL pass (absolute URLs
 * only) never sees it; the `url: true` fields get an explicit `redactUrl()`
 * pass instead, in `redactValues`. The raw value is kept here deliberately —
 * `masked` is derived by diffing raw against redacted, so pre-redacting would
 * close the leak while reporting `masked: false`.
 */
function detectRoute(): string | undefined {
  if (typeof location === "undefined") return undefined;
  const { pathname, search, hash } = location;
  return `${pathname}${search}${hash}`;
}

function detectViewport(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const { innerWidth, innerHeight, devicePixelRatio } = window;
  if (!Number.isFinite(innerWidth) || !Number.isFinite(innerHeight)) {
    return undefined;
  }
  const dpr = Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
  return `${Math.round(innerWidth)}×${Math.round(innerHeight)} @${dpr}x`;
}

function detectConnection(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  const online = navigator.onLine === false ? "offline" : "online";
  const connection = (navigator as unknown as { connection?: ConnectionLike }).connection;
  if (!connection?.effectiveType) return online;
  const parts = [online, connection.effectiveType];
  if (typeof connection.downlink === "number") {
    parts.push(`${connection.downlink} Mb/s`);
  }
  if (connection.saveData) parts.push("save-data");
  return parts.join(" · ");
}

// Redaction

/**
 * Loose on the local part, strict on the domain: over-masking is recoverable,
 * leaking an address is not.
 *
 * `%40` is accepted alongside `@` because this runs after `redactUrl()`,
 * which re-serialises the whole query when it masks anything — form-encoding
 * every other parameter's `@` as `%40`. Whichever separator matched is
 * preserved rather than normalised, so the output still reflects what the URL
 * pass produced. (A side effect: an address-shaped parameter *key* gets
 * masked too once the URL pass re-encodes it — cosmetic, since the value it
 * guards is already `[redacted]`.)
 *
 * Every quantifier is bounded (local part ≤128, ≤63 labels) rather than one
 * unbounded run: the unbounded form was quadratic on a long separator-less
 * string, and `detectRoute()` feeds this an unbounded URL fragment on every
 * snapshot — a shared link could stall the main thread. The bounds are looser
 * than RFC 5321, so every address the unbounded pattern matched still matches.
 */
const EMAIL =
  /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{0,127}(@|%40)((?:[A-Za-z0-9-]{0,63}\.){1,63}[A-Za-z]{2,24})/g;

export function maskEmails(value: string): string {
  return value.replace(
    EMAIL,
    (_match, first: string, at: string, domain: string) => `${first}***${at}${domain}`,
  );
}

/**
 * Renders one value as the single line a row shows. Structured values become
 * JSON — but only *after* `redact()` has walked them, never before.
 */
function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  // Matches `redact()`'s Date rendering so both sides of the `masked`
  // comparison stay comparable; guards `toISOString()` throwing on an invalid Date.
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "[invalid date]" : value.toISOString();
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return "[unserialisable]";
    }
  }
  return String(value);
}

/** The declared fields `FIELD_SPECS` marks as holding a URL reference. */
const URL_FIELDS: ReadonlySet<string> = new Set(
  FIELD_SPECS.filter((spec) => spec.url).map((spec) => spec.id),
);

/**
 * One pass over the whole bag: `redact()` does key/value matching, an explicit
 * `redactUrl()` pass then covers URL *references* `redact()`'s value pass
 * can't see (relative URLs), and `maskEmails()` finally masks addresses.
 *
 * Order matters and getting it wrong is silent:
 * 1. `redact()` runs on the raw object, not a stringified one — stringifying
 *    `extra` first would hide its inner keys from key matching.
 * 2. `redactUrl()` runs before `maskEmails()`: `EMAIL` can match a *key*
 *    containing an address (`?token@x.co=secret`), and masking it first would
 *    leave nothing for `redact()`'s key matching to recognise, leaking the
 *    secret. Consequence: `maskEmails()` must tolerate `%40`, since masking
 *    any URL parameter re-serialises the query and form-encodes every other
 *    `@`. The two orders don't converge — each leaks something the other
 *    catches.
 * 3. Only the *after* side is URL-redacted; `raw` stays untouched, because
 *    `masked` is derived by diffing raw against redacted — redacting both
 *    sides would make them equal and report `masked: false` on a row that was
 *    actually rewritten.
 *
 * Known gaps, deliberately not closed: a hash-router fragment with no `?`
 * over-masks the whole fragment (safe, ugly); a credential in a path segment
 * has no key for either pass to match and survives; a URL nested inside an
 * object-valued `extra` entry isn't covered by `redactUrl()` at all.
 */
function redactValues(
  raw: Record<string, unknown>,
  options: EnvironmentRuntimeOptions,
  /**
   * `"fields"` URL-redacts only `FIELD_SPECS` entries marked `url: true`.
   * `"extras"` URL-redacts every string-valued entry — free coverage for
   * consumer keys like `callbackUrl` this module can't enumerate, since
   * `redactUrl()` returns a non-URL string unchanged.
   */
  scope: "fields" | "extras",
): { values: Record<string, string>; masked: Set<string> } {
  const redacted = redact(raw, options.redactOptions) as Record<string, unknown>;
  const values: Record<string, string> = {};
  const masked = new Set<string>();

  for (const [key, original] of Object.entries(raw)) {
    if (original === undefined || original === null) continue;
    // `before` stays raw on purpose — see (3) above.
    const before = stringify(original);
    let after = stringify(redacted[key]);
    const urlShaped = scope === "extras" ? typeof original === "string" : URL_FIELDS.has(key);
    if (urlShaped) after = redactUrl(after, options.redactOptions);
    if (options.maskPii !== false) after = maskEmails(after);
    values[key] = after;
    if (after !== before) masked.add(key);
  }
  return { values, masked };
}

// Snapshot

function formatBuiltAt(value: string | number | Date | undefined): string | undefined {
  if (value === undefined) return undefined;
  const date =
    value instanceof Date ? value : new Date(typeof value === "number" ? value : String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function formatImpersonation(value: boolean | ImpersonationContext | undefined): {
  display: string | undefined;
  active: boolean;
} {
  if (value === undefined) return { display: undefined, active: false };
  if (typeof value === "boolean") {
    return { display: value ? "ACTIVE" : "no", active: value };
  }
  const { actor, subject } = value;
  const who = [actor, subject].filter(Boolean).join(" → ");
  return { display: who === "" ? "ACTIVE" : `ACTIVE — ${who}`, active: true };
}

function hasAnything(context: EnvironmentContext): boolean {
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue;
    if (key === "extra" && Object.keys(value as object).length === 0) continue;
    return true;
  }
  return false;
}

const DEFAULT_POLL_MS = 4000;

export function createEnvironmentRuntime(
  options: EnvironmentRuntimeOptions = {},
): EnvironmentRuntime {
  const { context, pollMs = DEFAULT_POLL_MS, fields, detect = true } = options;
  const allowed = fields === undefined ? null : new Set<string>(fields);

  let storage: ToolbarStorage | null = null;

  const readContext = (): EnvironmentContext => {
    try {
      return readInput(context) ?? {};
    } catch (error) {
      // A consumer's getter (or `read()`) throwing must not take down the bar:
      // the slot is inside an error boundary, but start()'s interval and a
      // store's notification are not.
      // eslint-disable-next-line no-console
      console.error("[dev-toolbar/ext/environment] the supplied context getter threw.", error);
      return {};
    }
  };

  const buildSnapshot = (revision: number): EnvironmentSnapshot => {
    const ctx = readContext();
    const impersonation = formatImpersonation(ctx.impersonating);

    const raw: Record<string, unknown> = {
      environment: ctx.environment,
      release: ctx.release,
      commit: ctx.commit,
      branch: ctx.branch,
      deployment: ctx.deployment,
      region: ctx.region,
      apiEndpoint: ctx.apiEndpoint,
      builtAt: formatBuiltAt(ctx.builtAt),
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      internal: ctx.internal === undefined ? undefined : ctx.internal ? "yes" : "no",
      impersonation: impersonation.display,
      roles: ctx.roles === undefined ? undefined : ctx.roles.join(", "),
      sync: ctx.syncStatus,
      // Checked here, not only when the row is built, so an excluded route is
      // never collected at all (a shared link controls this value).
      route: detect && (!allowed || allowed.has("route")) ? detectRoute() : undefined,
      viewport: detect ? detectViewport() : undefined,
      connection: detect ? detectConnection() : undefined,
    };

    // Kept out of `raw` so an extra called `region` can't shadow the real field.
    const rawExtra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(ctx.extra ?? {})) {
      if (value === undefined) continue;
      if (allowed && !allowed.has(`extra:${key}`)) continue;
      rawExtra[key] = value;
    }

    const { values, masked } = redactValues(raw, options, "fields");
    const extra = redactValues(rawExtra, options, "extras");
    const detected = new Set(["route", "viewport", "connection"]);

    // The redacted string, not `ctx.environment` — multiple call sites read
    // this one value, so it can't be masked in one place and raw in another.
    const kind = values["environment"] ?? "unknown";
    const isProduction = normaliseKind(String(kind)) === "production";

    const fieldViews: EnvironmentFieldView[] = [];
    for (const spec of FIELD_SPECS) {
      if (allowed && !allowed.has(spec.id)) continue;
      const value = values[spec.id];
      const present = value !== undefined && value !== "";
      fieldViews.push({
        id: spec.id,
        label: spec.label,
        group: spec.group,
        value: present ? value : "",
        source: present ? (detected.has(spec.id) ? "detected" : "supplied") : "missing",
        masked: masked.has(spec.id),
        alarming:
          (spec.id === "impersonation" && impersonation.active) ||
          (spec.id === "environment" && isProduction),
      });
    }

    for (const key of Object.keys(rawExtra)) {
      fieldViews.push({
        id: `extra:${key}`,
        label: key,
        group: "session",
        value: extra.values[key] ?? "",
        source: "supplied",
        masked: extra.masked.has(key),
      });
    }

    return {
      revision,
      at: now(),
      kind,
      severity: severityForKind(String(kind), impersonation.active),
      impersonating: impersonation.active,
      supplied: hasAnything(ctx),
      maskedCount: fieldViews.filter((field) => field.masked).length,
      fields: fieldViews,
    };
  };

  /**
   * Guards the direct reads above against a throwing getter — those happen
   * before `redact()` runs, which only tags getters *inside* a walked value.
   * Nothing here may propagate: the first call runs at factory time, before
   * core has mounted anything, and later calls run inside a `setInterval`
   * where a throw is uncatchable by anybody.
   */
  const build = (revision: number): EnvironmentSnapshot => {
    try {
      return buildSnapshot(revision);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        "[dev-toolbar/ext/environment] reading the supplied context threw. " +
          "Showing an empty snapshot; a getter on the context object or inside " +
          "`extra` is the usual cause.",
        error,
      );
      return failedSnapshot(revision);
    }
  };

  /** What the panel shows when the context could not be read at all. */
  const failedSnapshot = (revision: number): EnvironmentSnapshot => {
    return {
      revision,
      at: now(),
      kind: "unknown",
      severity: "unknown",
      impersonating: false,
      supplied: true,
      maskedCount: 0,
      fields: [
        // Not consumer data, so the `fields` allowlist doesn't apply here.
        {
          id: "contextError",
          label: "Context",
          group: "session",
          value: "could not be read — it threw. See the console.",
          source: "supplied",
          masked: false,
          alarming: true,
        },
        ...FIELD_SPECS.filter((spec) => !allowed || allowed.has(spec.id)).map((spec) => ({
          id: spec.id,
          label: spec.label,
          group: spec.group,
          value: "",
          source: "missing" as const,
          masked: false,
        })),
      ],
    };
  };

  const signature = (snapshot: EnvironmentSnapshot): string =>
    snapshot.fields.map((field) => `${field.id}=${field.value}`).join("|");

  const store = createDerivedStore<EnvironmentSnapshot>(build, {
    intervalMs: 250,
    signature,
  });

  const publish = store.rebuild;

  return {
    store,
    storage: () => storage,
    refresh: publish,

    start(api: ExtensionRuntimeApi) {
      storage = api.storage;

      // The route matters most: SPA routers navigate via `history.pushState`,
      // which fires no listenable event, so without this timer the Route row
      // could be wrong indefinitely. A `Readable` context needs no timer of its own.
      const live = isReadable(context);
      const stopListening = live ? context.subscribe(() => publish()) : () => {};
      const stopPolling =
        (typeof context === "function" && !live) || detect
          ? createPoller(publish, {
              intervalMs: pollMs,
              fallbackMs: DEFAULT_POLL_MS,
              signal: api.signal,
            })
          : () => {};

      const onChange = () => publish();
      const target = typeof window === "undefined" ? null : window;
      target?.addEventListener("online", onChange);
      target?.addEventListener("offline", onChange);
      target?.addEventListener("resize", onChange);
      target?.addEventListener("popstate", onChange);
      target?.addEventListener("hashchange", onChange);

      const stopWatching = api.subscribeVisibility(() => publish());
      publish();

      // The store outlives one start/stop cycle: destroying it on React
      // StrictMode's first cleanup would drop the subscription and freeze the panel.
      let disposed = false;
      const dispose = () => {
        // Idempotent: core aborts the signal and then calls the returned cleanup.
        if (disposed) return;
        disposed = true;
        stopPolling();
        target?.removeEventListener("online", onChange);
        target?.removeEventListener("offline", onChange);
        target?.removeEventListener("resize", onChange);
        target?.removeEventListener("popstate", onChange);
        target?.removeEventListener("hashchange", onChange);
        stopWatching();
        try {
          stopListening();
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(
            "[dev-toolbar/ext/environment] the supplied context's unsubscribe threw.",
            error,
          );
        }
      };
      api.signal.addEventListener("abort", dispose, { once: true });
      return dispose;
    },

    snapshotText() {
      const snapshot = store.read();
      const lines: string[] = [];
      for (const field of snapshot.fields) {
        if (field.source === "missing") continue;
        lines.push(`${field.label}: ${field.value}`);
      }
      if (lines.length === 0) {
        return "Environment: unknown — no context was supplied to environment().";
      }
      if (snapshot.maskedCount > 0) {
        lines.push(
          `(${snapshot.maskedCount} value${snapshot.maskedCount === 1 ? "" : "s"} masked before copying)`,
        );
      }
      return lines.join("\n");
    },

    diagnostics() {
      const snapshot = store.read();
      const payload: Record<string, unknown> = {
        generatedAt: new Date().toISOString(),
        environment: snapshot.kind,
        severity: snapshot.severity,
        supplied: snapshot.supplied,
        impersonating: snapshot.impersonating,
        maskedCount: snapshot.maskedCount,
        fields: snapshot.fields
          .filter((field) => field.source !== "missing")
          .map((field) => ({
            id: field.id,
            label: field.label,
            group: field.group,
            source: field.source,
            masked: field.masked,
            markers: [
              ...(field.masked ? ["masked"] : []),
              ...(field.source === "detected" ? ["detected"] : []),
              ...(field.alarming === true ? ["alarming"] : []),
            ],
            value: field.value,
          })),
      };
      // Second pass: protects fields added here without a matching redaction above.
      return redact(payload, options.redactOptions);
    },
  };
}
