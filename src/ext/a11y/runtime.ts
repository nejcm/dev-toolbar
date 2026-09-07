/**
 * The scan, the masking and the highlight geometry. [dev-toolbar/ext/a11y]
 *
 * axe runs **only** when something calls `scan()` — a click, a command, an
 * agent. Nothing here is on a timer: a full-document axe pass is tens of
 * milliseconds at best and seconds on a large page.
 *
 * axe's results are foreign data on their way into a bug report, so every
 * string that reaches the report is masked the way `/ext/diagnostics`' console
 * tail masks a log line: `redact()` for whole-value credentials, then a URL
 * pass for the ones embedded in a longer string. An element's HTML snippet is
 * the sharpest edge of that — a `<input type="password" value="...">` is
 * exactly the markup axe flags — so attribute values survive only for the
 * attributes accessibility is about.
 */
import {
  createThrottledStore,
  isSensitiveKey,
  redact,
  redactUrl,
} from "@nejcm/dev-toolbar/runtime";
import { A11Y_MARKER, IMPACTS, NO_COUNTS, emptyReport, isImpact, selectionKey } from "./types";
import type { RedactOptions, ThrottledStore } from "@nejcm/dev-toolbar/runtime";
import type { ExtensionRuntimeApi } from "../../core/contract";
import type {
  A11yGroupView,
  A11yHighlightView,
  A11yNodeView,
  A11yReport,
  A11ySnapshot,
  A11yViolationView,
  AxeLike,
  Impact,
  RectLike,
} from "./types";

export const DEFAULT_NODE_LIMIT = 5;

/** Everything the toolbar draws, and the toolbar itself, is not the app's markup. */
export const TOOLBAR_EXCLUDE = "[data-dev-toolbar]";

const URL_LIKE = /[a-z][a-z0-9+.-]*:\/\/\S+/gi;

/**
 * Attribute values kept verbatim: the ones a11y is about. Everything else —
 * `value`, every `data-*`, anything a framework invented — is masked, because
 * the element axe is complaining about is often the one holding the secret.
 */
const KEPT_ATTRIBUTES = new Set([
  "id",
  "class",
  "role",
  "type",
  "for",
  "name",
  "alt",
  "title",
  "placeholder",
  "label",
  "lang",
  "dir",
  "tabindex",
  "href",
  "src",
  "rel",
  "target",
  "colspan",
  "rowspan",
  "scope",
  "disabled",
  "hidden",
  "checked",
  "selected",
  "readonly",
  "required",
  "open",
  "width",
  "height",
]);

/**
 * Kept attributes whose value *is* a URL, so the URL redactor runs on the
 * whole value rather than only on the `scheme://` substrings a free-text pass
 * can recognise — `href="/reset?token=…"` is the common SPA shape.
 */
const URL_ATTRIBUTES = new Set(["href", "src"]);

const TAG_OR_TEXT = /<[^>]*>|[^<]+/g;
const ATTRIBUTE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/g;

export interface A11yRuntimeOptions {
  /**
   * axe's `context`. Default excludes the toolbar's own DOM — the bar is not
   * the app, and its chrome would otherwise show up as the app's violations.
   */
  context?: unknown;
  /** Merged into axe's run options, so `runOnly`, `resultTypes` and the rest pass through. */
  axeOptions?: Readonly<Record<string, unknown>>;
  /** Rule configuration, axe's own `{ [ruleId]: { enabled } }` shape. Wins over `axeOptions.rules`. */
  rules?: Readonly<Record<string, { enabled: boolean }>>;
  /**
   * How axe is obtained. The default is `import("axe-core")`, the optional
   * peer. Pass your own to hand over an already-loaded copy, or a stub in a test.
   */
  load?: () => Promise<AxeLike>;
  redactOptions?: RedactOptions;
  /** Elements reported per violated rule. Default `5`; the count is always exact. */
  nodeLimit?: number;
  now?: () => number;
  /**
   * Scan once as soon as the extension starts. Default `false`: a scan is
   * expensive and the first paint is the worst moment to spend it.
   */
  scanOnStart?: boolean;
}

