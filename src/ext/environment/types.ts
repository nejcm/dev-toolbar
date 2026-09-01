/**
 * Shared vocabulary for `/ext/environment`. [dev-toolbar/ext/environment]
 *
 * Everything in `plans/dev-bar.md` §3B is **consumer-supplied**: core has no
 * `ctx`, no session and no build metadata, and this extension does not invent
 * one. It reads nothing from `process.env` and looks for no global. What it
 * knows, the consumer told it — plus a short list of facts the browser itself
 * can answer (route, viewport, connection), which are labelled `"detected"` so
 * they are never mistaken for something the deploy asserted.
 *
 * When nothing is supplied the answer is `"unknown"`, spelled out. Guessing the
 * environment from the hostname is exactly the wrong answer to "which
 * environment am I actually in".
 */

/** §3B's four, plus the two honest extras. Any other string is passed through. */
export type EnvironmentKind =
  | "local"
  | "development"
  | "test"
  | "preview"
  | "staging"
  | "production"
  | "unknown";

/** Chip/dot colour. Same vocabulary `/ext/metrics` uses, same `--dtb-*` tokens. */
export type EnvironmentSeverity = "unknown" | "ok" | "warn" | "bad";

export type EnvironmentGroup = "build" | "session" | "client";

export type EnvironmentFieldId =
  | "environment"
  | "release"
  | "commit"
  | "branch"
  | "deployment"
  | "region"
  | "apiEndpoint"
  | "builtAt"
  | "userId"
  | "workspaceId"
  | "internal"
  | "impersonation"
  | "roles"
  | "sync"
  | "route"
  | "viewport"
  | "connection";

/**
 * Who an impersonation is by and of. Either half may be omitted; supplying the
 * flag alone (`impersonating: true`) is enough to make the bar shout.
 */
export interface ImpersonationContext {
  actor?: string;
  subject?: string;
}

/**
 * What the consumer knows. Every field optional: an omitted field renders as
 * "not supplied", which is information, and a wrong guess is not.
 */
export interface EnvironmentContext {
  /** `"production"`, `"staging"`, … or any string of your own. */
  environment?: EnvironmentKind | (string & {});
  /** Release/version identifier, e.g. `"web-2026.08.28.4"`. */
  release?: string;
  /** Git SHA. Shown short, copied as given. */
  commit?: string;
  branch?: string;
  /** Preview deployment id. */
  deployment?: string;
  region?: string;
  /** Base URL of the API this build talks to. */
  apiEndpoint?: string;
  /** Build timestamp: ISO string, epoch ms, or a `Date`. */
  builtAt?: string | number | Date;
  userId?: string;
  workspaceId?: string;
  /** Employee / internal-user status. */
  internal?: boolean;
  /** `true`, or the actor/subject pair. Rendered unmistakably either way. */
  impersonating?: boolean | ImpersonationContext;
  /** Permissions or roles. */
  roles?: readonly string[];
  /** Sync/connection status, e.g. `"connected"`, `"offline"`. */
  syncStatus?: string;
  /** Anything else worth a row. Keys are matched by `redact()` like any other. */
  extra?: Record<string, unknown>;
}

export interface EnvironmentFieldView {
  /** A known field id, or `extra:<key>`. */
  id: string;
  label: string;
  group: EnvironmentGroup;
  /** Display string, already redacted. `""` when the source is `"missing"`. */
  value: string;
  /**
   * `"supplied"` — the consumer told us. `"detected"` — the browser did, and it
   * describes this tab, not the deployment. `"missing"` — nobody did.
   */
  source: "supplied" | "detected" | "missing";
  /** True when `redact()` or the PII pass changed the value. Shown, never silent. */
  masked: boolean;
  /** Rendered in the danger colour: impersonation, and production itself. */
  alarming?: boolean;
}

export interface EnvironmentSnapshot {
  revision: number;
  at: number;
  /** `"unknown"` unless the consumer supplied one. Never inferred. */
  kind: EnvironmentKind | (string & {});
  severity: EnvironmentSeverity;
  impersonating: boolean;
  /** False when the consumer supplied no context at all. */
  supplied: boolean;
  /** How many field values this extension changed on the way to the screen. */
  maskedCount: number;
  fields: readonly EnvironmentFieldView[];
}

export interface FieldSpec {
  id: EnvironmentFieldId;
  label: string;
  group: EnvironmentGroup;
}

/** Order is §3B's order, which is also bar-to-panel reading order. */
export const FIELD_SPECS: readonly FieldSpec[] = [
  { id: "environment", label: "Environment", group: "build" },
  { id: "release", label: "Release", group: "build" },
  { id: "commit", label: "Commit", group: "build" },
  { id: "branch", label: "Branch", group: "build" },
  { id: "deployment", label: "Deployment", group: "build" },
  { id: "region", label: "Region", group: "build" },
  { id: "apiEndpoint", label: "API endpoint", group: "build" },
  { id: "builtAt", label: "Built", group: "build" },
  { id: "userId", label: "User", group: "session" },
  { id: "workspaceId", label: "Workspace", group: "session" },
  { id: "internal", label: "Internal", group: "session" },
  { id: "impersonation", label: "Impersonation", group: "session" },
  { id: "roles", label: "Roles", group: "session" },
  { id: "sync", label: "Sync", group: "session" },
  { id: "route", label: "Route", group: "client" },
  { id: "viewport", label: "Viewport", group: "client" },
  { id: "connection", label: "Connection", group: "client" },
];

export const GROUP_LABELS: Record<EnvironmentGroup, string> = {
  build: "Build",
  session: "Session",
  client: "Client",
};

/**
 * Folds the spellings a deploy pipeline actually produces onto the canonical
 * names. `"Production"`, `" prod "` and `"PROD"` are production, and grading
 * them `"unknown"` — a neutral grey chip — is a direct miss of §6's "mark
 * production conspicuously". Anything unrecognised is returned trimmed and
 * lowercased, and stays `"unknown"`.
 */
export function normaliseKind(kind: string): string {
  const value = kind.trim().toLowerCase();
  switch (value) {
    case "prod":
      return "production";
    case "stage":
      return "staging";
    case "dev":
      return "development";
    default:
      return value;
  }
}

/**
 * Severity by environment. Production is `"bad"` on purpose — §6's "mark
 * production conspicuously" — not because anything is wrong with it.
 *
 * Impersonation outranks everything: there is no route to a reassuring green
 * while you are acting as somebody else.
 */
export function severityForKind(
  kind: string,
  impersonating: boolean,
): EnvironmentSeverity {
  if (impersonating) return "bad";
  switch (normaliseKind(kind)) {
    case "production":
      return "bad";
    case "staging":
    case "preview":
      return "warn";
    case "local":
    case "development":
    case "test":
      return "ok";
    default:
      return "unknown";
  }
}
