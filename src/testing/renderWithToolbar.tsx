import type { RenderOptions, RenderResult } from "@testing-library/react";
import { useEffect } from "react";
import type { ReactNode } from "react";
// Core values via the package's own specifier, types relatively: a relative
// value import would inline a second core into `dist/testing.cjs` (AGENTS.md, *Conventions*).
import {
  DevToolbar,
  HEIGHT_VARIABLE,
  createMemoryStorage,
  useDevToolbar,
} from "@nejcm/dev-toolbar";
import { DEFAULT_INSTANCE_ID, instanceHeightVariable } from "./heightVariable";
import type { DevToolbarProps } from "../core/DevToolbar";
import type { DevToolbarContextValue } from "../core/context";
import type { DevToolbarExtension, ToolbarCommand, ToolbarPosition } from "../core/contract";
import { installToolbarLayout, reinstallToolbarLayout } from "./layout";
import type { InstallToolbarLayoutOptions, ToolbarLayoutHandle } from "./layout";
import { requireTestingLibrary } from "./reactTestingLibrary";

export interface RenderWithToolbarOptions extends Omit<DevToolbarProps, "children"> {
  /**
   * Install the fake layout so overflow collapse and `--dev-toolbar-height`
   * work under jsdom. `true` uses the defaults. Its lifetime is the rendered
   * tree's — `unmount()`, Testing Library's `cleanup()`, and RTL auto-cleanup
   * all tear it down, leaving nothing on `HTMLElement.prototype`.
   */
  layout?: boolean | InstallToolbarLayoutOptions;
  /** Passed straight through to Testing Library's `render`. */
  renderOptions?: RenderOptions;
}

/**
 * Programmatic handle onto the mounted toolbar. Every mutator is
 * `act()`-wrapped, including the `async` `runCommand()` (its command may
 * itself await, so it must be awaited rather than wrapped again).
 */
export interface ToolbarHandle {
  /**
   * The live context value. Throws if the toolbar is not mounted — meaning
   * this handle's own `unmount()` ran, or `render()` threw. Testing Library's
   * `cleanup()` (including RTL auto-cleanup) unmounts without going through
   * that wrapper, so after a teardown you didn't trigger yourself this still
   * returns a stale context whose setters reach nothing. Call `unmount()`
   * yourself when a test needs the throw.
   */
  context(): DevToolbarContextValue;
  /** `null` when the toolbar is hidden or disabled — it is not in the DOM then. */
  root(): HTMLElement | null;
  bar(): HTMLElement | null;
  /** First element with the given `data-dtb-part`. */
  part(part: string): HTMLElement | null;
  parts(part: string): HTMLElement[];
  /**
   * The bar item for an extension. Collapsed items aren't rendered while the
   * `···` menu is closed, so this returns `null` until `openOverflow()` runs.
   * Use `isOverflowed()` / `overflowedIds()` to ask *whether* it collapsed —
   * neither needs the menu open.
   */
  item(extensionId: string): HTMLElement | null;
  /**
   * The panel element for an extension — presence in the DOM, which for most
   * extensions equals *open* (closing unmounts it). A `keepMounted` panel is
   * the exception: it stays in the DOM while closed, rendered with `hidden`.
   * Assert on `activePanelId()` or the element's `hidden` to check openness.
   */
  panel(extensionId: string): HTMLElement | null;
  /** The overlay slot's wrapper for an extension. Never collapsed, so always here. */
  overlay(extensionId: string): HTMLElement | null;
  /** The error chip an extension degraded to, if any. */
  errorChip(extensionId?: string): HTMLElement | null;
  overflowButton(): HTMLButtonElement | null;
  overflowMenu(): HTMLElement | null;
  /**
   * Ids currently collapsed into the `···` menu.
   *
   * Derived from the extension list minus what is in the bar, so it is correct
   * whether or not the menu is open.
   */
  overflowedIds(): string[];
  /** True when this extension has been collapsed into the `···` menu. */
  isOverflowed(extensionId: string): boolean;
  /** Ids currently rendered in the bar itself. */
  barIds(): string[];
  /** Clicks the `···` button. Throws when there is nothing collapsed. */
  openOverflow(): void;
  /**
   * The height this instance publishes, e.g. `"30px"` — read from
   * `--dev-toolbar-height-<instanceId>`, falling back to the unsuffixed
   * `--dev-toolbar-height` the default instance also writes.
   */
  height(): string;
  /** Layout handle, when `layout` was requested. */
  layout: ToolbarLayoutHandle | null;
  /** Sets the measured bar width and lets the collapse recompute. */
  resize(width: number): void;
  visible(): boolean;
  position(): ToolbarPosition;
  activePanelId(): string | null;
  panelHeight(): number;
  setVisible(visible: boolean): void;
  toggleVisible(): void;
  setPosition(position: ToolbarPosition): void;
  openPanel(id: string): void;
  closePanel(id?: string): void;
  togglePanel(id: string): void;
  setPanelHeight(height: number): void;
  /** Dynamic registration, the `useDevToolbar().register()` path. */
  register(extension: DevToolbarExtension): () => void;
  runCommand(id: string): Promise<boolean>;
  /** Re-enumerates every extension's commands, the way a palette does on open. */
  getCommands(): readonly ToolbarCommand[];
}

