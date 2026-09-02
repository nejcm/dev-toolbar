/**
 * `<StrictMode>` double-invokes renders and mount effects in development, and
 * `docs/architecture.md` §8 records that the Next verification ran with
 * `reactStrictMode: true`. Nothing pinned that, so this file does.
 *
 * Two shapes of bug are in scope. First, a lifecycle that leaks: `start()` runs
 * twice under the double-invoked effect and must be balanced by exactly one
 * teardown, leaving one live run. Second, render-time bookkeeping — the
 * `openedRef` mutation in `PanelHost.tsx` and the `extensionsRef` write in
 * `DevToolbar.tsx` — which a doubled render is precisely the thing that
 * exposes.
 */
import { StrictMode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { CONTRACT_VERSION } from "../contract";
import type { DevToolbarExtension, ExtensionRuntimeApi } from "../contract";
import { DevToolbar } from "../DevToolbar";
import { isApplePlatform } from "../shortcut";
import { createMemoryStorage } from "../storage";

const strict = (extensions: readonly DevToolbarExtension[], props = {}) =>
  render(
    <StrictMode>
      <DevToolbar
        instanceId="strict"
        storage={createMemoryStorage()}
        extensions={extensions}
        {...props}
      >
        <main data-testid="app">app</main>
      </DevToolbar>
    </StrictMode>,
  );

/** The default toggle chord for whichever platform the test host reports. */
const fireToggleShortcut = () =>
  fireEvent.keyDown(window, {
    key: ".",
    code: "Period",
    shiftKey: true,
    ...(isApplePlatform() ? { metaKey: true } : { ctrlKey: true }),
  });

const panelIds = (selector = '[data-dtb-part="panel"]') =>
  [...document.querySelectorAll(selector)].map((node) => (node as HTMLElement).dataset["dtbExtId"]);

let warn: Mock<typeof console.warn>;
let error: Mock<typeof console.error>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
});

describe("DevToolbar under StrictMode", () => {
  it("renders exactly one bar, not two", () => {
    strict([{ id: "a", label: "A", compact: () => <span>a</span> }]);

    expect(document.querySelectorAll("[data-dev-toolbar]").length).toBe(1);
    expect(document.querySelectorAll('[data-dtb-part="bar"]').length).toBe(1);
    expect(document.querySelectorAll('[data-dtb-part="item"]').length).toBe(1);
    expect(screen.getByTestId("app")).toBeTruthy();
  });

  it("balances the double-invoked mount effect: start, dispose, start", () => {
    const signals: AbortSignal[] = [];
    const dispose = vi.fn();
    const start = vi.fn((api: ExtensionRuntimeApi) => {
      signals.push(api.signal);
      return dispose;
    });

    const view = strict([{ id: "live", label: "Live", start }]);

    // The StrictMode remount, not a leak: the first run was torn down before
    // the second began, so exactly one run is live.
    expect(start).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);

    view.unmount();
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(signals[1]!.aborted).toBe(true);
  });

  it("leaves one visibility subscription live when start returns its unsubscribe", () => {
    const seen: boolean[] = [];
    const start = (api: ExtensionRuntimeApi) => api.subscribeVisibility((v) => seen.push(v));

    strict([{ id: "live", label: "Live", start }]);
    fireToggleShortcut();

    // One entry, not one per StrictMode pass: the torn-down run's cleanup was
    // the unsubscribe, so only the surviving run still hears the change.
    expect(seen).toEqual([false]);
  });

  it("doubles the callbacks of an extension that relies on api.signal alone", () => {
    // Pinning current behaviour, not specifying it. `subscribeVisibility`
    // returns an unsubscribe and nothing in `contract.ts` promises that
    // aborting `api.signal` revokes the subscription — so an extension that
    // keeps only the signal is subscribed once per StrictMode pass and hears
    // every change twice. The idiomatic pattern above is the one that works;
    // this test exists so that a change in either direction is noticed.
    const seen: boolean[] = [];
    const start = (api: ExtensionRuntimeApi) => {
      api.subscribeVisibility((visible) => seen.push(visible));
      return () => {};
    };

    strict([{ id: "leaky", label: "Leaky", start }]);
    fireToggleShortcut();

    expect(seen).toEqual([false, false]);
  });

  it("still warns only once per id about a contract mismatch", () => {
    strict([{ id: "old", label: "Old", contractVersion: CONTRACT_VERSION + 1 }]);

    const messages = warn.mock.calls.map((call) => String(call[0]));
    expect(messages.filter((message) => message.includes('"old"')).length).toBe(1);
  });

  it("keeps the render-time openedRef bookkeeping in PanelHost correct", () => {
    // `opened` is mutated during render, which under StrictMode happens twice
    // per commit. The `keepMounted` decision it feeds must be unchanged by
    // that: the panel mounts once, and stays mounted once after closing.
    const extensions: DevToolbarExtension[] = [
      {
        id: "sticky",
        label: "Sticky",
        keepMounted: true,
        compact: ({ togglePanel }) => (
          <button type="button" onClick={togglePanel}>
            sticky
          </button>
        ),
        panel: () => <div data-testid="sticky-panel">panel</div>,
      },
    ];

    strict(extensions);
    expect(panelIds()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "sticky" }));
    expect(panelIds()).toEqual(["sticky"]);
    expect(screen.getAllByTestId("sticky-panel").length).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "sticky" }));
    // Closed but kept mounted, exactly once.
    expect(panelIds()).toEqual(["sticky"]);
    expect(panelIds('[data-dtb-part="panel"]:not([hidden])')).toEqual([]);
  });

  it("keeps getCommands() current despite the doubled render-time ref write", () => {
    // `extensionsRef.current` is written in render. A doubled render must not
    // leave the imperative aggregation reading a stale list.
    let api: ExtensionRuntimeApi | null = null;
    const base: DevToolbarExtension = {
      id: "a",
      label: "A",
      commands: [{ id: "a.run", label: "Run", run: () => {} }],
      start: (received) => {
        api = received;
        return () => {};
      },
    };

    // One adapter across both renders, so the rerender varies only
    // `extensions` — a fresh adapter would be a second independent variable.
    const storage = createMemoryStorage();
    const view = strict([base], { storage });
    expect(api!.getCommands().map((command) => command.id)).toEqual(["a.run"]);

    view.rerender(
      <StrictMode>
        <DevToolbar
          instanceId="strict"
          storage={storage}
          extensions={[
            base,
            { id: "b", label: "B", commands: [{ id: "b.run", label: "Run", run: () => {} }] },
          ]}
        >
          <main data-testid="app">app</main>
        </DevToolbar>
      </StrictMode>,
    );

    expect(api!.getCommands().map((command) => command.id)).toEqual(["a.run", "b.run"]);
    expect(error).not.toHaveBeenCalled();
  });
});
