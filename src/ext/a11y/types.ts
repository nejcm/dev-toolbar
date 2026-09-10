/**
 * Shared vocabulary for `/ext/a11y`. [dev-toolbar/ext/a11y]
 *
 * `ScanStatus` reuses `/ext/metrics`' status vocabulary rather than inventing
 * one: a peer that is not installed is the same fact as a platform API that is
 * not there, and `"unsupported"` is what the rest of the bar already calls it.
 */
import type { Severity } from "@nejcm/dev-toolbar/kit";

export const A11Y_MARKER = "[dev-toolbar/ext/a11y]";

/** axe's own four impact levels, worst first. */
export type Impact = "critical" | "serious" | "moderate" | "minor";

export const IMPACTS: readonly Impact[] = ["critical", "serious", "moderate", "minor"];

export const IMPACT_SEVERITY: Readonly<Record<Impact, Severity>> = {
  critical: "bad",
  serious: "bad",
  moderate: "warn",
  minor: "warn",
};

export type ScanStatus =
  /** axe-core is not installed, or its module failed to load. */
  | "unsupported"
  /**
   * No scan result is held: nothing has been scanned yet, or the last scan was
   * cleared. Says nothing about axe itself — the import may be in flight, not
   * yet requested (`loadOn: "scan"`), or long done; `A11ySnapshot.axeLoaded`
   * is where that lives.
   */
  | "pending"
  | "ok"
  /** A scan ran and threw. `A11yReport.error` says what. */
  | "failed";

/**
 * The part of axe-core this extension uses, declared structurally.
 *
 * Deliberately not `import type { ... } from "axe-core"`: the published
 * `.d.ts` would then reference a module an optional peer's absence makes
 * unresolvable, and every consumer without axe installed would fail to
 * typecheck against our types.
 */
export interface AxeLike {
  readonly version?: string;
  run(context?: unknown, options?: unknown): Promise<unknown>;
}

export interface A11yNodeView {
  /**
   * The selector, masked for display. Never fed back to `querySelector`. Frame
   * steps are space-separated; a step inside an open shadow root is joined to
   * its host with ` >> `.
   */
  target: string;
  /** axe's HTML snippet, attribute values masked. */
  html: string;
  summary: string | null;
}

export interface A11yViolationView {
  rule: string;
  impact: Impact;
  help: string;
  helpUrl: string | null;
  tags: readonly string[];
  /** Elements axe flagged, of which `nodes` may be the first few. */
  nodeCount: number;
  nodes: readonly A11yNodeView[];
  /** `nodes.length < nodeCount`. */
  truncated: boolean;
}

export interface A11yGroupView {
  impact: Impact;
  count: number;
  violations: readonly A11yViolationView[];
}

/**
 * One scan, as both the panel and `diagnostics()` read it. There is no second
 * serialisation: the object below is what the panel renders and what an agent
 * receives, already redacted.
 */
export interface A11yReport {
  status: ScanStatus;
  /** A scan is in flight. */
  running: boolean;
  /** ISO timestamp of the last completed scan. */
  at: string | null;
  durationMs: number | null;
  axeVersion: string | null;
  /** Why axe is unavailable, when it is. */
  unsupportedReason: string | null;
  /** Why the last scan failed, when it did. */
  error: string | null;
  /** Violated rules. Not elements — see `nodeTotal`. */
  total: number;
  counts: Readonly<Record<Impact, number>>;
  /** Elements across every violation. */
  nodeTotal: number;
  passes: number | null;
  incomplete: number | null;
  /** Non-empty impact groups, worst first. */
  groups: readonly A11yGroupView[];
  /** `selectionKey()` of the highlighted element, or `null`. */
  selected: string | null;
  /** Scans completed since mount. */
  scans: number;
}

export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface A11yHighlightView {
  key: string;
  rect: RectLike;
  label: string;
  impact: Impact;
}

export interface A11ySnapshot {
  /** Bumped on every publish. */
  revision: number;
  report: A11yReport;
  /**
   * Viewport geometry for the selected element, re-measured on scroll and
   * resize. Not part of the report: a rect is not a fact worth serialising,
   * and `report.selected` already says which element it belongs to.
   */
  highlight: readonly A11yHighlightView[];
  /**
   * axe has been imported and exposes `run()`. Not part of the report —
   * `status` already says `"unsupported"` when the import failed — but under
   * `loadOn: "scan"` a `"pending"` report exists before axe has been looked
   * for at all, and the panel needs to say so rather than imply it was found.
   *
   * The runtime always supplies it. Optional so a snapshot built by hand — a
   * consumer's fixture, say — stays valid; a reader treats `undefined` as
   * "not known to be loaded".
   */
  axeLoaded?: boolean;
}

export const NO_COUNTS: Readonly<Record<Impact, number>> = {
  critical: 0,
  serious: 0,
  moderate: 0,
  minor: 0,
};

export function emptyReport(status: ScanStatus, reason?: string): A11yReport {
  return {
    status,
    running: false,
    at: null,
    durationMs: null,
    axeVersion: null,
    unsupportedReason: reason ?? null,
    error: null,
    total: 0,
    counts: NO_COUNTS,
    nodeTotal: 0,
    passes: null,
    incomplete: null,
    groups: [],
    selected: null,
    scans: 0,
  };
}

export function worstImpact(counts: Readonly<Record<Impact, number>>): Impact | null {
  return IMPACTS.find((impact) => counts[impact] > 0) ?? null;
}

export function selectionKey(rule: string, index: number): string {
  return `${rule}#${index}`;
}

export function isImpact(value: unknown): value is Impact {
  return IMPACTS.includes(value as Impact);
}
