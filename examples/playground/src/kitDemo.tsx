import { useState } from "react";
import type { ReactNode } from "react";
import type {
  DevToolbarExtension,
  ExtensionRuntimeApi,
  ToolbarStorage,
} from "@nejcm/dev-toolbar";
import { createThrottledStore } from "@nejcm/dev-toolbar/runtime";
import type { ThrottledStore } from "@nejcm/dev-toolbar/runtime";
import {
  Action,
  Banner,
  Chip,
  CopyButton,
  EmptyState,
  Field,
  Note,
  Row,
  Rows,
  SearchField,
  Select,
  Tag,
  TextInput,
  createPoller,
  ensureKitStyles,
  matchesQuery,
  parseList,
  parseRecord,
  readJson,
  resolveStyleNonce,
  useExtensionSurface,
  writeJson,
} from "@nejcm/dev-toolbar/kit";
import type { Severity } from "@nejcm/dev-toolbar/kit";

/**
 * A third-party extension built entirely from `@nejcm/dev-toolbar/kit`. [kit-demo]
 *
 * It ships **no stylesheet of its own** — every element it renders is a kit control or
 * carries a `data-dtb-kind` the shared sheet already styles, which is the whole claim
 * the kit makes. Read it as the worked example for docs/kit.md: tier A owns the
 * polling, the persistence and the filtering, tier B owns the look, tier C owns the
 * markup.
 *
 * What it measures is deliberately dull — page facts anyone can verify by resizing the
 * window — so nothing here is about the measurement.
 */

type Fact = {
  id: string;
  label: string;
  value: string;
  severity: Severity;
  note?: string;
};

interface KitDemoSnapshot {
  facts: readonly Fact[];
  nodeCount: number;
  worst: Severity;
  sampledAt: string;
  history: readonly number[];
}

interface KitDemoSettings {
  nodeWarn: number;
  sort: "declared" | "severity";
}

const DEFAULT_SETTINGS: KitDemoSettings = { nodeWarn: 1500, sort: "declared" };
const SEVERITY_RANK: Record<Severity, number> = { bad: 0, warn: 1, ok: 2, unknown: 3 };

const isSettings = (value: unknown): value is KitDemoSettings => {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<KitDemoSettings>;
  return (
    typeof candidate.nodeWarn === "number" &&
    Number.isFinite(candidate.nodeWarn) &&
    (candidate.sort === "declared" || candidate.sort === "severity")
  );
};

const isTrue = (value: unknown): value is true => value === true;
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const EMPTY_SNAPSHOT: KitDemoSnapshot = {
  facts: [],
  nodeCount: 0,
  worst: "unknown",
  sampledAt: "never",
  history: [],
};

/**
 * The non-React half. A third-party extension keeps this separate for the same reason
 * the first-party ones do: slot functions must be cheap, so they return a component
 * that subscribes to this store rather than doing work themselves.
 */
class KitDemoRuntime {
  readonly store: ThrottledStore<KitDemoSnapshot>;
  private storage: Pick<ToolbarStorage, "getItem" | "setItem"> | undefined;
  private settings: KitDemoSettings = DEFAULT_SETTINGS;
  /** Null-prototype, straight out of `parseRecord`, so a persisted `__proto__` is data. */
  private pinned: Record<string, true> = parseRecord(null, isTrue);
  private history: readonly number[] = [];

  constructor() {
    this.store = createThrottledStore<KitDemoSnapshot>(EMPTY_SNAPSHOT, { intervalMs: 250 });
  }

  /** `readJson` and `parseRecord`/`parseList` never throw, so a corrupt key degrades rather than crashing the panel. */
  hydrate(storage: ToolbarStorage): void {
    this.storage = storage;
    this.settings = readJson(storage, "settings", DEFAULT_SETTINGS, isSettings);
    this.pinned = parseRecord(storage.getItem("pinned"), isTrue);
    this.history = parseList(storage.getItem("history"), isFiniteNumber, 20);
  }

  getSettings(): KitDemoSettings {
    return this.settings;
  }

  isPinned(id: string): boolean {
    return this.pinned[id] === true;
  }

  setSettings(next: Partial<KitDemoSettings>): void {
    this.settings = { ...this.settings, ...next };
    if (this.storage !== undefined) writeJson(this.storage, "settings", this.settings);
    this.sample();
  }

  togglePin(id: string): void {
    if (this.pinned[id] === true) delete this.pinned[id];
    else this.pinned[id] = true;
    if (this.storage !== undefined) writeJson(this.storage, "pinned", { ...this.pinned });
    this.sample();
  }

  record(): void {
    this.history = [this.store.peek().nodeCount, ...this.history].slice(0, 20);
    if (this.storage !== undefined) writeJson(this.storage, "history", [...this.history]);
    this.sample();
  }

