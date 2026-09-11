/**
 * Client half of `docs/architecture.md` §8: server HTML carries no bar;
 * hydrating over it mounts one with no mismatch. Runs under jsdom, since
 * hydration needs a document — the DOM-free half is `ssr.test.tsx`, under `node`.
 */
import { act } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { Mock } from "vitest";
import { DevToolbar } from "../DevToolbar";
import { DevToolbarInset } from "../DevToolbarInset";
import type { DevToolbarExtension } from "../contract";
import { useDevToolbar } from "../context";
import { createMemoryStorage } from "../storage";

const app = (extensions: readonly DevToolbarExtension[]) => (
  <DevToolbar instanceId="hydrate" storage={createMemoryStorage()} extensions={extensions}>
    <DevToolbarInset>
      <main id="app">app</main>
    </DevToolbarInset>
  </DevToolbar>
);

let unmount: (() => void) | null = null;
let error: Mock<typeof console.error> | null = null;

afterEach(() => {
  if (unmount) act(unmount);
  unmount = null;
  error?.mockRestore();
  error = null;
  document.body.innerHTML = "";
});

/** Hydrates `html` in a fresh container and returns the console.error calls. */
const hydrate = (html: string, extensions: readonly DevToolbarExtension[]) => {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.append(container);

  error = vi.spyOn(console, "error").mockImplementation(() => {});
  let root: ReturnType<typeof hydrateRoot>;
  act(() => {
    root = hydrateRoot(container, app(extensions));
  });
  unmount = () => root.unmount();
  return container;
};

describe("hydration over server HTML", () => {
  it("mounts the bar on the client and logs no mismatch", () => {
    const extensions: DevToolbarExtension[] = [
      { id: "h", label: "H", compact: () => <span data-testid="chip">chip</span> },
    ];

    const html = renderToString(app(extensions));
    expect(html).not.toContain("data-dev-toolbar");

    const container = hydrate(html, extensions);

    // The bar exists, in the body portal, not inside the hydrated container.
    const root = document.body.querySelector("[data-dev-toolbar]");
    expect(root).not.toBeNull();
    expect(root!.parentElement).toBe(document.body);
    expect(container.contains(root)).toBe(false);
    expect(document.querySelector('[data-dtb-ext-id="h"]')).not.toBeNull();

    const messages = error!.mock.calls.map((call) => String(call[0]));
    expect(messages.filter((message) => /hydrat/i.test(message))).toEqual([]);
    expect(messages).toEqual([]);
  });

  it("keeps the inset agreeing with the server on the first client render", () => {
    // The inset is the only piece of core present in server HTML, so it's the
    // only place a mismatch could show up; it holds bottom/0px until the mount
    // effect picks up the real height variable.
    const html = renderToString(app([]));
    expect(html).toContain('data-dtb-position="bottom"');

    const container = hydrate(html, []);
    const inset = container.querySelector<HTMLElement>('[data-dtb-part="inset"]')!;

    expect(inset.dataset["dtbPosition"]).toBe("bottom");
    // After the mount effect the inset is settled and pads by the variable.
    expect(inset.style.paddingBottom).toBe(
      "var(--dev-toolbar-height-hydrate, var(--dev-toolbar-height, 0px))",
    );
    expect(error!.mock.calls).toEqual([]);
  });
});

/**
 * Regression test: `getSnapshot` was passed to `useSyncExternalStore` as
 * `getServerSnapshot` too, so a server (no storage) rendered defaults while the
 * first client render read persisted values, mismatching every
 * `useDevToolbar()` consumer. `DevToolbarInset` gates on `mounted` and can't
 * show this, hence the plain consumer below.
 */
describe("hydration with persisted preferences", () => {
  /** Values a returning user would already have in localStorage. */
  const persisted = () =>
    createMemoryStorage({
      "dtb:v1:persisted:position": '"top"',
      "dtb:v1:persisted:panelHeight": "500",
    });

  const seen: string[] = [];

  function Consumer(): ReactNode {
    const toolbar = useDevToolbar();
    const text = `${toolbar.position}/${toolbar.panelHeight}`;
    seen.push(text);
    return <p data-testid="consumer">{text}</p>;
  }

  const tree = (storage: ReturnType<typeof persisted>) => (
    <DevToolbar instanceId="persisted" storage={storage}>
      <Consumer />
    </DevToolbar>
  );

  it("shows a hydrating consumer the defaults, not the persisted values — the server saw defaults", () => {
    // The server has no storage at all, so its HTML says bottom/320.
    const html = renderToString(tree(createMemoryStorage()));
    expect(html).toContain("bottom/320");

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);

    seen.length = 0;
    error = vi.spyOn(console, "error").mockImplementation(() => {});
    let root: ReturnType<typeof hydrateRoot>;
    act(() => {
      root = hydrateRoot(container, tree(persisted()));
    });
    unmount = () => root.unmount();

    expect(seen[0]).toBe("bottom/320");
    expect(seen.at(-1)).toBe("top/500");
    expect(container.querySelector('[data-testid="consumer"]')!.textContent).toBe("top/500");
    expect(error!.mock.calls.map((call) => String(call[0]))).toEqual([]);
  });

  it("keeps controlled values on the server and the first client render", () => {
    const seen: string[] = [];
    const ControlledConsumer = (): ReactNode => {
      const toolbar = useDevToolbar();
      const text = `${toolbar.visible}/${toolbar.position}`;
      seen.push(text);
      return <p data-testid="controlled-consumer">{text}</p>;
    };
    const tree = (storage: ReturnType<typeof createMemoryStorage>) => (
      <DevToolbar
        instanceId="controlled-hydration"
        storage={storage}
        visible={false}
        position="top"
        onVisibleChange={() => {}}
        onPositionChange={() => {}}
      >
        <ControlledConsumer />
      </DevToolbar>
    );

    const html = renderToString(tree(createMemoryStorage()));
    expect(html).toContain("false/top");

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    error = vi.spyOn(console, "error").mockImplementation(() => {});
    let root: ReturnType<typeof hydrateRoot>;
    act(() => {
      root = hydrateRoot(
        container,
        tree(
          createMemoryStorage({
            "dtb:v1:controlled-hydration:visible": "true",
            "dtb:v1:controlled-hydration:position": '"bottom"',
          }),
        ),
      );
    });
    unmount = () => root.unmount();

    expect(seen[0]).toBe("false/top");
    expect(seen.at(-1)).toBe("false/top");
    expect(error!.mock.calls.map((call) => String(call[0]))).toEqual([]);
  });
});
