import { useState } from "react";
import type { DevToolbarExtension } from "@nejcm/dev-toolbar";
import { useDevToolbar, useToolbarCommands } from "@nejcm/dev-toolbar";
import { metrics } from "@nejcm/dev-toolbar/ext/metrics";
import { environment } from "@nejcm/dev-toolbar/ext/environment";
import { flags, readStoredOverrides } from "@nejcm/dev-toolbar/ext/flags";
import { commandMenu } from "@nejcm/dev-toolbar/ext/command-menu";
import { overlays } from "@nejcm/dev-toolbar/ext/overlays";
import type { FlagReading, FlagValue } from "@nejcm/dev-toolbar/ext/flags";

/**
 * Placeholder extensions with deliberately varied `priority`, so narrowing the
 * window collapses them into the `···` menu in a predictable order:
 *
 *   boom (5) → hydr (20) → metrics (35) → overlays (55) → tw (70) → flags (80)
 *   → cmds (85) → env (90) → user (100, aligned end)
 *
 * The fake ones are the placeholders; `metrics`, `env` and `flags` are the real
 * `@nejcm/dev-toolbar/ext/metrics`, `.../ext/environment` and `.../ext/flags`.
 */

function Chip({
  label,
  value,
  tone = "neutral",
  onClick,
  expanded,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "warn" | "error";
  onClick?: () => void;
  expanded?: boolean;
}) {
  const color = {
    neutral: "var(--dtb-muted)",
    ok: "#3fa96b",
    warn: "#c8971f",
    error: "var(--dtb-danger)",
  }[tone];

  return (
    <button
      type="button"
      data-dtb-part="trigger"
      aria-expanded={expanded ?? false}
      onClick={onClick}
      title={`${label} — playground placeholder`}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: color,
          display: "inline-block",
        }}
      />
      <span style={{ color: "var(--dtb-muted)" }}>{label}</span>
      <span style={{ fontFamily: "var(--dtb-font-mono)" }}>{value}</span>
    </button>
  );
}

function Definition({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 6, maxWidth: 640 }}>{children}</div>
  );
}

/**
 * The real `@nejcm/dev-toolbar/ext/environment`, driven by a getter so the
 * playground can flip impersonation and the sync status at runtime and watch
 * the chip react.
 *
 * The context deliberately contains four things that must never reach the
 * screen or the clipboard as typed: an email address, an API endpoint with a
 * token in its query string, an `extra` key called `authToken`, and a
 * `refreshToken` nested one level down inside `extra.identity` — whose own key is innocent,
 * so only a redactor that walks the object finds it.
 */
export const playgroundContext = {
  impersonating: false,
  syncStatus: "connected",
  supply: true,
};

const runtimeEnvironment = environment({
  order: 0,
  priority: 90,
  pollMs: 500,
  context: () =>
    playgroundContext.supply
      ? {
          environment: "staging",
          release: "web-2026.08.28.4",
          commit: "a84c7e1",
          branch: "feat/shell-architecture",
          deployment: "dpl_9f2c1",
          region: "ap-southeast-1",
          apiEndpoint: "https://api.example.com/v2?access_token=super-secret",
          builtAt: "2026-08-28T10:04:00.000Z",
          userId: "nejc.mursic@example.com",
          workspaceId: "ws_456",
          internal: true,
          impersonating: playgroundContext.impersonating
            ? { actor: "staff_1", subject: "usr_123" }
            : false,
          roles: ["admin", "support"],
          syncStatus: playgroundContext.syncStatus,
          // The nested one is the interesting case: `redact()` only finds
          // `refreshToken` if it walks the object, which means the object must
          // reach it unserialised.
          extra: {
            authToken: "abcdef123456",
            bundler: "vite",
            identity: {
              email: "nejc.mursic@example.com",
              refreshToken: "rt-nested-secret",
            },
          },
        }
      : {},
});

/** Kept from the placeholder set: it is the only demo of command aggregation. */
const commands: DevToolbarExtension = {
  id: "cmds",
  label: "Commands",
  order: 5,
  priority: 85,
  compact: ({ isPanelOpen, togglePanel }) => (
    <Chip
      label="cmds"
      value="aggregated"
      tone="neutral"
      expanded={isPanelOpen}
      onClick={togglePanel}
    />
  ),
  panel: () => <CommandsPanel />,
};

