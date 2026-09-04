import { useState } from "react";
import type { DevToolbarExtension } from "@nejcm/dev-toolbar";
import { useDevToolbar, useToolbarCommands } from "@nejcm/dev-toolbar";
import { metrics } from "@nejcm/dev-toolbar/ext/metrics";
import { environment } from "@nejcm/dev-toolbar/ext/environment";
import { flags, readStoredOverrides } from "@nejcm/dev-toolbar/ext/flags";
import { commandMenu } from "@nejcm/dev-toolbar/ext/command-menu";
import { overlays } from "@nejcm/dev-toolbar/ext/overlays";
import { diagnostics } from "@nejcm/dev-toolbar/ext/diagnostics";
import { themeEditor } from "@nejcm/dev-toolbar/ext/theme-editor";
import { agentBridge } from "@nejcm/dev-toolbar/ext/agent";
import type { DesignTokenDefinition } from "@nejcm/dev-toolbar/ext/theme-editor";
import type { FlagReading, FlagValue } from "@nejcm/dev-toolbar/ext/flags";

/**
 * Deliberately varied `priority` so narrowing the window collapses extensions into `⋮` in order:
 * agent (-1) → boom (5) → diagnostics (10) → hydr (20) → metrics (35) → overlays (55) → tw (70)
 * → flags (80) → cmds (85) → env (90) → user (100, aligned end). The agent bridge goes first by
 * design: it is a transport, and nothing is lost when its chip collapses.
 * metrics/env/flags are the real extensions; the rest are placeholders.
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
 * The real `@nejcm/dev-toolbar/ext/environment`, driven by a getter so the playground can flip
 * impersonation/sync status at runtime and watch the chip react.
 *
 * The context deliberately carries four things that must never reach the screen or clipboard as
 * typed: an email, a token in a query string, `extra.authToken`, and a `refreshToken` nested
 * inside `extra.identity` (innocent key name, so only a redactor that walks the object finds it).
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
          // Nested case: redact() only finds refreshToken by walking the object unserialised.
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
      <p style={{ margin: 0, color: "var(--dtb-muted)" }}>
        A command that declares <code>input</code> (contract v2) needs a form
        this panel does not have, so it is listed and disabled rather than
        offered — pressing it with no input is a guaranteed throw, and{" "}
        <code>void command.run()</code> would swallow that into an unhandled
        rejection. <code>/ext/command-menu</code> skips these for the same
        reason; <code>/ext/agent</code> is the one that can supply input.
      </p>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {commandList.map((command) => (
          <li key={command.id}>
            <button
              type="button"
              data-dtb-part="trigger"
              disabled={command.input !== undefined}
              title={
                command.input === undefined
                  ? command.description
                  : `Takes input (${Object.keys(command.input.fields).join(", ")}) — run it through /ext/agent`
              }
              onClick={() => {
                // `Promise.resolve(...)` inside the `try`, so a synchronous
                // throw and a rejection both land in the same place. A bare
                // `void command.run()` reports neither.
                try {
                  Promise.resolve(command.run()).catch((error: unknown) => {
                    console.error(`[playground] ${command.id} rejected`, error);
                  });
                } catch (error) {
                  console.error(`[playground] ${command.id} threw`, error);
                }
              }}
            >
              {command.label}
              {command.input === undefined ? "" : " (needs input)"}
            </button>
          </li>
        ))}
      </ul>
    </Definition>
  );
}

// The real @nejcm/dev-toolbar/ext/flags, over a fake flag backend.

/**
 * The application's own flag state, standing in for a real provider. `base` is what the app
 * resolves on its own; `overrides` is where the toolbar's overrides land, and the app reads
 * `overrides ?? base`. Keeping them separate lets the extension show both values side by side.
 */
const flagBase: Record<string, FlagValue> = {
  "ui-facelift": false,
  "new-header": true,
  "checkout.copy": "classic",
  "search.rank": 2,
  "billing.tier": "standard",
  // Credential-shaped key on purpose: must never render or copy as typed.
  "checkout.apiToken": "tok-live-abcdef123456",
};

/** Seeded from storage before first paint, so the app doesn't flash un-overridden values on reload. */
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
  /** Adds a flag after the toolbar has mounted — its toggle command shows up in the palette on next open, no reload needed. */
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
    reloadBehavior: "full-reload", // read once at boot, so an override needs a reload
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
      // Base value, before overrides — lets the panel show both side by side.
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

