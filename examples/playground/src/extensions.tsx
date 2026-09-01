import { useState } from "react";
import type { DevToolbarExtension } from "@nejcm/dev-toolbar";
import { useToolbarCommands } from "@nejcm/dev-toolbar";
import { metrics } from "@nejcm/dev-toolbar/ext/metrics";

/**
 * Placeholder extensions with deliberately varied `priority`, so narrowing the
 * window collapses them into the `···` menu in a predictable order:
 *
 *   boom (5) → hydr (20) → metrics (35) → tw (70) → flags (80) → env (90)
 *   → user (100, aligned end)
 *
 * All of them are fake except `metrics`, which is the real
 * `@nejcm/dev-toolbar/ext/metrics` and measures the page it is running on.
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

const environment: DevToolbarExtension = {
  id: "env",
  label: "Environment",
  order: 0,
  priority: 90,
  compact: ({ isPanelOpen, openPanel, closePanel }) => (
    <Chip
      label="env"
      value="staging"
      tone="ok"
      expanded={isPanelOpen}
      onClick={() => (isPanelOpen ? closePanel() : openPanel())}
    />
  ),
  panel: () => <EnvironmentPanel />,
  commands: [
    {
      id: "env.copy",
      label: "Copy environment summary",
      run: () => console.info("[playground] copied environment summary"),
    },
  ],
};

function EnvironmentPanel() {
  const commands = useToolbarCommands();
  return (
    <Definition>
      <strong>Environment</strong>
      <p style={{ margin: 0, color: "var(--dtb-muted)" }}>
        A panel is just a render function. Core owns the single-active-panel
        invariant, the resize handle and the persisted height; what is inside is
        entirely the extension's business.
      </p>
      <strong style={{ marginTop: 8 }}>
        Commands core has aggregated ({commands.length})
      </strong>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {commands.map((command) => (
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
  environment,
  flags,
  runtimeMetrics,
  hydration,
  tailwind,
  broken,
  user,
];