export interface A11yRuntime {
  readonly store: ThrottledStore<A11ySnapshot>;
  start(api: ExtensionRuntimeApi): () => void;
  /** Runs axe. Resolves with the same report the panel renders; never rejects. */
  scan(): Promise<A11yReport>;
  /** The last report. Scans nothing. */
  report(): A11yReport;
  /** Highlights one flagged element, or clears the highlight with `null`. */
  select(key: string | null): A11yReport;
  /** Drops the last scan and the highlight. */
  clear(): A11yReport;
  /** The report — the same object the panel renders. */
  diagnostics(): unknown;
}

const defaultNow = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const asArray = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const asText = (value: unknown): string | null => (typeof value === "string" ? value : null);

export function createA11yRuntime(options: A11yRuntimeOptions = {}): A11yRuntime {
  const {
    context = { exclude: [[TOOLBAR_EXCLUDE]] },
    axeOptions,
    rules,
    load = () => import("axe-core") as Promise<AxeLike>,
    redactOptions,
    nodeLimit = DEFAULT_NODE_LIMIT,
    now = defaultNow,
    scanOnStart = false,
  } = options;

  const limit = Number.isFinite(nodeLimit)
    ? Math.max(1, Math.min(50, Math.round(nodeLimit)))
    : DEFAULT_NODE_LIMIT;

  let report = emptyReport("pending");
  let revision = 0;
  let highlight: readonly A11yHighlightView[] = [];
  let inFlight: Promise<A11yReport> | null = null;
  let axe: AxeLike | null = null;
  let loading: Promise<AxeLike | null> | null = null;
  let torn = false;

  /**
   * Raw selectors, kept out of the report on purpose: the published ones are
   * masked, and a masked selector cannot be handed back to `querySelector`.
   */
  let targets = new Map<string, { target: string; impact: Impact; label: string }>();

  const store = createThrottledStore<A11ySnapshot>(
    { revision, report, highlight },
    { intervalMs: 100 },
  );

  /**
   * `immediate` for everything a person or an agent just did — the throttle is
   * there for the scroll re-measure, and a result that appears up to an
   * interval late reads as a broken button.
   */
  const publish = (immediate = false): void => {
    revision += 1;
    store.set({ revision, report, highlight });
    if (immediate) store.flush();
  };

  const maskUrls = (text: string): string => {
    try {
      return text.replace(URL_LIKE, (match) => {
        try {
          return redactUrl(match, redactOptions);
        } catch {
          return match;
        }
      });
    } catch {
      return text;
    }
  };

  const maskUrlValue = (value: string): string => {
    try {
      return redactUrl(value, redactOptions);
    } catch {
      return value;
    }
  };

  const maskString = (value: string): string => {
    try {
      return maskUrls(String(redact(value, redactOptions)));
    } catch {
      return "[unreadable]";
    }
  };

  const keepsValue = (name: string): boolean => {
    const lower = name.toLowerCase();
    if (isSensitiveKey(name, redactOptions)) return false;
    return lower.startsWith("aria-") || KEPT_ATTRIBUTES.has(lower);
  };

  /**
   * Attribute values outside the accessibility set become `[redacted]`
   * wholesale rather than being tested for credential shape: the test is the
   * part that has leaked before, and a `value=` attribute has no a11y meaning.
   */
  const maskAttribute = (name: string, value: string): string => {
    if (!keepsValue(name)) return "[redacted]";
    const masked = maskString(value);
    return URL_ATTRIBUTES.has(name.toLowerCase()) ? maskUrlValue(masked) : masked;
  };

  const maskHtml = (html: string): string => {
    try {
      return html.replace(TAG_OR_TEXT, (part) => {
        if (!part.startsWith("<")) return maskString(part);
        return part.replace(ATTRIBUTE, (_match, name: string, raw: string) => {
          const quote = raw.startsWith('"') || raw.startsWith("'") ? raw[0] : "";
          const inner = quote === "" ? raw : raw.slice(1, -1);
          const value = maskAttribute(name, inner);
          return `${name}="${value.replace(/"/g, "&quot;")}"`;
        });
      });
    } catch {
      return "[unreadable]";
    }
  };

  const describe = (error: unknown): string => {
    if (error instanceof Error) {
      const name = maskString(error.name);
      const message = maskString(error.message);
      return message === "" ? name : `${name}: ${message}`;
    }
    return maskString(typeof error === "string" ? error : String(error));
  };

  const unsupported = (reason: string): void => {
    report = { ...report, status: "unsupported", running: false, unsupportedReason: reason };
    publish(true);
  };

  /** axe's CJS export arrives as `default` through some interop paths. */
  const unwrap = (loaded: unknown): AxeLike | null => {
    const module = asRecord(loaded);
    if (typeof module["run"] === "function") return loaded as AxeLike;
    const fallback = asRecord(module["default"]);
    return typeof fallback["run"] === "function" ? (module["default"] as AxeLike) : null;
  };

  const ensureAxe = async (): Promise<AxeLike | null> => {
    if (axe !== null) return axe;
    if (loading === null) {
      loading = (async () => {
        let loaded: unknown;
        try {
          loaded = await load();
        } catch (error) {
          unsupported(
            `axe-core is not installed — \`npm install --save-dev axe-core\`. (${describe(error)})`,
          );
          return null;
        }
        const resolved = unwrap(loaded);
        if (resolved === null) {
          unsupported("axe-core resolved but exposes no run() — check the installed version.");
          return null;
        }
        axe = resolved;
        report = {
          ...report,
          status: report.status === "unsupported" ? "pending" : report.status,
          unsupportedReason: null,
          axeVersion: asText(resolved.version) ?? report.axeVersion,
        };
        publish(true);
        return resolved;
      })();
    }
    return loading;
  };

  const toNodes = (
    rule: string,
    impact: Impact,
    raw: readonly unknown[],
  ): { nodes: A11yNodeView[]; count: number } => {
    const nodes: A11yNodeView[] = [];
    for (const [index, entry] of raw.slice(0, limit).entries()) {
      const node = asRecord(entry);
      const selectors = asArray(node["target"]).filter(
        (value): value is string => typeof value === "string",
      );
      const key = selectionKey(rule, index);
      const selector = selectors.join(" ");
      // A multi-entry target is an iframe path; `querySelector` cannot follow
      // one, so it is reported and left unhighlightable rather than mis-aimed.
      if (selectors.length === 1) {
        targets.set(key, { target: selectors[0] as string, impact, label: rule });
      }
      nodes.push({
        target: maskString(selector),
        html: maskHtml(asText(node["html"]) ?? ""),
        summary: (() => {
          const text = asText(node["failureSummary"]);
          return text === null ? null : maskString(text);
        })(),
      });
    }
    return { nodes, count: raw.length };
  };

  const toViolations = (raw: readonly unknown[]): A11yViolationView[] => {
    const violations: A11yViolationView[] = [];
    for (const entry of raw) {
      const record = asRecord(entry);
      const rule = maskString(asText(record["id"]) ?? "unknown");
      const impact = isImpact(record["impact"]) ? record["impact"] : "minor";
      const { nodes, count } = toNodes(rule, impact, asArray(record["nodes"]));
      violations.push({
        rule,
        impact,
        help: maskString(asText(record["help"]) ?? rule),
        helpUrl: (() => {
          const url = asText(record["helpUrl"]);
          return url === null ? null : maskUrls(url);
        })(),
        tags: asArray(record["tags"])
          .filter((tag): tag is string => typeof tag === "string")
          .map((tag) => maskString(tag)),
        nodeCount: count,
        nodes,
        truncated: nodes.length < count,
      });
    }
    return violations;
  };

  const group = (violations: readonly A11yViolationView[]): A11yGroupView[] =>
    IMPACTS.map((impact) => ({
      impact,
      count: violations.filter((violation) => violation.impact === impact).length,
      violations: violations.filter((violation) => violation.impact === impact),
    })).filter((entry) => entry.count > 0);

  const apply = (raw: unknown, durationMs: number): void => {
    const results = asRecord(raw);
    targets = new Map();
    const violations = toViolations(asArray(results["violations"]));
    const counts = { ...NO_COUNTS };
    for (const violation of violations) counts[violation.impact] += 1;
    const engine = asRecord(results["testEngine"]);
    report = {
      status: "ok",
      running: false,
      at: new Date().toISOString(),
      durationMs: Math.round(durationMs),
      axeVersion: asText(engine["version"]) ?? asText(axe?.version) ?? report.axeVersion,
      unsupportedReason: null,
      error: null,
      total: violations.length,
      counts,
      nodeTotal: violations.reduce((sum, violation) => sum + violation.nodeCount, 0),
      passes: asArray(results["passes"]).length,
      incomplete: asArray(results["incomplete"]).length,
      groups: group(violations),
      selected: null,
      scans: report.scans + 1,
    };
    highlight = [];
  };

  let frame: number | null = null;
  let watching = false;
  let detach: (() => void) | null = null;

  const rect = (element: Element): RectLike => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  };

  const measure = (immediate = false): void => {
    const key = report.selected;
    const entry = key === null ? undefined : targets.get(key);
    if (key === null || entry === undefined || typeof document === "undefined") {
      if (highlight.length > 0) {
        highlight = [];
        publish(immediate);
      }
      return;
    }
    let element: Element | null = null;
    try {
      element = document.querySelector(entry.target);
    } catch {
      element = null;
    }
    const next: readonly A11yHighlightView[] =
      element === null
        ? []
        : [{ key, rect: rect(element), label: entry.label, impact: entry.impact }];
    highlight = next;
    publish(immediate);
  };

  const schedule = (): void => {
    if (frame !== null || typeof requestAnimationFrame !== "function") return;
    frame = requestAnimationFrame(() => {
      frame = null;
      measure();
    });
  };

  const watch = (): void => {
    if (watching || typeof window === "undefined") return;
    watching = true;
    const onChange = () => schedule();
    window.addEventListener("scroll", onChange, { passive: true, capture: true });
    window.addEventListener("resize", onChange, { passive: true });
    detach = () => {
      window.removeEventListener("scroll", onChange, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", onChange);
      watching = false;
      detach = null;
    };
  };

  const unwatch = (): void => {
    if (frame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    frame = null;
    detach?.();
  };

  const select = (key: string | null): A11yReport => {
    const known = key !== null && targets.has(key);
    report = { ...report, selected: known ? key : null };
    if (known) {
      watch();
      measure(true);
    } else {
      unwatch();
      highlight = [];
      publish(true);
    }
    return report;
  };

  const runScan = async (): Promise<A11yReport> => {
    const loaded = await ensureAxe();
    if (loaded === null || torn) return report;
    report = { ...report, running: true, error: null };
    publish(true);
    const started = now();
    try {
      const raw = await loaded.run(context, {
        ...axeOptions,
        ...(rules === undefined ? {} : { rules }),
      });
      if (torn) return report;
      // A result with no `violations` array is not axe's, and the wrong answer
      // to publish is a confident zero: say the scan failed instead. The peer
      // range is `>=4.8`; nothing enforces that at load time, so this is where
      // a too-old or wrong module is noticed.
      if (Array.isArray(asRecord(raw)["violations"])) {
        unwatch();
        apply(raw, now() - started);
      } else {
        report = {
          ...report,
          status: "failed",
          error: `${A11Y_MARKER} axe.run() resolved with something that is not an axe result — check the installed axe-core version (this extension needs >=4.8).`,
        };
      }
    } catch (error) {
      report = {
        ...report,
        status: "failed",
        error: `${A11Y_MARKER} axe.run() threw — ${describe(error)}`,
      };
    } finally {
      report = { ...report, running: false };
      publish(true);
    }
    return report;
  };

  /**
   * Concurrent callers share one axe pass: axe itself refuses to run twice at
   * once, so a second `scan()` would otherwise fail a caller whose scan was
   * really succeeding.
   */
  const scan = (): Promise<A11yReport> => {
    if (inFlight !== null) return inFlight;
    inFlight = (async () => {
      try {
        return await runScan();
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  const clear = (): A11yReport => {
    unwatch();
    targets = new Map();
    highlight = [];
    report = {
      ...emptyReport(report.status === "unsupported" ? "unsupported" : "pending"),
      unsupportedReason: report.unsupportedReason,
      axeVersion: report.axeVersion,
      scans: report.scans,
    };
    publish(true);
    return report;
  };

  return {
    store,
    start(api: ExtensionRuntimeApi) {
      torn = false;
      // The import — not a scan — happens here, so the panel can say "not
      // installed" before anybody clicks a button that cannot work.
      void ensureAxe().then((loaded) => {
        if (loaded !== null && scanOnStart && !torn) void scan();
      });
      const stopVisibility = api.subscribeVisibility((visible) => {
        if (!visible) select(null);
      });
      return () => {
        torn = true;
        stopVisibility();
        unwatch();
        store.flush();
      };
    },
    scan,
    report: () => report,
    select,
    clear,
    diagnostics: () => report,
  };
}