/** Shadow DOM regression test: classes come from the Tailwind Play CDN in `document.head`, which only applies because the bar renders in the light DOM. */
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
 * The real `@nejcm/dev-toolbar/ext/command-menu`. It contributes no commands of its own — it
 * only reads the aggregation — and its surface is the `overlay` slot, so `⌘K` keeps working
 * when its chip collapses into `⋮`.
 */
const runtimeCommandMenu = commandMenu();

/**
 * The real `@nejcm/dev-toolbar/ext/overlays`, drawing from the `overlay` slot below the bar and
 * above the app with no pointer events. The grid below matches the playground's own card layout
 * (12/24/1100) so "Column grid" has something real to line up with.
 */
const runtimeOverlays = overlays({
  order: 20,
  priority: 55,
  grid: { columns: 12, gutter: 24, maxWidth: 1100, baseline: 8 },
});

/**
 * The real `@nejcm/dev-toolbar/ext/diagnostics`. It contributes nothing to the aggregation —
 * it *reads* it, showing metrics'/environment's/flags' own `diagnostics()` output plus page
 * facts. `app`/`source` below deliberately carry credentials three ways: a matched key
 * (`sessionToken`), a matched value under an innocent key (`Bearer …`), and a token nested
 * under innocent-looking keys (`billing.identity.refreshToken`). None may leak to the panel,
 * clipboard, or downloaded file.
 */
const runtimeDiagnostics = diagnostics({
  order: 5,
  priority: 10,
  app: () => ({
    release: "web-2026.08.28.4",
    commit: "a84c7e1",
    environment: "staging",
    sessionToken: "sess-playground-secret",
    note: "Bearer playground-bearer-secret",
    workspaceId: "ws_456",
  }),
  sources: [
    {
      id: "router",
      label: "Router",
      read: () => ({
        route: "/playground",
        billing: { identity: { refreshToken: "rt-playground-secret" } },
      }),
    },
    {
      id: "broken-source",
      label: "A source that cannot be read",
      read: () => {
        throw new Error("playground: this source is deliberately broken");
      },
    },
  ],
});

// The real @nejcm/dev-toolbar/ext/theme-editor, over the page's own tokens.

/**
 * The token catalogue. Every name is a custom property `playground.css` actually declares and
 * consumes — edit `--pg-radius` and the cards round off, edit `--pg-brand` and tiles/links/buttons
 * follow. Four exist to exercise a rule rather than to be pretty:
 * - `--dtb-accent`: the toolbar's own token, **refused** — writing it to `:root` would restyle
 *   the bar instead of the app, and the row says so rather than silently disappearing.
 * - `--pg-session-panel-bg`: normalises to a `redact()`-sensitive key but is a **colour**, so it
 *   stays readable (a colour can't carry a credential).
 * - `--pg-font-license-token`: a credential-shaped **string**, masked in the panel and every
 *   export; the mask never round-trips back through the input.
 * - `--pg-font-scale`: a **number**, so `parseValue`'s refusal is reachable — type `big` and the
 *   row says "not a number" instead of zeroing the page's font size.
 */
const PLAYGROUND_TOKENS: DesignTokenDefinition[] = [
  {
    name: "--pg-brand",
    label: "Brand",
    group: "Colour",
    type: "color",
    defaultValue: "#5e6ad2",
    description: "Links, tile gradients, button focus.",
  },
  {
    name: "--pg-brand-contrast",
    label: "Brand contrast",
    group: "Colour",
    type: "color",
    defaultValue: "#ffffff",
  },
  { name: "--pg-bg", label: "Page background", group: "Colour", type: "color" },
  { name: "--pg-card", label: "Card surface", group: "Colour", type: "color" },
  { name: "--pg-fg", label: "Text", group: "Colour", type: "color" },
  { name: "--pg-muted", label: "Muted text", group: "Colour", type: "color" },
  { name: "--pg-border", label: "Border", group: "Colour", type: "color" },
  {
    name: "--pg-tile-accent",
    label: "Tile accent",
    group: "Colour",
    type: "color",
  },
  {
    name: "--pg-session-panel-bg",
    label: "Session panel",
    group: "Colour",
    type: "color",
    description:
      "Key-matched by redact() and left readable anyway — a colour cannot carry a credential.",
  },
  {
    name: "--pg-radius",
    label: "Corner radius",
    group: "Shape",
    type: "length",
    defaultValue: "10px",
  },
  {
    name: "--pg-space",
    label: "Card spacing",
    group: "Shape",
    type: "length",
    defaultValue: "16px",
  },
  {
    name: "--pg-font-scale",
    label: "Type scale",
    group: "Type",
    type: "number",
    defaultValue: "1",
    description: "Multiplies the body font size. Try 1.15; try `big`.",
  },
  {
    name: "--pg-font-license-token",
    label: "Font licence",
    group: "Type",
    type: "string",
    description: "A string token whose name is credential-shaped. Masked.",
  },
  {
    name: "--dtb-accent",
    label: "Toolbar accent (refused)",
    group: "Refused",
    type: "color",
    description:
      "The toolbar's own token. Never written — restyle the bar from your own stylesheet instead.",
  },
];