function CommandsPanel() {
  const commandList = useToolbarCommands();
  const { getCommands } = useDevToolbar();
  const [live, setLive] = useState<number | null>(null);
  return (
    <Definition>
      <strong>Commands core has aggregated ({commandList.length})</strong>
      <p style={{ margin: 0, color: "var(--dtb-muted)" }}>
        Core aggregates every extension's commands and renders no palette —{" "}
        <code>⌘K</code> is <code>/ext/command-menu</code>, an ordinary
        extension. This list is the declarative snapshot, recomputed when the
        extension list changes. <code>getCommands()</code> re-enumerates now,
        which is how the palette sees a flag that was added after mount.
      </p>
      <button
        type="button"
        data-dtb-part="trigger"
        onClick={() => setLive(getCommands().length)}
      >
        Re-enumerate{live === null ? "" : ` — ${live} right now`}
      </button>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {commandList.map((command) => (
          <li key={command.id}>
            <button
              type="button"
              data-dtb-part="trigger"
              onClick={() => void command.run()}
            >
              {command.label}
            </button>
          </li>
        ))}
      </ul>
    </Definition>
  );
}

/* -------------------------------------------------------------------------- */
/* The real @nejcm/dev-toolbar/ext/flags, over a fake flag backend.             */
/* -------------------------------------------------------------------------- */

/**
 * The application's own flag state — a stand-in for whatever provider a real
 * app uses. `base` is what the app resolves on its own; `overrides` is where
 * the toolbar's overrides land, and the app reads `overrides ?? base`.
 *
 * Keeping them in two maps is the whole integration contract: the extension
 * needs the value *before* the override to be able to show both, and §3C's
 * precedence table puts the local override on top of it.
 */
const flagBase: Record<string, FlagValue> = {
  "ui-facelift": false,
  "new-header": true,
  "checkout.copy": "classic",
  "search.rank": 2,
  "billing.tier": "standard",
  // A flag whose key is credential-shaped on purpose: it must never render or
  // copy as typed, in the panel or through a command.
  "checkout.apiToken": "tok-live-abcdef123456",
};

/**
 * Seeded from storage *before the first paint*, which is the point of
 * `readStoredOverrides()`: the extension re-applies overrides in `start()`,
 * inside an effect, so without this the app would render one frame with the
 * un-overridden values after every reload.
 */
const flagOverrides: Record<string, FlagValue> = readStoredOverrides({
  instanceId: "playground",
});

const flagListeners = new Set<() => void>();

export const playgroundFlags = {
  read: (key: string): FlagValue =>
    Object.prototype.hasOwnProperty.call(flagOverrides, key)
      ? (flagOverrides[key] as FlagValue)
      : (flagBase[key] as FlagValue),
  base: (key: string): FlagValue => flagBase[key] as FlagValue,
  keys: () => Object.keys(flagBase),
  overridden: (key: string) =>
    Object.prototype.hasOwnProperty.call(flagOverrides, key),
  subscribe(listener: () => void) {
    flagListeners.add(listener);
    return () => flagListeners.delete(listener);
  },
  /** Flips a base value, so you can watch a *server* change under an override. */
  flipBase(key: string) {
    flagBase[key] = !(flagBase[key] === true);
    flagListeners.forEach((listener) => listener());
  },
  /**
   * Adds a flag to the catalogue *after* the toolbar has mounted.
   *
   * This is the P2c contract change made visible: `commands` is a function
   * core calls on each aggregation pass, so the new flag's toggle command shows
   * up in the palette on the next open. It used to need a page reload.
   */
  addFlag(key: string) {
    if (Object.prototype.hasOwnProperty.call(flagBase, key)) return;
    flagBase[key] = false;
    CATALOGUE.push({
      key,
      label: `Runtime flag: ${key}`,
      description: "Added after mount, from the page.",
      type: "boolean",
      defaultValue: false,
    });
    flagListeners.forEach((listener) => listener());
  },
  /** Set on the window by App, so the adapter can be made to throw on demand. */
  breakAdapter: false,
};

const CATALOGUE: Omit<FlagReading, "value">[] = [
  {
    key: "ui-facelift",
    label: "UI Facelift 2026",
    description: "The 2026 shell redesign, behind a migration flag.",
    owner: "design-systems",
    type: "boolean",
    defaultValue: false,
    projectUrl: "https://example.com/projects/facelift",
  },
  {
    key: "new-header",
    label: "New header",
    owner: "growth",
    type: "boolean",
    defaultValue: false,
    expiresAt: "2026-01-01",
  },
  {
    key: "checkout.copy",
    label: "Checkout copy",
    type: "variant",
    variants: ["classic", "urgent", "friendly"],
    defaultValue: "classic",
  },
  {
    key: "search.rank",
    label: "Search ranking version",
    type: "number",
    defaultValue: 1,
    // Read once at boot in this pretend app, so an override needs a reload.
    reloadBehavior: "full-reload",
  },
  { key: "billing.tier", label: "Billing tier", type: "string", defaultValue: "standard" },
  { key: "checkout.apiToken", label: "Checkout API token", type: "string" },
];

