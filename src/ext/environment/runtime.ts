/**
 * Everything `/ext/environment` owns that is not React.
 * [dev-toolbar/ext/environment]
 *
 * Built by `environment()`, not by `start(api)`: slot functions run during the
 * toolbar's first render, which is before any effect fires, so the store a chip
 * reads has to exist by the time the factory returns.
 *
 * The redaction pass is the reason this file is bigger than the panel it feeds.
 * Session context is the most sensitive thing this toolbar will ever put on a
 * screen, and it arrives as an opaque bag from the consumer, so **every value
 * goes through `redact()` once, on the way in**, and the panel and the clipboard
 * read the same redacted snapshot. There is no path from raw context to output
 * that skips it — the raw bag is never stored on the snapshot at all.
 */
import { createThrottledStore, redact } from "../../runtime";
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

export type EnvironmentContextInput =
  | EnvironmentContext
  | (() => EnvironmentContext);

export interface EnvironmentRuntimeOptions {
  context?: EnvironmentContextInput;
  /** Re-read a function `context` this often, in ms. Default `4000`. */
  pollMs?: number;
  /**
   * Restrict the panel to these fields. Everything else is dropped outright —
   * never rendered, never copied. `extra` entries are named `extra:<key>`, and
   * they are subject to the allowlist like everything else.
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

/* -------------------------------------------------------------------------- */
/* Detection — the browser's own answers, never the deployment's.              */
/* -------------------------------------------------------------------------- */

interface ConnectionLike {
  effectiveType?: string;
  downlink?: number;
  saveData?: boolean;
}

/**
 * The route, with its query redacted rather than dropped. An OAuth implicit
 * callback puts `access_token=…` in the address bar, and this row is headed for
 * a clipboard; `redact()` masks URL-shaped values, which is why the whole href
 * goes through it below rather than being sliced up here.
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
  const connection = (
    navigator as unknown as { connection?: ConnectionLike }
  ).connection;
  if (!connection?.effectiveType) return online;
  const parts = [online, connection.effectiveType];
  if (typeof connection.downlink === "number") {
    parts.push(`${connection.downlink} Mb/s`);
  }
  if (connection.saveData) parts.push("save-data");
  return parts.join(" · ");
}

/* -------------------------------------------------------------------------- */
/* Redaction                                                                   */
/* -------------------------------------------------------------------------- */

// Deliberately loose on the local part and strict on the domain: this runs on
// values the consumer chose, and over-masking a row is recoverable while
// leaking somebody's address into a pasted ticket is not.
const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

export function maskEmails(value: string): string {
  return value.replace(EMAIL, (_match, first: string, domain: string) =>
    `${first}***@${domain}`,
  );
}

/**
 * Renders one value as the single line a row shows. Structured values become
 * JSON — but only *after* `redact()` has walked them, never before: see below.
 */
function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  // `redact()` renders a Date as a bare ISO string. Matching that here keeps
  // the two sides of the `masked` comparison comparable; JSON-quoting one side
  // and not the other made every Date look like it had been masked.
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      // A cycle. `redact()` already turns those into "[circular]", so this is
      // the raw side of the comparison only. It is *not* a guard against a
      // throwing getter: `redact()` walks with `Object.entries`, which invokes
      // getters, and it has already run by the time we get here. That case is
      // caught around the whole snapshot build instead — see `build`.
      return "[unserialisable]";
    }
  }
  return String(value);
}

/**
 * One pass over the whole bag. `redact()` does the key matching (`token`,
 * `session`, `cookie`, …) and the value matching (`Bearer …`, bare JWTs, URLs
 * with credential-shaped query parameters); the PII pass then masks email
 * addresses, which `redact()` has no opinion about.
 *
 * **Order matters, and getting it wrong is silent.** `redact()` matches key
 * names by walking an object graph, so a nested value must reach it as an
 * object. An earlier version of this function stringified `extra` entries first
 * and handed `redact()` a JSON string: the inner keys were then just characters
 * inside a value, `extra: { user: { authToken } }` leaked the token verbatim to
 * the panel and the clipboard, and — worse — the row still reported
 * `masked: true` because a sibling email had been masked by the PII pass. The
 * UI reassured the reader while leaking. Redact first, stringify second.
 */
function redactValues(
  raw: Record<string, unknown>,
  options: EnvironmentRuntimeOptions,
): { values: Record<string, string>; masked: Set<string> } {
  const redacted = redact(raw, options.redactOptions) as Record<
    string,
    unknown
  >;
  const values: Record<string, string> = {};
  const masked = new Set<string>();

  for (const [key, original] of Object.entries(raw)) {
    if (original === undefined || original === null) continue;
    // Both sides are rendered the same way, so `masked` reports whether
    // redaction changed *what this row shows* — not an artefact of formatting.
    const before = stringify(original);
    let after = stringify(redacted[key]);
    if (options.maskPii !== false) after = maskEmails(after);
    values[key] = after;
    if (after !== before) masked.add(key);
  }
  return { values, masked };
}

/* -------------------------------------------------------------------------- */
/* Snapshot                                                                    */
/* -------------------------------------------------------------------------- */