export interface RenderWithToolbarResult extends RenderResult {
  toolbar: ToolbarHandle;
  /**
   * Re-renders `ui` inside the *same* mounted toolbar. Testing Library's own
   * `rerender` replaces the whole tree, which here would tear the toolbar out
   * of the DOM (no `wrapper` is used — the wrapping is part of the rendered
   * element). This override rebuilds that wrapping so the toolbar, its
   * preferences, and the layout install all survive.
   */
  rerender: (ui?: ReactNode) => void;
}

/**
 * Ties the fake layout's lifetime to the React tree. Testing Library exposes
 * no hook into `cleanup()`, but it does unmount every tree it rendered, so an
 * effect cleanup here *is* that hook — it's what makes `cleanup()` (and RTL
 * auto-cleanup) restore the prototype instead of leaving the fake installed
 * for the rest of the file.
 *
 * Re-installs on mount because StrictMode invokes effects mount → cleanup →
 * mount, and a cleanup-only owner would leave the layout restored mid-test.
 *
 * Rendered as the **first** sibling, which is load-bearing under StrictMode:
 * React runs every cleanup in tree order and only then every re-mount, so an
 * owner rendered last would have already deleted `globalThis.ResizeObserver`
 * before the rest of the tree re-mounts — ordinary consumer code constructing
 * one in a mount effect would throw `ReferenceError` on the second pass. Being
 * first means the reinstall leads instead, at no cost: core's own teardown
 * only calls `disconnect()` on fakes it already holds.
 */
function LayoutOwner({ handle }: { handle: ToolbarLayoutHandle }): null {
  useEffect(() => {
    reinstallToolbarLayout(handle);
    return () => {
      handle.restore();
    };
  }, [handle]);
  return null;
}

function Probe({ onRender }: { onRender: (value: DevToolbarContextValue) => void }): null {
  // Captured during render, not an effect, so the handle sees the most recent
  // commit's value, including the very first one.
  onRender(useDevToolbar());
  return null;
}

/**
 * Renders `ui` inside a `<DevToolbar>` wired for tests. Defaults that differ
 * from production: `storage` is a fresh in-memory adapter (so tests never leak
 * preferences into each other) and `instanceId` is `"test"`. Pass either
 * explicitly to override.
 */