  sample(): void {
    const nodeCount = document.getElementsByTagName("*").length;
    const nodeSeverity: Severity =
      nodeCount > this.settings.nodeWarn * 2
        ? "bad"
        : nodeCount > this.settings.nodeWarn
          ? "warn"
          : "ok";

    const facts: Fact[] = [
      {
        id: "nodes",
        label: "DOM nodes",
        value: String(nodeCount),
        severity: nodeSeverity,
        note: `Warns above ${this.settings.nodeWarn}.`,
      },
      {
        id: "viewport",
        label: "Viewport",
        value: `${window.innerWidth}×${window.innerHeight}`,
        severity: window.innerWidth < 640 ? "warn" : "ok",
        note: "Narrow enough and the shell collapses items into ⋮.",
      },
      {
        id: "dpr",
        label: "Device pixel ratio",
        value: String(window.devicePixelRatio),
        severity: "unknown",
      },
      {
        id: "online",
        label: "Network",
        value: navigator.onLine ? "online" : "offline",
        severity: navigator.onLine ? "ok" : "bad",
      },
      {
        id: "visibility",
        label: "Page visibility",
        value: document.visibilityState,
        severity: document.visibilityState === "visible" ? "ok" : "unknown",
      },
      {
        id: "scheme",
        label: "Preferred scheme",
        value: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
        severity: "unknown",
      },
    ];

    const ordered =
      this.settings.sort === "severity"
        ? [...facts].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
        : facts;
    const pinnedFirst = [
      ...ordered.filter((fact) => this.isPinned(fact.id)),
      ...ordered.filter((fact) => !this.isPinned(fact.id)),
    ];

    this.store.set({
      facts: pinnedFirst,
      nodeCount,
      worst: pinnedFirst.reduce<Severity>(
        (worst, fact) => (SEVERITY_RANK[fact.severity] < SEVERITY_RANK[worst] ? fact.severity : worst),
        "unknown",
      ),
      sampledAt: new Date().toISOString(),
      history: this.history,
    });
  }

  /** What the Copy button writes. Plain text, because that is what a bug report takes. */
  snapshotText(): string {
    const snapshot = this.store.peek();
    return [
      `kit-demo @ ${snapshot.sampledAt}`,
      ...snapshot.facts.map((fact) => `${fact.label}: ${fact.value} (${fact.severity})`),
    ].join("\n");
  }
}

export interface KitDemoOptions {
  id?: string;
  order?: number;
  priority?: number;
  pollMs?: number;
  injectStyles?: boolean;
  styleNonce?: string;
}

/**
 * Built once, at module scope by the caller — the object identity is the lifecycle.
 */
export function kitDemo(options: KitDemoOptions = {}): DevToolbarExtension {
  const {
    id = "kit-demo",
    order = 40,
    priority = 60,
    pollMs = 1000,
    injectStyles = true,
    styleNonce,
  } = options;
  const runtime = new KitDemoRuntime();

  return {
    id,
    label: "Kit demo",
    order,
    priority,
    compact: ({ isPanelOpen, togglePanel, styleNonce: slotNonce }) => (
      <KitDemoChip
        runtime={runtime}
        isPanelOpen={isPanelOpen}
        onToggle={togglePanel}
        injectStyles={injectStyles}
        styleNonce={resolveStyleNonce(styleNonce, slotNonce)}
      />
    ),
    panel: ({ styleNonce: slotNonce }) => (
      <KitDemoPanel
        runtime={runtime}
        injectStyles={injectStyles}
        styleNonce={resolveStyleNonce(styleNonce, slotNonce)}
      />
    ),
    commands: [
      {
        id: "kit-demo.record",
        label: "Kit demo: record the current node count",
        description: "Pushes the live DOM node count onto the recorded list.",
        run: () => runtime.record(),
      },
    ],
    diagnostics: () => runtime.store.peek(),
    start(api: ExtensionRuntimeApi) {
      runtime.hydrate(api.storage);
      runtime.sample();
      // The 250ms floor, the non-finite guard and the teardown all live in the kit.
      return createPoller(() => runtime.sample(), {
        intervalMs: pollMs,
        fallbackMs: 1000,
        signal: api.signal,
      });
    },
  };
}

interface SurfaceProps {
  runtime: KitDemoRuntime;
  injectStyles: boolean;
  styleNonce?: string;
}

/**
 * The compact slot. `ensureKitStyles` is passed straight to `useExtensionSurface`
 * because there is no extension sheet to inject alongside it.
 */
