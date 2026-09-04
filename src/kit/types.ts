/** Shared severity vocabulary for extension authors. */
export type Severity = "unknown" | "ok" | "warn" | "bad";

/** Severity vocabulary for state that can be locally overridden. */
export type SeverityWithOverride = Severity | "override";