const runtimeFlags = flags({
  order: 10,
  priority: 80,
  pollMs: 400,
  flags: () =>
    CATALOGUE.map((definition) => ({
      ...definition,
      // BEFORE the toolbar's overrides — that is what makes the panel able to
      // show the application's own value next to the override.
      value: flagBase[definition.key],
      source: "server-rule" as const,
    })),
  onOverride: (key, value) => {
    if (playgroundFlags.breakAdapter) {
      throw new Error("playground: the flag provider is offline");
    }
    if (value === undefined) delete flagOverrides[key];
    else flagOverrides[key] = value;
    flagListeners.forEach((listener) => listener());
  },
  promoted: {
    flagKey: "ui-facelift",
    label: "UI Facelift 2026",
    icon: "\u25c8",
  },
});

const hydration: DevToolbarExtension = {
  id: "hydr",
  label: "Hydration",
  order: 50,
  priority: 20,
  compact: () => <Chip label="hydr" value="NA" tone="neutral" />,
};

/**
 * The Shadow DOM regression test. Every class here comes from the Tailwind Play
 * CDN, whose rules live in `document.head`. The bar renders in the light DOM, so
 * they apply; inside a shadow root this item would render unstyled.
 */
const tailwind: DevToolbarExtension = {
  id: "tw",
  label: "Tailwind",
  order: 60,
  priority: 70,
  compact: ({ isPanelOpen, openPanel, closePanel }) => (
    <button
      type="button"
      data-testid="tw-chip"
      onClick={() => (isPanelOpen ? closePanel() : openPanel())}
      className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-sky-500 to-indigo-500 px-2.5 py-0.5 text-[11px] font-semibold text-white shadow-sm ring-1 ring-inset ring-white/20 transition hover:from-sky-400 hover:to-indigo-400"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-white/90" />
      tailwind
    </button>
  ),
  panel: () => (
    <div className="max-w-xl space-y-2 rounded-lg border border-slate-300 bg-slate-50 p-3 text-slate-800">
      <h3 className="text-sm font-semibold tracking-tight">
        Tailwind renders inside the bar
      </h3>
      <p className="text-xs leading-relaxed text-slate-600">
        Utility classes resolve from the document stylesheet. This is exactly
        what a Shadow DOM boundary would break, which is why the shell is light
        DOM with its own <code className="font-mono">@layer</code>.
      </p>
      <div className="flex gap-2">
        <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
          ok
        </span>
        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
          warn
        </span>
        <span className="rounded bg-rose-100 px-2 py-0.5 text-xs text-rose-800">
          error
        </span>
      </div>
    </div>
  ),
};

/** Deliberately broken. Should degrade to a single error chip and nothing else. */
const broken: DevToolbarExtension = {
  id: "boom",
  label: "Boom",
  order: 70,
  priority: 5,
  compact: () => {
    throw new Error("playground: this extension is deliberately broken");
  },
  panel: () => {
    throw new Error("playground: and its panel throws too");
  },
};

const user: DevToolbarExtension = {
  id: "user",
  label: "User",
  align: "end",
  order: 0,
  priority: 100,
  compact: () => <Chip label="user" value="internal" tone="neutral" />,
};

/**
 * The real thing, from `@nejcm/dev-toolbar/ext/metrics`. It replaces the fake
 * `delay` / `jank` / `net` chips this file used to ship.
 *
 * Built ONCE, at module scope. Calling `metrics()` inside a component would
 * hand the bar a new object on every render while the running collectors stayed
 * with the first one — core warns about exactly that.
 */
/**
 * The real `@nejcm/dev-toolbar/ext/command-menu`. It contributes no commands of
 * its own — it is the only extension here that reads the aggregation instead of
 * adding to it — and its surface is the `overlay` slot, so `⌘K` keeps working
 * when its chip collapses into the `···` menu.
 */
const runtimeCommandMenu = commandMenu();

/**
 * The real `@nejcm/dev-toolbar/ext/overlays`. It draws over this page from the
 * `overlay` slot, below the bar and above the app, and takes no pointer events
 * — every button under an overlay still works. The grid below is deliberately
 * the same 12/24/1100 the playground's own cards are laid out on, so "Column
 * grid" has something true to line up with.
 */
const runtimeOverlays = overlays({
  order: 20,
  priority: 55,
  grid: { columns: 12, gutter: 24, maxWidth: 1100, baseline: 8 },
});

const runtimeMetrics = metrics({
  order: 30,
  priority: 35,
  network: { slowMs: 400 },
  jank: { windowMs: 5000 },
});

export const playgroundExtensions: DevToolbarExtension[] = [
  runtimeCommandMenu,
  runtimeEnvironment,
  commands,
  runtimeFlags,
  runtimeOverlays,
  runtimeMetrics,
  hydration,
  tailwind,
  broken,
  user,
];