export function renderWithToolbar(
  ui?: ReactNode,
  options: RenderWithToolbarOptions = {},
): RenderWithToolbarResult {
  // Resolved first so a missing optional peer fails with an actionable
  // message rather than a ReferenceError three frames deep.
  const { act, render } = requireTestingLibrary();

  const { layout, renderOptions, ...toolbarProps } = options;

  const layoutHandle =
    layout === undefined || layout === false
      ? null
      : installToolbarLayout(layout === true ? {} : layout);

  const props: RenderWithToolbarProps = {
    instanceId: "test",
    ...toolbarProps,
    storage: "storage" in toolbarProps ? toolbarProps.storage : createMemoryStorage(),
  };

  let latest: DevToolbarContextValue | null = null;
  const captured = (value: DevToolbarContextValue) => {
    latest = value;
  };

  // One place builds the tree, so `rerender()` below can't drift from the
  // initial render, including `LayoutOwner`'s load-bearing first-sibling
  // position (see its own comment).
  const tree = (children: ReactNode) => (
    <>
      {layoutHandle ? <LayoutOwner handle={layoutHandle} /> : null}
      <DevToolbar {...props}>
        <Probe onRender={captured} />
        {children}
      </DevToolbar>
    </>
  );

  const result = render(tree(ui), renderOptions);

  const context = (): DevToolbarContextValue => {
    if (!latest) {
      throw new Error(
        "[dev-toolbar/testing] the toolbar is not mounted — did render() throw, " +
          "or has unmount() already run?",
      );
    }
    return latest;
  };

  // Extension ids are arbitrary strings; a `"` or `\` in one would end the
  // attribute selector's quoted value early (SyntaxError, or a selector that
  // quietly matches the wrong thing). `CSS.escape` handles this — called as a
  // method since jsdom's implementation throws otherwise — with a fallback for
  // hosts without it, hex-escaping what a quoted CSS string can't hold literally.
  const escape = (value: string): string =>
    typeof globalThis.CSS?.escape === "function"
      ? globalThis.CSS.escape(value)
      : value.replaceAll(/["\\\n\r\f]/g, (char) =>
          char === '"' || char === "\\"
            ? `\\${char}`
            : `\\${(char.codePointAt(0) ?? 0).toString(16)} `,
        );

  const root = () => document.querySelector<HTMLElement>('[data-dtb-part="root"]');
  const part = (name: string) =>
    document.querySelector<HTMLElement>(`[data-dtb-part="${escape(name)}"]`);
  const parts = (name: string) => [
    ...document.querySelectorAll<HTMLElement>(`[data-dtb-part="${escape(name)}"]`),
  ];
  const idsOf = (nodes: HTMLElement[]) =>
    nodes
      .map((node) => node.dataset["dtbExtId"])
      .filter((id): id is string => typeof id === "string");

  const run = (fn: () => void) => {
    act(() => {
      fn();
    });
  };

  const toolbar: ToolbarHandle = {
    context,
    root,
    bar: () => part("bar"),
    part,
    parts,
    item: (id) =>
      document.querySelector<HTMLElement>(
        `[data-dtb-part="item"][data-dtb-ext-id="${escape(id)}"]`,
      ),
    panel: (id) =>
      document.querySelector<HTMLElement>(
        `[data-dtb-part="panel"][data-dtb-ext-id="${escape(id)}"]`,
      ),
    overlay: (id) =>
      document.querySelector<HTMLElement>(
        `[data-dtb-part="overlay"][data-dtb-ext-id="${escape(id)}"]`,
      ),
    errorChip: (id) =>
      document.querySelector<HTMLElement>(
        id === undefined
          ? '[data-dtb-part="error-chip"]'
          : `[data-dtb-part="error-chip"][data-dtb-ext-id="${escape(id)}"]`,
      ),
    overflowButton: () =>
      document.querySelector<HTMLButtonElement>('[data-dtb-part="overflow-button"]'),
    overflowMenu: () => part("overflow-menu"),
    overflowedIds() {
      // Not read from the menu: its items only exist while open. Everything
      // visible that isn't in the bar has collapsed.
      if (!root()) return [];
      const inBar = new Set(toolbar.barIds());
      return context()
        .extensions.filter((extension) => extension.hidden !== true)
        .map((extension) => extension.id)
        .filter((id) => !inBar.has(id));
    },
    isOverflowed: (id) => toolbar.overflowedIds().includes(id),
    barIds: () =>
      idsOf([
        ...document.querySelectorAll<HTMLElement>(
          '[data-dtb-part="region"] > [data-dtb-part="item"]',
        ),
      ]),
    openOverflow() {
      const button = toolbar.overflowButton();
      if (!button) {
        throw new Error(
          "[dev-toolbar/testing] nothing has collapsed — there is no ··· button to open.",
        );
      }
      run(() => button.click());
    },
    height: () => {
      const style = document.documentElement.style;
      return (
        style.getPropertyValue(instanceHeightVariable(props.instanceId ?? DEFAULT_INSTANCE_ID)) ||
        style.getPropertyValue(HEIGHT_VARIABLE)
      );
    },
    layout: layoutHandle,
    resize(width) {
      if (!layoutHandle) {
        throw new Error(
          "[dev-toolbar/testing] resize() needs renderWithToolbar({ layout: true }).",
        );
      }
      run(() => layoutHandle.resize(width));
    },
    visible: () => context().visible,
    position: () => context().position,
    activePanelId: () => context().activePanelId,
    panelHeight: () => context().panelHeight,
    setVisible: (visible) => run(() => context().setVisible(visible)),
    toggleVisible: () => run(() => context().toggleVisible()),
    setPosition: (position) => run(() => context().setPosition(position)),
    openPanel: (id) => run(() => context().openPanel(id)),
    closePanel: (id) => run(() => context().closePanel(id)),
    togglePanel: (id) => run(() => context().togglePanel(id)),
    setPanelHeight: (height) => run(() => context().setPanelHeight(height)),
    register(extension) {
      let unregister: () => void = () => {};
      run(() => {
        unregister = context().register(extension);
      });
      return () => run(() => unregister());
    },
    async runCommand(id) {
      // Async `act`, unlike `run()`: a command's `run` may await, and state it
      // sets on the way back must be flushed too.
      let ran = false;
      await act(async () => {
        ran = await context().runCommand(id);
      });
      return ran;
    },
    getCommands: () => context().getCommands(),
  };

  const rerender = (next?: ReactNode) => {
    result.rerender(tree(next));
  };

  const unmount = () => {
    result.unmount();
    // Dropped so `context()` throws "not mounted" instead of handing out a
    // dead context. `Probe` can't do this itself: its effect cleanup would
    // also fire on StrictMode's remount pass.
    latest = null;
    // Redundant with `LayoutOwner`'s cleanup in the ordinary case; kept since
    // `restore()` is idempotent and free, covering the case where the owner
    // never mounted (e.g. a consumer `wrapper` whose error boundary swallowed
    // the first render).
    layoutHandle?.restore();
  };

  return { ...result, rerender, unmount, toolbar };
}

type RenderWithToolbarProps = Omit<DevToolbarProps, "children">;
