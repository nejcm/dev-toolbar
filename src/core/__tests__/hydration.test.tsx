/**
 * The client half of `docs/architecture.md` §8: server HTML carries no bar,
 * hydrating over that HTML mounts one, and React reports no mismatch.
 *
 * This file runs under jsdom on purpose — hydration needs a document. The
 * DOM-free half of the SSR promise is `ssr.test.tsx`, which runs under `node`.
 * `renderToString` here still produces the same string it does on a server,
 * because the bar is gated on an effect and `renderToString` runs none.
 */
import { act } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { DevToolbar } from "../DevToolbar";
import { DevToolbarInset } from "../DevToolbarInset";
import type { DevToolbarExtension } from "../contract";
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
    // The inset is the one piece of core that *is* in server HTML, so it is
    // the only place a mismatch could come from. It holds bottom/0px through
    // hydration and only then picks up the real height variable.
    const html = renderToString(app([]));
    expect(html).toContain('data-dtb-position="bottom"');

    const container = hydrate(html, []);
    const inset = container.querySelector<HTMLElement>('[data-dtb-part="inset"]')!;

    expect(inset.dataset["dtbPosition"]).toBe("bottom");
    // After the mount effect the inset is settled and pads by the variable.
    expect(inset.style.paddingBottom).toBe("var(--dev-toolbar-height, 0px)");
    expect(error!.mock.calls).toEqual([]);
  });
});