const runtimeThemeEditor = themeEditor({
  order: 15,
  priority: 45,
  tokens: PLAYGROUND_TOKENS,
  createdBy: "playground",
  // Subtree selection: the whole app, or just the demo card.
  surfaces: [
    { id: "root", label: "Whole application (:root)", selector: ":root" },
    { id: "demo", label: "Just the demo card", selector: ".pg-theme-demo" },
  ],
  // Presets are computed by the consumer — the extension owns no colour model;
  // a preset is a plain recipe, the same shape Import accepts.
  presets: [
    {
      schemaVersion: 1,
      name: "Warm",
      mode: "light",
      surface: "root",
      overrides: {
        "--pg-brand": "#d9480f",
        "--pg-tile-accent": "#ffe8cc",
        "--pg-radius": "14px",
      },
      createdAt: "2026-08-28T10:04:00.000Z",
    },
    {
      schemaVersion: 1,
      name: "Sharp",
      mode: "light",
      surface: "root",
      overrides: { "--pg-radius": "0px", "--pg-space": "10px" },
      createdAt: "2026-08-28T10:04:00.000Z",
    },
  ],
  // The app's own colour mode — the extension has no idea what a mode is.
  mode: {
    // Falls back to the media query rather than assuming "light": an unset
    // attribute means "follow the system", so a recorded recipe reflects reality.
    read: () => {
      const chosen = document.documentElement.dataset["pgMode"];
      if (chosen === "dark" || chosen === "light") return chosen;
      return window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    },
    set: (next) => {
      document.documentElement.dataset["pgMode"] = next;
    },
  },
});

/** Built once at module scope — calling `metrics()` inside a component would hand the bar a new object every render while collectors stayed with the first one; core warns about this. */
const runtimeMetrics = metrics({
  order: 30,
  priority: 35,
  network: { slowMs: 400 },
  jank: { windowMs: 5000 },
});

/**
 * The real `@nejcm/dev-toolbar/ext/agent`. It publishes this instance's commands and
 * diagnostics at `window.__DEV_TOOLBAR__.instances["playground"]`, which is how a browser
 * agent reads toolbar state and invokes a command by id instead of scraping the DOM and
 * clicking coordinates.
 *
 * `allowRun: true` here and nowhere by default: the playground is a development build whose
 * whole purpose is to be driven, and `runCommand` is arbitrary effect for any script on the
 * page. `instanceId` repeats what `<App>` passes `<DevToolbar>` — the contract hands
 * `start(api)` no instance identity.
 */
const runtimeAgent = agentBridge({
  instanceId: "playground",
  allowRun: true,
  // Phase 3: the same snapshot, pushed to the dev server so an agent that
  // never loads this page can `curl localhost:5273/__dev-toolbar/state`. The
  // receiving half is `plugins/devToolbarAgent.ts`. Gated on `import.meta.env.DEV`
  // because a production `vite build` has no middleware to answer it — the
  // reporter would post into the void and warn once.
  ...(import.meta.env.DEV ? { report: { url: "/__dev-toolbar/state" } } : {}),
});

export const playgroundExtensions: DevToolbarExtension[] = [
  runtimeAgent,
  runtimeCommandMenu,
  runtimeDiagnostics,
  runtimeEnvironment,
  commands,
  runtimeFlags,
  runtimeOverlays,
  runtimeThemeEditor,
  runtimeMetrics,
  hydration,
  tailwind,
  broken,
  user,
];
