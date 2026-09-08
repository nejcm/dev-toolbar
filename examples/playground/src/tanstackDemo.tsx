import { useEffect, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { DevToolbarExtension } from "@nejcm/dev-toolbar";
import { Chip, ensureKitStyles } from "@nejcm/dev-toolbar/kit";
import { devtoolsEventClient } from "@tanstack/devtools-client";
import { TanStackDevtools } from "@tanstack/react-devtools";
import type { TanStackDevtoolsReactPlugin } from "@tanstack/react-devtools";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import { queryClient } from "./embedDemo";

/**
 * The other TanStack recipe in docs/embedding.md: one chip that opens
 * TanStack's *own* devtools shell — the unified host for Query, Router, Form
 * and Pacer — instead of embedding a panel per tool. The shell keeps its UI,
 * its tabs, its settings and its persistence; the toolbar contributes a
 * trigger and nothing else.
 *
 * The channel is the shell's event bus. Its own trigger emits
 * `trigger-toggled { isOpen }` on `@tanstack/devtools-client` and the shell
 * listens for the same event, so an emit from outside opens or closes it, and
 * a subscription mirrors what the hotkey or the panel's close button did. The
 * bus is a global `EventTarget`, so this module's client and the shell's own
 * talk even when the bundler gives them separate instances.
 *
 * Like `embedDemo.tsx`, this is playground code: `@tanstack/*` stay
 * devDependencies of this app alone and the package never names them.
 */

/**
 * Where the shell persists its own open state. It restores that on load, and
 * announces nothing when it does, so the chip's first value has to come from
 * the same record. The key and shape are TanStack's, read defensively.
 */
const SHELL_STATE_KEY = "tanstack_devtools_state";

function readPersistedOpen(): boolean {
  try {
    const raw = window.localStorage.getItem(SHELL_STATE_KEY);
    if (raw === null) return false;
    const parsed: unknown = JSON.parse(raw);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { persistOpen?: unknown }).persistOpen === true
    );
  } catch {
    return false;
  }
}

/** The shell's open state, mirrored from its bus so a collapsed chip cannot miss a toggle. */
let shellOpen = typeof window === "undefined" ? false : readPersistedOpen();
const listeners = new Set<() => void>();

devtoolsEventClient.on("trigger-toggled", ({ payload }) => {
  shellOpen = payload.isOpen;
  for (const notify of listeners) notify();
});

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

const readOpen = () => shellOpen;
const readServerOpen = () => false;

/** Ask the shell to open or close. The shell answers on the same event, which updates `shellOpen`. */
export function toggleTanStackShell(open = !shellOpen): void {
  devtoolsEventClient.emit("trigger-toggled", { isOpen: open });
}

/**
 * Built once, at module scope: `TanStackDevtools` re-registers its plugins
 * whenever the array identity changes, and there is nothing here to change.
 */
const plugins: TanStackDevtoolsReactPlugin[] = [
  {
    id: "tanstack-query",
    name: "TanStack Query",
    // The same panel `embedDemo.tsx` hosts directly — TanStack's shell takes
    // the panel components as plugins, so nothing is written twice.
    render: <ReactQueryDevtoolsPanel client={queryClient} style={{ height: "100%" }} />,
    defaultOpen: true,
  },
];

/**
 * Mount once, beside `<DevToolbar>`. `triggerHidden` removes TanStack's own
 * floating button — the chip replaces it; the hotkey (Ctrl+~ by default)
 * keeps working. The shell docks to the bottom, TanStack's default, rising
 * from the same edge as the bar; both settings are persisted in TanStack's
 * own storage after first run, so a later change here only affects a fresh
 * browser profile.
 */
export function TanStackShell(): ReactNode {
  return (
    <TanStackDevtools config={{ triggerHidden: true, panelLocation: "bottom" }} plugins={plugins} />
  );
}

function ShellChip({ styleNonce }: { styleNonce: string | undefined }): ReactNode {
  const open = useSyncExternalStore(subscribe, readOpen, readServerOpen);
  useEffect(() => {
    ensureKitStyles(undefined, styleNonce);
  }, [styleNonce]);

  return (
    <button
      type="button"
      data-dtb-part="trigger"
      data-testid="tanstack-chip"
      aria-expanded={open}
      title="Open TanStack Devtools"
      onClick={() => toggleTanStackShell()}
    >
      <Chip label="tanstack" value={open ? "open" : "closed"} severity={open ? "ok" : undefined} />
    </button>
  );
}

/**
 * No `panel` slot: the surface it opens is TanStack's, outside the toolbar.
 * Core renders a compact-only extension as a plain bar item.
 */
export const tanstackDevtools: DevToolbarExtension = {
  id: "tanstack",
  label: "TanStack Devtools",
  order: 46,
  priority: 66,
  compact: ({ styleNonce }) => <ShellChip styleNonce={styleNonce} />,
};

/** The card that explains the chip on the page. */
export function TanStackShellCard(): ReactNode {
  return (
    <section className="pg-card">
      <h2>Open TanStack's own devtools</h2>
      <p>
        The <code>tanstack</code> chip is a remote control, not a panel. It emits the shell's own{" "}
        <code>trigger-toggled</code> event on <code>@tanstack/devtools-client</code>, and TanStack
        Devtools — mounted beside the toolbar with <code>triggerHidden</code> — opens docked to the
        top of the viewport with every TanStack tool it hosts, here the Query panel. The toolbar
        renders none of that UI. The chip mirrors the shell's state, so closing it from inside or
        with the hotkey flips the chip back to <code>closed</code>.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="pg-button"
          data-testid="tanstack-open"
          onClick={() => toggleTanStackShell(true)}
        >
          Open the shell
        </button>
        <button
          type="button"
          className="pg-button"
          data-testid="tanstack-close"
          onClick={() => toggleTanStackShell(false)}
        >
          Close the shell
        </button>
      </div>
    </section>
  );
}
