/**
 * The scan, the masking and the highlight geometry. [dev-toolbar/ext/a11y]
 *
 * axe runs only when `scan()` is called — never on a timer. axe's results are
 * foreign data on their way into a bug report, so every string is masked:
 * snippet text through `redactText()`, everything else (selectors, summaries,
 * rule ids, thrown reasons) through `/runtime`'s `redactProse()`. An HTML
 * snippet is the sharpest edge — `<input type="password" value="...">` is
 * exactly what axe flags — so attribute values survive only for the
 * attributes accessibility is about.
 */
import {
  UNREADABLE,
  createThrottledStore,
  formatError,
  isSensitiveKey,
  redactProse,
  redactText,
} from "@nejcm/dev-toolbar/runtime";
import { A11Y_MARKER, IMPACTS, NO_COUNTS, emptyReport, isImpact, selectionKey } from "./types";
import type { RedactOptions, RedactTextOptions, ThrottledStore } from "@nejcm/dev-toolbar/runtime";
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

/** `loadOn`'s default: import the peer when the toolbar mounts. */
export const DEFAULT_LOAD_ON: NonNullable<A11yRuntimeOptions["loadOn"]> = "start";

/** Everything the toolbar draws, and the toolbar itself, is not the app's markup. */
export const TOOLBAR_EXCLUDE = "[data-dev-toolbar]";

// Everything else — `value`, every `data-*`, anything a framework invented —
// is masked: the flagged element is often the one holding the secret.
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

// Kept attributes whose value *is* a URL: the whole value goes through the URL
// redactor rather than only its `scheme://` substrings, since a relative
// `href="/reset?token=…"` is the common SPA shape a substring pass would miss.
const URL_ATTRIBUTES = new Set(["href", "src"]);

const asArray = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

const asText = (value: unknown): string | null => (typeof value === "string" ? value : null);

// axe's own snippet truncation stops at the start tag plus a little; a single
// attribute can still carry a hundred kilobytes into the report.
const TEXT_LIMIT = 4096;

// axe nests a selector array inside `target` when the element is in a shadow root.
const SHADOW_STEP = " >> ";

interface Masks {
  text(value: string): string;
  attribute(name: string, value: string): string;
}

const isSpace = (char: string): boolean =>
  char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";

// A truncated run must never emit half a token: `redact()` matches whole
// values, and half a credential is still one.
const head = (text: string): string => {
  const cut = text.slice(0, TEXT_LIMIT);
  const lastSpace = cut.search(/\s\S*$/);
  return lastSpace === -1 ? "" : cut.slice(0, lastSpace);
};

// Truncated before masking, not after: regexing 100 KB of markup takes seconds.
const maskText = (text: string, mask: (value: string) => string): string =>
  text.length <= TEXT_LIMIT ? mask(text) : `${mask(head(text))}… [truncated]`;

// Walks the markup instead of matching `<[^>]*>`: a regex would end
// `data-secret="a>SECRET"` at the inner `>` and carry the tail through
// unmasked. `null` means "not confidently parseable"; the caller drops the
// snippet rather than emit it raw.
const readTag = (
  html: string,
  start: number,
  masks: Masks,
): { out: string; next: number } | null => {
  let i = start + 1;
  if (html.startsWith("!--", i)) {
    const close = html.indexOf("-->", i + 3);
    if (close === -1) return null;
    return {
      out: "<!--[redacted]-->",
      next: close + 3,
    };
  }
  if (html.charAt(i) === "!" || html.charAt(i) === "?") return null;

  let out = "<";
  if (html.charAt(i) === "/") {
    out += "/";
    i += 1;
  }
  const nameStart = i;
  while (
    i < html.length &&
    !isSpace(html.charAt(i)) &&
    html.charAt(i) !== ">" &&
    html.charAt(i) !== "/"
  ) {
    i += 1;
  }
  if (i === nameStart) return null;
  out += html.slice(nameStart, i);

  for (;;) {
    if (out.length > TEXT_LIMIT) return { out, next: html.length };
    while (i < html.length && isSpace(html.charAt(i))) i += 1;
    if (i >= html.length) return null;
    if (html.charAt(i) === ">") return { out: `${out}>`, next: i + 1 };
    if (html.charAt(i) === "/" && html.charAt(i + 1) === ">")
      return { out: `${out}/>`, next: i + 2 };

    const nameEnd = (() => {
      let at = i;
      while (
        at < html.length &&
        !isSpace(html.charAt(at)) &&
        html.charAt(at) !== "=" &&
        html.charAt(at) !== ">" &&
        html.charAt(at) !== "/"
      ) {
        at += 1;
      }
      return at;
    })();
    if (nameEnd === i) return null;
    const name = html.slice(i, nameEnd);
    i = nameEnd;

    let equals = i;
    while (equals < html.length && isSpace(html.charAt(equals))) equals += 1;
    if (html.charAt(equals) !== "=") {
      out += ` ${name}`;
      continue;
    }
    i = equals + 1;
    while (i < html.length && isSpace(html.charAt(i))) i += 1;
    if (i >= html.length) return null;

    const quote = html.charAt(i);
    let raw: string;
    if (quote === '"' || quote === "'") {
      const close = html.indexOf(quote, i + 1);
      if (close === -1) return null;
      raw = html.slice(i + 1, close);
      i = close + 1;
    } else {
      const valueStart = i;
      while (i < html.length && !isSpace(html.charAt(i)) && html.charAt(i) !== ">") i += 1;
      raw = html.slice(valueStart, i);
    }
    // Too long to have a11y use, and truncating could split a token, so dropped whole.
    const value = raw.length > TEXT_LIMIT ? "[redacted]" : masks.attribute(name, raw);
    out += ` ${name}="${value.replace(/"/g, "&quot;")}"`;
  }
};

