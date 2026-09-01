import { useState } from "react";
import type { DevToolbarExtension } from "@nejcm/dev-toolbar";
import { useToolbarCommands } from "@nejcm/dev-toolbar";
import { metrics } from "@nejcm/dev-toolbar/ext/metrics";
import { environment } from "@nejcm/dev-toolbar/ext/environment";

/**
 * Placeholder extensions with deliberately varied `priority`, so narrowing the
 * window collapses them into the `···` menu in a predictable order:
 *
 *   boom (5) → hydr (20) → metrics (35) → tw (70) → flags (80) → cmds (85)
 *   → env (90) → user (100, aligned end)
 *
 * The fake ones are the placeholders; `metrics` and `env` are the real
 * `@nejcm/dev-toolbar/ext/metrics` and `.../ext/environment`.
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
  return (
    <Definition>
      <strong>Commands core has aggregated ({commandList.length})</strong>
      <p style={{ margin: 0, color: "var(--dtb-muted)" }}>
        Core aggregates every extension's commands and renders no palette. The
        environment entries here copy the same redacted snapshot the panel
        shows.
      </p>
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

const flags: DevToolbarExtension = {
  id: "flags",
  label: "Flags",
  order: 10,
  priority: 80,
  keepMounted: true,
  compact: ({ isPanelOpen, openPanel, closePanel }) => (
    <Chip
      label="flags"
      value="3 on"
      tone="neutral"
      expanded={isPanelOpen}
      onClick={() => (isPanelOpen ? closePanel() : openPanel())}
    />
  ),
  panel: () => <FlagsPanel />,
  commands: [
    {
      id: "flags.reset",
      label: "Reset flag overrides",
      run: () => console.info("[playground] flag overrides reset"),
    },
  ],
};

function FlagsPanel() {
  // `keepMounted: true` — this counter survives closing and reopening the panel.
  const [renders, setRenders] = useState(0);
  return (
    <Definition>
      <strong>Flags (keepMounted)</strong>
      <p style={{ margin: 0, color: "var(--dtb-muted)" }}>
        This panel opts into <code>keepMounted</code>, so its state survives a
        close. Bump the counter, close the panel, reopen it.
      </p>
      <button
        type="button"
        data-dtb-part="trigger"
        onClick={() => setRenders((value) => value + 1)}
      >
        counter: {renders}
      </button>
    </Definition>
  );
}

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
const runtimeMetrics = metrics({
  order: 30,
  priority: 35,
  network: { slowMs: 400 },
  jank: { windowMs: 5000 },
});

export const playgroundExtensions: DevToolbarExtension[] = [
  runtimeEnvironment,
  commands,
  flags,
  runtimeMetrics,
  hydration,
  tailwind,
  broken,
  user,
];