function formatBuiltAt(value: string | number | Date | undefined): string | undefined {
  if (value === undefined) return undefined;
  const date =
    value instanceof Date
      ? value
      : new Date(typeof value === "number" ? value : String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function formatImpersonation(
  value: boolean | ImpersonationContext | undefined,
): { display: string | undefined; active: boolean } {
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

export function createEnvironmentRuntime(
  options: EnvironmentRuntimeOptions = {},
): EnvironmentRuntime {
  const { context, pollMs = 4000, fields, detect = true } = options;
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
        console.error(
          "[dev-toolbar/ext/environment] the supplied context getter threw.",
          error,
        );
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

    // Extras are redacted in their own pass, keyed by the consumer's own key:
    // `redact()` matches on key names, so `extra: { authToken }` only masks if
    // the key reaches it unrenamed — and keeping them out of `raw` means an
    // extra called `region` cannot shadow the real field. Values are passed
    // through *as they are*, objects included, because `redact()` has to walk
    // them; `redactValues` stringifies afterwards.
    const rawExtra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(ctx.extra ?? {})) {
      if (value === undefined) continue;
      // The allowlist is an allowlist: an extra nobody asked for is dropped
      // here, before it is redacted, rendered or copied — the same
      // drop-don't-hide rule the declared fields get.
      if (allowed && !allowed.has(`extra:${key}`)) continue;
      rawExtra[key] = value;
    }

    const { values, masked } = redactValues(raw, options);
    const extra = redactValues(rawExtra, options);
    const detected = new Set(["route", "viewport", "connection"]);

    // The *redacted* environment string, not `ctx.environment`. The chip, its
    // title, `data-dtb-env` and `diagnostics().environment` all read this, and
    // a consumer who puts a value with an address in it here should not find it
    // masked in one row and raw in four other places.
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
        source: present
          ? detected.has(spec.id)
            ? "detected"
            : "supplied"
          : "missing",
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

    revision += 1;
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
   * The snapshot is built from data the consumer owns, and reading it can
   * throw: a getter on the context object, or a getter nested inside `extra`,
   * which `redact()` invokes when it walks the graph with `Object.entries`.
   *
   * Nothing here may propagate. The first `build()` runs inside `environment()`
   * — at factory time, before core has mounted anything — so a throw there does
   * not degrade to an error chip, it takes down the host application's render.
   * That inverts the whole failure-isolation rule the shell is built on. The
   * later ones run inside a `setInterval`, where a throw is uncatchable by
   * anybody. So: log once per occurrence and degrade to a snapshot that says
   * what happened, the same way `readContext` already handles a throwing getter
   * context.
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
    revision += 1;
    return {
      revision,
      at: now(),
      kind: "unknown",
      severity: "unknown",
      impersonating: false,
      supplied: true,
      maskedCount: 0,
      fields: [
        // Not consumer data, so the `fields` allowlist does not apply: a
        // restricted view still needs to be told why it is empty.
        {
          id: "contextError",
          label: "Context",
          group: "session",
          value: "could not be read — it threw. See the console.",
          source: "supplied",
          masked: false,
          alarming: true,
        },
        ...FIELD_SPECS.filter((spec) => !allowed || allowed.has(spec.id)).map(
          (spec) => ({
            id: spec.id,
            label: spec.label,
            group: spec.group,
            value: "",
            source: "missing" as const,
            masked: false,
          }),
        ),
      ],
    };
  };

  const signature = (snapshot: EnvironmentSnapshot): string =>
    snapshot.fields.map((field) => `${field.id}=${field.value}`).join("|");

  const store = createThrottledStore<EnvironmentSnapshot>(build(), {
    intervalMs: 250,
    equals: (a, b) => signature(a) === signature(b),
  });

  const publish = () => store.set(build());

  return {
    store,
    storage: () => storage,
    refresh: publish,

    start(api: ExtensionRuntimeApi) {
      storage = api.storage;

      // Two things go stale: a getter context, and the detected facts. The
      // route is the reason the second one counts — every SPA router navigates
      // with `history.pushState`, which fires no event anyone can listen for,
      // so with a static context and no timer the Route row would be wrong
      // until something else happened to repaint it, i.e. possibly forever.
      const timer =
        typeof context === "function" || detect
          ? setInterval(publish, Math.max(250, pollMs))
          : null;

      const onChange = () => publish();
      const target = typeof window === "undefined" ? null : window;
      target?.addEventListener("online", onChange);
      target?.addEventListener("offline", onChange);
      target?.addEventListener("resize", onChange);
      // The route changes without a navigation in every SPA router, so listen
      // for what the platform does emit and re-read on the poll otherwise.
      target?.addEventListener("popstate", onChange);
      target?.addEventListener("hashchange", onChange);

      const stopWatching = api.subscribeVisibility(() => publish());
      publish();

      // The store belongs to the runtime, not to one start/stop cycle: React
      // StrictMode runs mount → cleanup → mount, and destroying it on the first
      // cleanup drops React's subscription and freezes the panel.
      const dispose = () => {
        if (timer !== null) clearInterval(timer);
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
        supplied: snapshot.supplied,
        impersonating: snapshot.impersonating,
        maskedCount: snapshot.maskedCount,
        fields: snapshot.fields
          .filter((field) => field.source !== "missing")
          .map((field) => ({
            id: field.id,
            label: field.label,
            source: field.source,
            masked: field.masked,
            value: field.value,
          })),
      };
      // Values are already redacted; this second pass costs nothing and means
      // the dump is safe even if a field is added above and this is forgotten.
      return redact(payload, options.redactOptions);
    },
  };
}