const maskMarkup = (html: string, masks: Masks): string | null => {
  let out = "";
  let i = 0;
  while (i < html.length) {
    if (out.length > TEXT_LIMIT) return `${out}… [truncated]`;
    const open = html.indexOf("<", i);
    if (open === -1) return out + maskText(html.slice(i), masks.text);
    if (open > i) out += maskText(html.slice(i, open), masks.text);
    const tag = readTag(html, open, masks);
    if (tag === null) return null;
    out += tag.out;
    i = tag.next;
  }
  return out;
};

const targetPath = (value: unknown): readonly (readonly string[])[] =>
  asArray(value)
    .map((step) =>
      typeof step === "string"
        ? [step]
        : asArray(step).filter((entry): entry is string => typeof entry === "string"),
    )
    .filter((step) => step.length > 0);

// axe refuses to run twice at once, and one engine is normally shared by every
// runtime in the page, so the queue lives on the engine, not the runtime.
const engineQueue = new WeakMap<AxeLike, Promise<void>>();

const queueOnEngine = (engine: AxeLike, run: () => Promise<unknown>): Promise<unknown> => {
  const tail = engineQueue.get(engine) ?? Promise.resolve();
  const next = tail.then(run, run);
  engineQueue.set(
    engine,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
};

export interface A11yRuntimeOptions {
  /**
   * axe's `context`. Default excludes the toolbar's own DOM — the bar is not
   * the app, and its chrome would otherwise show up as the app's violations.
   */
  context?: unknown;
  /**
   * Merged into axe's run options, so `runOnly`, `resultTypes` and the rest pass
   * through. `resultTypes` always gains `"violations"`: axe truncates an
   * omitted type's nodes to one, and `nodeCount` is documented exact.
   */
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
  /**
   * When the axe-core peer is imported. `"start"` (default) imports it at
   * mount, so the panel can say "not installed" before anyone clicks a button
   * that cannot work — at the cost of the peer's chunk (~160 KB gzipped) on
   * every page load. `"scan"` defers the import to the first `scan()`.
   *
   * `scanOnStart: true` still imports at start under `loadOn: "scan"`, since a
   * scan was asked for and a scan needs axe.
   */
  loadOn?: "start" | "scan";
}

export interface A11yRuntime {
  readonly store: ThrottledStore<A11ySnapshot>;
  start(api: ExtensionRuntimeApi): () => void;
  /**
   * Runs axe. Resolves with the same report the panel renders; never rejects.
   * Passes are serialised per axe copy, so runtimes sharing one engine queue
   * rather than meeting axe's own "already running" error — which also means a
   * `run` that never settles blocks every later scan on that engine.
   */
  scan(): Promise<A11yReport>;
  /** The last report. Scans nothing. */
  report(): A11yReport;
  /** Highlights one flagged element, or clears the highlight with `null`. */
  select(key: string | null): A11yReport;
  /**
   * Drops the last scan and the highlight. A scan in flight is disowned, not
   * cancelled — axe has no abort, so it runs to completion and its result is
   * thrown away rather than repopulating the cleared report.
   */
  clear(): A11yReport;
  /** The report — the same object the panel renders. */
  diagnostics(): unknown;
}

const defaultNow = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

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
    loadOn = DEFAULT_LOAD_ON,
  } = options;

  // Snapshotted on first use, not at construction: `redactOptions` is the
  // caller's own object, and every other path reads it lazily too — spreading
  // it here would let a caller who fills it in after `a11y()` returns see
  // `href`/`src` masked differently from the attribute beside them.
  let urlRedactOptionsCache: RedactTextOptions | null = null;
  const urlRedactOptions = (): RedactTextOptions =>
    (urlRedactOptionsCache ??= { ...redactOptions, url: true });
  const limit = Number.isFinite(nodeLimit)
    ? Math.max(1, Math.min(50, Math.round(nodeLimit)))
    : DEFAULT_NODE_LIMIT;

  let report = emptyReport("pending");
  let revision = 0;
  let highlight: readonly A11yHighlightView[] = [];
  let inFlight: Promise<A11yReport> | null = null;
  let inFlightId = 0;
  // Bumped by teardown, remount and `clear()` so a result nobody is waiting on
  // any more cannot land on the state that replaced it.
  let generation = 0;
  let axe: AxeLike | null = null;
  let loading: Promise<AxeLike | null> | null = null;

  // Raw selectors, kept out of the report on purpose: the published ones are
  // masked, and a masked selector cannot be handed back to `querySelector`.
  let targets = new Map<string, { path: readonly string[]; impact: Impact; label: string }>();

  const store = createThrottledStore<A11ySnapshot>(
    { revision, report, highlight, axeLoaded: false },
    { intervalMs: 100 },
  );

  // `immediate` for anything a person or agent just did — the throttle is for
  // the scroll re-measure, where a result up to an interval late is fine.
  const publish = (immediate = false): void => {
    revision += 1;
    store.set({ revision, report, highlight, axeLoaded: axe !== null });
    if (immediate) store.flush();
  };

  const maskProse = (value: string): string => redactProse(value, redactOptions);

  const keepsValue = (name: string): boolean => {
    const lower = name.toLowerCase();
    if (isSensitiveKey(name, redactOptions)) return false;
    return lower.startsWith("aria-") || KEPT_ATTRIBUTES.has(lower);
  };

  // Outside the accessibility set, a value becomes `[redacted]` wholesale
  // rather than tested for credential shape — a `value=` attribute has no a11y
  // meaning, and the shape test is the part that has leaked before.
  const maskAttribute = (name: string, value: string): string => {
    if (!keepsValue(name)) return "[redacted]";
    return URL_ATTRIBUTES.has(name.toLowerCase())
      ? redactText(value, urlRedactOptions())
      : maskSnippetText(value);
  };

  const maskSnippetText = (value: string): string => redactText(value, redactOptions);

  const masks: Masks = { text: maskSnippetText, attribute: maskAttribute };

  const maskHtml = (html: string): string => {
    try {
      const masked = maskMarkup(html, masks) ?? UNREADABLE;
      const suffix = "… [truncated]";
      return masked.length <= TEXT_LIMIT
        ? masked
        : masked.slice(0, TEXT_LIMIT - suffix.length) + suffix;
    } catch {
      return UNREADABLE;
    }
  };

  const describe = (error: unknown): string => formatError(error, redactOptions);

  const unsupported = (reason: string): void => {
    report = { ...report, status: "unsupported", running: false, unsupportedReason: reason };
    publish(true);
  };

  // axe's CJS export can arrive as `default` depending on interop, and the
  // module object is foreign — a Proxy or getter can throw on inspection.
  const unwrap = (loaded: unknown): AxeLike | null => {
    try {
      const module = asRecord(loaded);
      if (typeof module["run"] === "function") return loaded as AxeLike;
      const fallback = asRecord(module["default"]);
      return typeof fallback["run"] === "function" ? (module["default"] as AxeLike) : null;
    } catch {
      return null;
    }
  };

  const engineVersion = (engine: AxeLike): string | null => {
    try {
      return asText(engine.version);
    } catch {
      return null;
    }
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
          axeVersion: engineVersion(resolved) ?? report.axeVersion,
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
      const path = targetPath(node["target"]);
      const key = selectionKey(rule, index);
      const selector = path.map((step) => step.join(SHADOW_STEP)).join(" ");
      // A multi-step target is an iframe path; nothing in this document can
      // follow one, so it is reported and left unhighlightable rather than
      // mis-aimed. A single step may still cross open shadow roots.
      const first = path[0];
      if (path.length === 1 && first !== undefined) {
        targets.set(key, { path: first, impact, label: rule });
      }
      nodes.push({
        target: maskText(selector, maskProse),
        html: maskHtml(asText(node["html"]) ?? ""),
        summary: (() => {
          const text = asText(node["failureSummary"]);
          return text === null ? null : maskText(text, maskProse);
        })(),
      });
    }
    return { nodes, count: raw.length };
  };

  const toViolations = (raw: readonly unknown[]): A11yViolationView[] => {
    const violations: A11yViolationView[] = [];
    for (const entry of raw) {
      const record = asRecord(entry);
      const rule = maskProse(asText(record["id"]) ?? "unknown");
      const impact = isImpact(record["impact"]) ? record["impact"] : "minor";
      const { nodes, count } = toNodes(rule, impact, asArray(record["nodes"]));
      violations.push({
        rule,
        impact,
        help: maskProse(asText(record["help"]) ?? rule),
        helpUrl: (() => {
          const url = asText(record["helpUrl"]);
          return url === null ? null : maskProse(url);
        })(),
        tags: asArray(record["tags"])
          .filter((tag): tag is string => typeof tag === "string")
          .map((tag) => maskProse(tag)),
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
      axeVersion:
        asText(engine["version"]) ??
        (axe === null ? null : engineVersion(axe)) ??
        report.axeVersion,
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

  // A step past the first is inside the previous element's shadow root — how
  // axe reports an element in an open one.
  const findTarget = (path: readonly string[]): Element | null => {
    if (typeof document === "undefined") return null;
    let root: Document | ShadowRoot | null = document;
    let element: Element | null = null;
    for (const selector of path) {
      if (root === null) return null;
      try {
        element = root.querySelector(selector);
      } catch {
        return null;
      }
      if (element === null) return null;
      root = element.shadowRoot;
    }
    return element;
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
    const element = findTarget(entry.path);
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

  // axe silently truncates a result type's nodes to one when `resultTypes`
  // leaves it out; `nodeCount`/`nodeTotal` are documented exact, so violations
  // are always requested in full.
  const runOptions = (): Record<string, unknown> => {
    const merged: Record<string, unknown> = {
      ...axeOptions,
      ...(rules === undefined ? {} : { rules }),
    };
    const types = merged["resultTypes"];
    if (Array.isArray(types) && !types.includes("violations")) {
      merged["resultTypes"] = [...types, "violations"];
    }
    return merged;
  };

  const runScan = async (): Promise<A11yReport> => {
    const mine = generation;
    const loaded = await ensureAxe();
    if (loaded === null || generation !== mine) return report;
    report = { ...report, running: true, error: null };
    publish(true);
    const started = now();
    let raw: unknown;
    let failure: string | null = null;
    try {
      raw = await queueOnEngine(loaded, () => loaded.run(context, runOptions()));
    } catch (error) {
      failure = `${A11Y_MARKER} axe.run() threw — ${describe(error)}`;
    }
    // Disowned by a teardown, remount or clear() — its result belongs to a
    // report nobody holds any more.
    if (generation !== mine) return report;
    if (failure !== null) {
      report = { ...report, status: "failed", running: false, error: failure };
    } else if (Array.isArray(asRecord(raw)["violations"])) {
      unwatch();
      apply(raw, now() - started);
    } else {
      // No `violations` array means this isn't axe's result — a confident zero
      // would be the wrong answer, and nothing enforces the >=4.8 peer range at load time.
      report = {
        ...report,
        status: "failed",
        running: false,
        error: `${A11Y_MARKER} axe.run() resolved with something that is not an axe result — check the installed axe-core version (this extension needs >=4.8).`,
      };
    }
    publish(true);
    return report;
  };

  // Concurrent callers share one axe pass: axe refuses to run twice at once.
  const scan = (): Promise<A11yReport> => {
    if (inFlight !== null) return inFlight;
    inFlightId += 1;
    const id = inFlightId;
    inFlight = (async () => {
      try {
        return await runScan();
      } finally {
        if (inFlightId === id) inFlight = null;
      }
    })();
    return inFlight;
  };

  // Not cancelling: axe has no abort, so the pass keeps running and its result
  // is dropped — the next caller starts fresh instead of joining it.
  const disownScan = (): void => {
    generation += 1;
    inFlightId += 1;
    inFlight = null;
  };

  const clear = (): A11yReport => {
    disownScan();
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
      disownScan();
      const mine = generation;
      if (loadOn === "scan") {
        if (scanOnStart) void scan();
      } else {
        // The import, not a scan, so the panel can say "not installed" before
        // anyone clicks a button that cannot work.
        void ensureAxe().then(
          (loaded) => {
            if (loaded !== null && scanOnStart && generation === mine) void scan();
          },
          () => {},
        );
      }
      const stopVisibility = api.subscribeVisibility((visible) => {
        if (!visible) select(null);
      });
      return () => {
        disownScan();
        stopVisibility();
        unwatch();
        if (report.running) {
          report = { ...report, running: false };
          publish(true);
        } else {
          store.flush();
        }
      };
    },
    scan,
    report: () => report,
    select,
    clear,
    diagnostics: () => report,
  };
}
