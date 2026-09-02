// @vitest-environment node
/**
 * SSR safety, in an environment that genuinely has no DOM.
 *
 * `docs/architecture.md` §8 promises the bar never appears in server HTML, and
 * says so on the strength of a by-hand check in a Next app. This file is the
 * automated half. The `node` environment above is load-bearing: there is no
 * `window`, no `document` and no `localStorage`, so any unguarded access
 * during the server render is a `ReferenceError` rather than something a mock
 * quietly absorbs. `vitest.setup.ts` skips its jsdom fixtures here for the
 * same reason.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { DevToolbar } from "../DevToolbar";
import { DevToolbarInset } from "../DevToolbarInset";
import type { DevToolbarExtension, ExtensionRuntimeApi } from "../contract";

/**
 * What `vitest.setup.ts` left behind, read before the line below replaces it.
 * The setup skips its jsdom fixtures here, so this must be `undefined`: the
 * assertion is in `really is running without a DOM`.
 */
const shimmedLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage")?.value;

/**
 * A real Node server has no `localStorage` at all. Node's own is a lazy getter
 * that prints an ExperimentalWarning the first time anything reads it — and
 * `createLocalStorage()` reads it on every render that passes no `storage`
 * prop, which is most of this file. Shadowing it with a plain absent value is
 * both faithful to the environment being emulated and the thing that keeps the
 * warning out of every run's log.
 */
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: undefined });

it("really is running without a DOM", () => {
  // Guards the guard. If a future config change gave this file jsdom, every
  // assertion below would still pass while proving nothing.
  expect(typeof window).toBe("undefined");
  expect(typeof document).toBe("undefined");
  expect(typeof ResizeObserver).toBe("undefined");
  // Not the shadow defined above: the store has to meet the same nothing a
  // real server offers, so the setup must not have installed its shim either.
  expect(shimmedLocalStorage).toBeUndefined();
  expect(typeof localStorage).toBe("undefined");
});

describe("server render", () => {
  const spied = (): { extension: DevToolbarExtension; start: ReturnType<typeof vi.fn> } => {
    const start = vi.fn((_api: ExtensionRuntimeApi) => () => {});
    return {
      start,
      extension: {
        id: "ssr",
        label: "SSR",
        start,
        compact: () => <span data-testid="compact">chip</span>,
        overlay: () => <span data-testid="overlay">overlay</span>,
        panel: () => <span data-testid="panel">panel</span>,
      },
    };
  };

  it("emits children only — no toolbar markup of any kind", () => {
    const { extension } = spied();
    const html = renderToString(
      <DevToolbar extensions={[extension]}>
        <main id="app">app</main>
      </DevToolbar>,
    );

    expect(html).toBe('<main id="app">app</main>');
    // Spelled out as well as compared, so a failure names what leaked.
    expect(html).not.toContain("data-dev-toolbar");
    expect(html).not.toContain("data-dtb-");
  });

  it("does not invoke start() or any slot on the server", () => {
    const { extension, start } = spied();
    const html = renderToString(
      <DevToolbar extensions={[extension]}>
        <main id="app">app</main>
      </DevToolbar>,
    );

    expect(start).not.toHaveBeenCalled();
    expect(html).not.toContain("compact");
    expect(html).not.toContain("overlay");
    expect(html).not.toContain("panel");
  });

  it("renders nothing for the toolbar even with enabled and defaultVisible set", () => {
    // The mount gate, not `enabled` or `visible`, is what keeps the bar out of
    // server HTML — so the props that would show it must not.
    const html = renderToString(
      <DevToolbar enabled defaultVisible extensions={[]}>
        <main id="app">app</main>
      </DevToolbar>,
    );
    expect(html).toBe('<main id="app">app</main>');
  });

  it("holds DevToolbarInset at its documented defaults: bottom, zero padding", () => {
    const html = renderToString(
      <DevToolbar extensions={[]} defaultPosition="top">
        <DevToolbarInset>app</DevToolbarInset>
      </DevToolbar>,
    );

    // `defaultPosition="top"` is deliberately ignored on the server: the inset
    // holds bottom/0px until the mount flag flips, so the first client render
    // agrees with this string. See §8.
    expect(html).toContain('data-dtb-position="bottom"');
    expect(html).toMatch(/padding-bottom:\s*0px/);
    expect(html).not.toContain("--dev-toolbar-height");
  });

  it("survives a storage adapter that throws from every method", () => {
    // `createLocalStorage` is documented to degrade rather than throw on a
    // server, in private mode and over quota. A consumer-supplied adapter that
    // throws must not take the server render down either.
    const storage = {
      getItem: () => {
        throw new Error("no storage here");
      },
      setItem: () => {
        throw new Error("no storage here");
      },
      removeItem: () => {
        throw new Error("no storage here");
      },
    };

    const html = renderToString(
      <DevToolbar storage={storage} extensions={[]}>
        <main id="app">app</main>
      </DevToolbar>,
    );
    expect(html).toBe('<main id="app">app</main>');
  });
});
