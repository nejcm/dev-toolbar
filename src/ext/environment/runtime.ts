/**
 * Everything `/ext/environment` owns that is not React.
 * [dev-toolbar/ext/environment]
 *
 * Built by `environment()`, not `start(api)`: slot functions run before any
 * effect fires, so the store a chip reads must exist when the factory returns.
 *
 * Session context is the most sensitive thing this toolbar puts on a screen, so
 * **every value goes through `redact()` once, on the way in** — the panel and
 * clipboard read the same redacted snapshot, and the raw bag is never stored.
 */
import { createThrottledStore, redact, redactUrl } from "../../runtime";
import { createPoller } from "@nejcm/dev-toolbar/kit";
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

export type EnvironmentContextInput = EnvironmentContext | (() => EnvironmentContext);

export interface EnvironmentRuntimeOptions {
  context?: EnvironmentContextInput;
  /** Re-read a function `context` this often, in ms. Default `4000`. */
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
  /** `null` until `start(api)` runs. */
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
 * The route, query included (not dropped) — an OAuth implicit callback puts
 * `access_token=…` in the address bar, and this row is headed for a clipboard.
 *
 * This is a *relative* reference, so it does **not** go through `redact()`'s
 * URL pass: that pass only fires on absolute URLs (`scheme://…`). What covers
 * it is the explicit `redactUrl()` pass `redactValues` runs for the fields
 * `FIELD_SPECS` marks `url: true`. The raw, unredacted value is deliberately
 * kept in `raw` — `redactValues` derives `masked` by comparing the raw render
 * against the redacted one, so pre-redacting here would close the leak while
 * reporting `masked: false`, i.e. telling the reader nothing was hidden.
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
 * leaking an address into a pasted ticket is not.
 *
 * `%40` is accepted alongside a literal `@` because this pass runs *after*
 * `redactUrl()`, and `maskUrl()` does not rewrite only the component it
 * matched: masking anything re-serialises the whole query (and fragment)
 * through `URLSearchParams.toString()`, which form-encodes every `@` in every
 * *other* parameter as `%40`. So `?access_token=abc&login_hint=a@b.io` reaches
 * here as `?access_token=[redacted]&login_hint=a%40b.io`, and an `@`-only
 * pattern walks straight past the address. Whichever separator matched is
 * preserved in the output rather than normalised, so the rendered value still
 * reflects what the URL pass actually produced.
 *
 * A side effect: an address-shaped *parameter key* (`?token@x.co=`) gets masked
 * too, once the URL pass has re-encoded it. Cosmetic — the value it guards is
 * `[redacted]` by then — and over-masking is the recoverable direction.
 */
const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@|%40)([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

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
  // Match `redact()`'s bare-ISO-string rendering of Date so both sides of the
  // `masked` comparison stay comparable. `toISOString()` throws on an invalid
  // Date, and this runs on the raw (pre-redact) side, so guard it here too.
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "[invalid date]" : value.toISOString();
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      // A cycle, on the raw side only — `redact()` already renders cycles as
      // "[circular]" and throwing getters as "[getter threw]" on its own side.
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
 * One pass over the whole bag: `redact()` does key matching (`token`,
 * `session`, `cookie`, …) and value matching (`Bearer …`, bare JWTs,
 * credential-shaped URL query params); an explicit `redactUrl()` pass then
 * covers URL *references* `redact()`'s value pass cannot see; the PII pass
 * finally masks emails, which `redact()` has no opinion about.
 *
 * **Order matters, and getting it wrong is silent.** Three orderings are
 * load-bearing here:
 *
 * 1. `redact()` matches key names by walking an object graph, so nested values
 *    must reach it as objects, not as a pre-stringified blob — stringifying
 *    `extra` first would hide its inner keys inside a string, leaking values
 *    like `authToken` verbatim while a sibling email masked by the PII pass
 *    still made the row report `masked: true`. Redact first, stringify second.
 * 2. `redactUrl()` runs **before** `maskEmails()`, because its key matching
 *    must see the keys as supplied. `EMAIL` can match a *key* that contains an
 *    address (`?token@x.co=secret`), and rewriting it to `t***@x.co` first
 *    leaves nothing for `matches("token")` to recognise — the secret then
 *    leaks. Running the URL pass first also means userinfo is replaced
 *    wholesale (`//[redacted]:[redacted]@host`) rather than mangled to
 *    `//user:p***@host`, which is what no URL pass at all produced.
 *
 *    The consequence is that `maskEmails()` must tolerate `%40`: masking any
 *    one parameter re-serialises the entire query, form-encoding the `@` of
 *    every other one. `EMAIL` accepts both separators for exactly this reason —
 *    see its own comment. The two orders do **not** converge; each leaks
 *    something the other catches, and this is the pairing that leaks neither.
 * 3. Only the **after** side is URL-redacted; `raw` is left exactly as supplied.
 *    `masked` is derived by comparing the two renders, so redacting the raw side
 *    too would make them equal and report `masked: false` on a row that was in
 *    fact rewritten — worse than the leak, because the reader is told nothing
 *    was hidden.
 *
 * Known gaps, deliberately not closed here:
 *
 * - A hash-router route whose fragment carries credentials with no `?` to
 *   separate them (`/app#/settings/token=x`) over-masks the route itself to
 *   `/app#%2Fsettings%2Ftoken=[redacted]`, because `URLSearchParams` reads the
 *   whole fragment as one key. Safe, ugly. A fragment that does have a `?`
 *   keeps its path prefix verbatim.
 * - Credentials in a *path segment* (`/reset/eyJhbGciOi…`) have no key for
 *   either pass to match, so they survive. Only query/fragment params and
 *   userinfo are covered.
 * - A URL nested one level inside an `extra` object is only covered by
 *   `redact()`'s own value pass (absolute URLs), not by the pass below: the
 *   `redactUrl()` call applies to string-valued extras, not to strings found
 *   inside object-valued ones.
 */
function redactValues(
  raw: Record<string, unknown>,
  options: EnvironmentRuntimeOptions,
  /**
   * `"fields"` — URL-redact the `FIELD_SPECS` entries marked `url: true`.
   * `"extras"` — URL-redact every string-valued entry. `redactUrl()` returns a
   * non-URL string byte-for-byte, so this is free coverage for consumer keys
   * like `callbackUrl` or `wsEndpoint` that this module cannot enumerate.
   * Object-valued extras are skipped: `redact()`'s walk already key-matched
   * inside them, and their render is JSON, not a URL.
   */
  scope: "fields" | "extras",
): { values: Record<string, string>; masked: Set<string> } {
  const redacted = redact(raw, options.redactOptions) as Record<string, unknown>;
  const values: Record<string, string> = {};
  const masked = new Set<string>();

  for (const [key, original] of Object.entries(raw)) {
    if (original === undefined || original === null) continue;
    // Both sides rendered the same way, so `masked` reflects an actual change,
    // not a formatting artefact. `before` stays raw on purpose — see (3) above.
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

  let revision = 0;
  let storage: ToolbarStorage | null = null;

  const readContext = (): EnvironmentContext => {
    if (typeof context === "function") {
      try {
        return context() ?? {};
      } catch (error) {
        // A consumer's getter throwing must not take down the bar: the slot is
        // inside an error boundary, but start()'s interval is not.
        // eslint-disable-next-line no-console
        console.error("[dev-toolbar/ext/environment] the supplied context getter threw.", error);
        return {};
      }
    }
    return context ?? {};
  };

  const buildSnapshot = (): EnvironmentSnapshot => {
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
      route: detect ? detectRoute() : undefined,
      viewport: detect ? detectViewport() : undefined,
      connection: detect ? detectConnection() : undefined,
    };

    // Extras are redacted in their own pass, keyed unrenamed so `redact()`'s key
    // matching still applies, and kept out of `raw` so an extra called `region`
    // can't shadow the real field.
    const rawExtra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(ctx.extra ?? {})) {
      if (value === undefined) continue;
      // Dropped, not hidden, before redact/render/copy — same rule as declared fields.
      if (allowed && !allowed.has(`extra:${key}`)) continue;
      rawExtra[key] = value;
    }

    const { values, masked } = redactValues(raw, options, "fields");
    const extra = redactValues(rawExtra, options, "extras");
    const detected = new Set(["route", "viewport", "connection"]);

    // The *redacted* environment string, not `ctx.environment` — the chip,
    // its title, `data-dtb-env` and `diagnostics().environment` all read this
    // one value, so it can't be masked in one place and raw in another.
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
   * Guards the two direct reads above (`ctx.userId` etc., and the top-level
   * `Object.entries(ctx.extra ?? {})`) against a throwing getter — `redact()`
   * already tags getters it finds *inside* a walked value as `"[getter threw]"`,
   * but these two reads happen before `redact()` runs.
   *
   * Nothing here may propagate: the first `build()` runs at factory time inside
   * `environment()`, before core has mounted anything, so an uncaught throw would
   * take down the host app's render rather than degrade to an error chip. Later
   * calls run inside a `setInterval`, where a throw is uncatchable by anybody.
   * So: log once and degrade to a snapshot describing what happened.
   */
  const build = (): EnvironmentSnapshot => {
    try {
      return buildSnapshot();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        "[dev-toolbar/ext/environment] reading the supplied context threw. " +
          "Showing an empty snapshot; a getter on the context object or inside " +
          "`extra` is the usual cause.",
        error,
      );
      return failedSnapshot();
    }
  };

  /** What the panel shows when the context could not be read at all. */
  const failedSnapshot = (): EnvironmentSnapshot => {
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

  const store = createThrottledStore<EnvironmentSnapshot>(build(), {
    intervalMs: 250,
    equals: (a, b) => signature(a) === signature(b),
  });

  const publish = () => {
    revision += 1;
    store.set(build());
  };

  return {
    store,
    storage: () => storage,
    refresh: publish,

    start(api: ExtensionRuntimeApi) {
      storage = api.storage;

      // A getter context and the detected facts both go stale. The route matters
      // most: SPA routers navigate via `history.pushState`, which fires no
      // listenable event, so without this timer the Route row could be wrong
      // indefinitely.
      const stopPolling =
        typeof context === "function" || detect
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
      // Listen for what the platform does emit; the poll above covers the rest.
      target?.addEventListener("popstate", onChange);
      target?.addEventListener("hashchange", onChange);

      const stopWatching = api.subscribeVisibility(() => publish());
      publish();

      // Store belongs to the runtime, not one start/stop cycle: destroying it on
      // React StrictMode's first cleanup would drop the subscription and freeze the panel.
      const dispose = () => {
        stopPolling();
        target?.removeEventListener("online", onChange);
        target?.removeEventListener("offline", onChange);
        target?.removeEventListener("resize", onChange);
        target?.removeEventListener("popstate", onChange);
        target?.removeEventListener("hashchange", onChange);
        stopWatching();
      };
      api.signal.addEventListener("abort", dispose, { once: true });
      return dispose;
    },

    snapshotText() {
      const snapshot = build();
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
      const snapshot = build();
      const payload: Record<string, unknown> = {
        generatedAt: new Date().toISOString(),
        environment: snapshot.kind,
        severity: snapshot.severity,
        supplied: snapshot.supplied,
        impersonating: snapshot.impersonating,
        maskedCount: snapshot.maskedCount,
        /** Panel rows with masking applied and the panel's `data-dtb-tag` vocabulary. */
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
      // A second pass protects fields added here without a matching redaction.
      return redact(payload, options.redactOptions);
    },
  };
}