function KitDemoChip({
  runtime,
  isPanelOpen,
  onToggle,
  injectStyles,
  styleNonce,
}: SurfaceProps & { isPanelOpen: boolean; onToggle(): void }): ReactNode {
  const snapshot = useExtensionSurface(runtime.store, injectStyles, ensureKitStyles, styleNonce);
  return (
    <button
      type="button"
      data-dtb-part="trigger"
      aria-expanded={isPanelOpen}
      onClick={onToggle}
      title={`Kit demo — ${snapshot.facts.length} page facts, sampled ${snapshot.sampledAt}`}
    >
      <Chip
        label="kit"
        value={String(snapshot.nodeCount)}
        severity={snapshot.worst}
        data-dtb-part="kit-demo-chip"
        labelProps={{ "data-dtb-part": "kit-demo-label", "data-dtb-kind": "label" }}
        valueProps={{ "data-dtb-part": "kit-demo-value" }}
      />
    </button>
  );
}

function KitDemoPanel({ runtime, injectStyles, styleNonce }: SurfaceProps): ReactNode {
  const snapshot = useExtensionSurface(runtime.store, injectStyles, ensureKitStyles, styleNonce);
  const [query, setQuery] = useState("");
  // Read straight off the runtime — `getSettings()` here, `isPinned()` below — rather
  // than off the snapshot. Safe *here* only because every mutator ends in
  // `this.sample()`, which republishes through the throttled store, so this render is
  // already the one that followed the change. Copied into a runtime whose mutators do
  // not republish, the same two calls render stale.
  const settings = runtime.getSettings();
  const visible = snapshot.facts.filter((fact) =>
    matchesQuery([fact.label, fact.value, fact.severity, fact.note], query),
  );

  return (
    <div data-dtb-part="kit-demo-panel">
      {snapshot.worst === "bad" ? (
        <Banner severity="bad" role="alert" data-dtb-part="kit-demo-banner">
          Something is over its threshold. The banner is coloured by{" "}
          <code>data-dtb-severity</code> on this element, never inherited from a parent.
        </Banner>
      ) : null}

      <div data-dtb-kind="toolbar" data-dtb-part="kit-demo-toolbar">
        <SearchField
          label="Search page facts"
          placeholder={`Search ${snapshot.facts.length} facts`}
          value={query}
          onChange={setQuery}
          data-dtb-part="kit-demo-search"
        />
        <Field label="Warn above">
          <TextInput
            type="number"
            value={String(settings.nodeWarn)}
            onChange={(next) => runtime.setSettings({ nodeWarn: Number(next) || 0 })}
            size={6}
          />
        </Field>
        <Field label="Sort">
          <Select
            value={settings.sort}
            onChange={(next) =>
              runtime.setSettings({ sort: next === "severity" ? "severity" : "declared" })
            }
          >
            <option value="declared">as declared</option>
            <option value="severity">worst first</option>
          </Select>
        </Field>
        <Action onClick={() => runtime.record()} data-dtb-part="kit-demo-record">
          Record
        </Action>
      </div>

      {visible.length === 0 ? (
        <EmptyState data-dtb-part="kit-demo-empty">
          Nothing matches “{query}”.
        </EmptyState>
      ) : (
        <Rows data-dtb-part="kit-demo-rows">
          {visible.map((fact) => (
            <Row
              key={fact.id}
              label={
                <>
                  {fact.label}
                  {runtime.isPinned(fact.id) ? (
                    <Tag data-dtb-part="kit-demo-tag" title="Pinned to the top of this list.">
                      pinned
                    </Tag>
                  ) : null}
                </>
              }
              valueProps={{
                "data-dtb-part": "kit-demo-row-value",
                "data-dtb-severity": fact.severity,
                "data-dtb-fact": fact.id,
              }}
            >
              {fact.value}
              <Action
                onClick={() => runtime.togglePin(fact.id)}
                aria-label={`${runtime.isPinned(fact.id) ? "Unpin" : "Pin"} ${fact.label}`}
                data-dtb-part="kit-demo-pin"
              >
                {runtime.isPinned(fact.id) ? "Unpin" : "Pin"}
              </Action>
            </Row>
          ))}
        </Rows>
      )}

      <Note data-dtb-part="kit-demo-note">
        Recorded node counts ({snapshot.history.length}):{" "}
        {snapshot.history.length === 0 ? "none yet" : snapshot.history.join(", ")}. Pins,
        thresholds and this list survive a reload, through <code>readJson</code>/
        <code>writeJson</code> over the storage <code>start(api)</code> handed us.
      </Note>

      <div data-dtb-kind="toolbar" data-dtb-part="kit-demo-actions">
        <CopyButton
          text={() => runtime.snapshotText()}
          statusText={{
            idle: "Copies the facts above as plain text.",
            ok: `Copied — ${snapshot.facts.length} facts.`,
            failed: "Clipboard unavailable.",
          }}
          data-dtb-part="kit-demo-copy"
        >
          Copy facts
        </CopyButton>
      </div>
    </div>
  );
}
