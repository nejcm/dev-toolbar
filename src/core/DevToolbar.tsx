import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  CONTRACT_VERSION,
  type DevToolbarClassNames,
  type DevToolbarExtension,
  type ExtensionRuntimeApi,
  type ToolbarColorScheme,
  type ToolbarDensity,
  type ToolbarPosition,
  type ToolbarStorage,
} from "./contract";
import { Bar } from "./Bar";
import { OverlayHost } from "./OverlayHost";
import { PanelHost } from "./PanelHost";
import { DevToolbarContext, cx } from "./context";
import type { DevToolbarContextValue } from "./context";
import { collectCommands, registerCommandHost, runCommand } from "./commands";
import { collectDiagnostics } from "./diagnostics";
import {
  createExtensionStorage,
  createInstanceStorage,
  resolveStorage,
} from "./storage";
import { createToolbarStore } from "./store";
import { DEFAULT_SHORTCUT, matchesShortcut, parseShortcut } from "./shortcut";
import { ensureStyles } from "./styles";

/**
 * CSS custom property published on `document.documentElement` while the bar is
 * mounted and visible. It measures the whole toolbar root — the bar *plus* the
 * open panel — not the bar alone, so insetting by it never leaves content
 * underneath an expanded panel.
 */
export const HEIGHT_VARIABLE = "--dev-toolbar-height";

export interface DevToolbarProps {
  /** Rendered untouched, in a fragment. The bar itself portals to the body. */
  children?: ReactNode;
  /** Source of truth for the extension list. */
  extensions?: readonly DevToolbarExtension[];
  /** `false` renders children only — no portal, no lifecycle. Default `true`. */
  enabled?: boolean;
  /**
   * Namespaces persisted preferences. Default `"default"`.
   *
   * Read once, on mount. Changing it later is ignored — remount the toolbar
   * (e.g. with a `key`) to move an instance to a different namespace.
   */
  instanceId?: string;
  density?: ToolbarDensity;
  colorScheme?: ToolbarColorScheme;
  /** Initial values, used only when nothing is persisted yet. */
  defaultVisible?: boolean;
  defaultPosition?: ToolbarPosition;
  defaultPanelHeight?: number;
  /**
   * `undefined` → localStorage, `null` → persistence disabled.
   *
   * Read once, on mount, together with `instanceId`; the store, the context's
   * `storage` and every extension's namespaced view all come from that single
   * captured adapter. Changing it later is ignored — remount to swap adapters.
   */
  storage?: ToolbarStorage | null;
  /** `false` skips runtime CSS injection; import `./styles.css` instead. */
  injectStyles?: boolean;
  classNames?: DevToolbarClassNames;
  /** e.g. `"Mod+Shift+."`. `null` disables the toggle shortcut. */
  shortcut?: string | null;
  /** Portal target. Defaults to `document.body`. */
  container?: HTMLElement | null;
  className?: string;
  style?: CSSProperties;
}

const EMPTY_EXTENSIONS: readonly DevToolbarExtension[] = [];

export function DevToolbar(props: DevToolbarProps): ReactNode {
  const { children, ...rest } = props;
  return (
    <DevToolbarRoot {...rest}>
      <>{children}</>
    </DevToolbarRoot>
  );
}

function DevToolbarRoot({
  children,
  extensions: extensionsProp = EMPTY_EXTENSIONS,
  enabled = true,
  instanceId = "default",
  density = "compact",
  colorScheme = "system",
  defaultVisible = true,
  defaultPosition = "bottom",
  defaultPanelHeight,
  storage: storageProp,
  injectStyles = true,
  classNames,
  shortcut = DEFAULT_SHORTCUT,
  container,
  className,
  style,
}: DevToolbarProps): ReactNode {
  // `storage` and `instanceId` are captured once, on mount, so that the store
  // and everything derived from it can never disagree about where preferences
  // live. See the prop docs above.
  const [{ raw: rawStorage, base: baseStorage }] = useState(() => {
    const raw = resolveStorage(storageProp);
    return { raw, base: createInstanceStorage(raw, instanceId) };
  });

  const [store] = useState(() =>
    createToolbarStore({
      storage: baseStorage,
      defaultVisible,
      defaultPosition,
      ...(defaultPanelHeight === undefined ? {} : { defaultPanelHeight }),
    }),
  );

  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  // Client-only mount: the bar is never part of server HTML, so there is
  // nothing to hydrate and nothing to mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const extensions = useMemo(() => {
    const merged: DevToolbarExtension[] = [];
    const seen = new Set<string>();
    for (const extension of [...extensionsProp, ...state.registered]) {
      if (seen.has(extension.id)) continue;
      seen.add(extension.id);
      merged.push(extension);
    }
    return merged;
  }, [extensionsProp, state.registered]);

  // The extension list, not the aggregated commands, is what is kept in a ref:
  // with the function form of `commands` an aggregation is only ever a snapshot
  // of the moment it was taken, so every *imperative* path re-enumerates
  // instead of reading a stale array. See `getCommands` below.
  const extensionsRef = useRef(extensions);
  extensionsRef.current = extensions;

  const getCommands = useCallback(
    () => collectCommands(extensionsRef.current),
    [],
  );

  /**
   * The declarative snapshot behind `useToolbarCommands()`. Recomputed when the
   * extension list changes — which is the only invalidation signal core has,
   * since an extension whose command list grew does not tell anybody. Anything
   * that must be current (a palette opening, `runCommand`) calls `getCommands()`
   * rather than reading this.
   */
  const commands = useMemo(() => collectCommands(extensions), [extensions]);

  useEffect(() => {
    if (!enabled) return;
    return registerCommandHost({ getCommands });
  }, [enabled, getCommands]);

  const scopedRunCommand = useCallback(
    (id: string) => runCommand(id, getCommands()),
    [getCommands],
  );

  // Contract version check.
  useEffect(() => {
    if (!enabled) return;
    for (const extension of extensions) {
      if (
        extension.contractVersion !== undefined &&
        extension.contractVersion !== CONTRACT_VERSION
      ) {
        // eslint-disable-next-line no-console
        console.warn(
          `[dev-toolbar] extension "${extension.id}" targets contract version ` +
            `${extension.contractVersion}, but this core implements ${CONTRACT_VERSION}. ` +
            "It may not render correctly.",
        );
      }
    }
  }, [extensions, enabled]);

  // A panel open when its extension becomes hidden must close, not merely stop
  // painting: `activePanelId` is persisted, so leaving it set would reopen the
  // panel on the next reload the moment the extension came back. Only a
  // *present and hidden* extension closes — an id that is simply absent is left
  // alone, which is what lets a persisted panel survive until the extension
  // that owns it registers.
  useEffect(() => {
    if (!enabled) return;
    const active = state.activePanelId;
    if (active === null) return;
    const match = extensions.find((extension) => extension.id === active);
    if (match?.hidden === true) store.closePanel(active);
  }, [enabled, extensions, state.activePanelId, store]);

  // start(api): once per extension id while it is present *and not hidden*.
  // Core reports visibility and never pauses an extension on its behalf.
  const runningRef = useRef(
    new Map<
      string,
      { controller: AbortController; dispose?: () => void; start: unknown }
    >(),
  );
  const identityWarnedRef = useRef(new Set<string>());
  useEffect(() => {
    const running = runningRef.current;

    // Disabling at runtime is a real teardown: abort every signal and run every
    // dispose, rather than leaving timers alive until unmount.
    if (!enabled) {
      for (const [id, entry] of [...running]) stopExtension(id, entry);
      running.clear();
      return;
    }

    // `hidden` is the consumer saying this extension does not exist for this
    // actor. Running its collectors anyway — patching fetch, retaining request
    // URLs, holding a rAF loop open — would be exactly the leak `hidden`
    // exists to prevent, so a hidden extension is stopped, not merely unpainted.
    const present = new Set(
      extensions
        .filter((extension) => extension.hidden !== true)
        .map((extension) => extension.id),
    );

    for (const [id, entry] of [...running]) {
      if (present.has(id)) continue;
      stopExtension(id, entry);
      running.delete(id);
    }

    for (const extension of extensions) {
      if (extension.hidden === true || typeof extension.start !== "function") {
        continue;
      }
      const existing = running.get(extension.id);
      if (existing) {
        // The running lifecycle belongs to the object that was started. If the
        // consumer rebuilt the extension inside render, the slots now render
        // from a *different* object than the one holding the collectors, and
        // its state is silently lost. `{...ext, hidden}` keeps the same `start`
        // reference, so this does not fire for the legitimate pattern.
        if (
          existing.start !== extension.start &&
          !identityWarnedRef.current.has(extension.id)
        ) {
          identityWarnedRef.current.add(extension.id);
          // eslint-disable-next-line no-console
          console.warn(
            `[dev-toolbar] extension "${extension.id}" was rebuilt after it started. ` +
              "Its start() lifecycle still belongs to the first object, so whatever " +
              "that object owns — collectors, buffers, subscriptions — is unreachable " +
              "from what the bar now renders. Build extensions once, at module scope, " +
              "not inside render. (A hot-module reload of the module that builds them " +
              "does this too; reload the page.)",
          );
        }
        continue;
      }
      const controller = new AbortController();
      const api: ExtensionRuntimeApi = {
        signal: controller.signal,
        isVisible: () => store.getSnapshot().visible,
        subscribeVisibility: (callback) => {
          let last = store.getSnapshot().visible;
          return store.subscribe(() => {
            const next = store.getSnapshot().visible;
            if (next === last) return;
            last = next;
            callback(next);
          });
        },
        storage: createExtensionStorage(rawStorage, instanceId, extension.id),
        // The aggregation, reachable without importing a value from core.
        getCommands: () => collectCommands(extensionsRef.current),
        runCommand: (id: string) =>
          runCommand(id, collectCommands(extensionsRef.current)),
        // Same shape and the same reason as `getCommands`: read through the
        // ref, so a snapshot taken now reflects the extension list now.
        getDiagnostics: () => collectDiagnostics(extensionsRef.current),
      };
      const entry: {
        controller: AbortController;
        dispose?: () => void;
        start: unknown;
      } = { controller, start: extension.start };
      running.set(extension.id, entry);
      try {
        const dispose = extension.start(api);
        if (typeof dispose === "function") entry.dispose = dispose;
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(
          `[dev-toolbar] extension "${extension.id}" threw from start().`,
          error,
        );
      }
    }
  }, [extensions, enabled, store, rawStorage, instanceId]);

  useEffect(() => {
    const running = runningRef.current;
    return () => {
      for (const [id, entry] of [...running]) stopExtension(id, entry);
      running.clear();
    };
  }, []);

  // Style injection.
  useEffect(() => {
    if (!enabled || !injectStyles) return;
    ensureStyles();
  }, [enabled, injectStyles]);

  // Toggle shortcut.
  const parsedShortcut = useMemo(
    () => (shortcut === null ? null : parseShortcut(shortcut)),
    [shortcut],
  );
  useEffect(() => {
    if (!enabled || !parsedShortcut || typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, parsedShortcut)) return;
      event.preventDefault();
      store.toggleVisible();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, parsedShortcut, store]);

  // Publish --dev-toolbar-height on the document element.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const shouldRender = enabled && mounted && state.visible;
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    const root = document.documentElement;
    const node = rootRef.current;
    if (!shouldRender || !node) {
      root.style.setProperty(HEIGHT_VARIABLE, "0px");
      return () => root.style.removeProperty(HEIGHT_VARIABLE);
    }

    const publish = () => {
      root.style.setProperty(
        HEIGHT_VARIABLE,
        `${Math.round(node.getBoundingClientRect().height)}px`,
      );
    };
    publish();

    if (typeof ResizeObserver === "undefined") {
      return () => root.style.removeProperty(HEIGHT_VARIABLE);
    }
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.removeProperty(HEIGHT_VARIABLE);
    };
  }, [
    enabled,
    shouldRender,
    state.position,
    state.panelHeight,
    state.activePanelId,
  ]);

  const contextValue = useMemo<DevToolbarContextValue>(
    () => ({
      instanceId,
      enabled,
      mounted,
      store,
      extensions,
      commands,
      getCommands,
      runCommand: scopedRunCommand,
      density,
      classNames: classNames ?? {},
      storage: baseStorage,
      visible: state.visible,
      position: state.position,
      activePanelId: state.activePanelId,
      panelHeight: state.panelHeight,
      setVisible: store.setVisible,
      toggleVisible: store.toggleVisible,
      setPosition: store.setPosition,
      openPanel: store.openPanel,
      closePanel: store.closePanel,
      togglePanel: store.togglePanel,
      setPanelHeight: store.setPanelHeight,
      register: store.register,
    }),
    [
      instanceId,
      enabled,
      mounted,
      store,
      extensions,
      commands,
      getCommands,
      scopedRunCommand,
      density,
      classNames,
      baseStorage,
      state,
    ],
  );

  const target =
    container ?? (typeof document === "undefined" ? null : document.body);

  return (
    <DevToolbarContext.Provider value={contextValue}>
      {children}
      {shouldRender && target
        ? createPortal(
            <div
              ref={rootRef}
              data-dev-toolbar=""
              data-dtb-part="root"
              data-dtb-instance={instanceId}
              data-dtb-position={state.position}
              data-dtb-density={density}
              data-dtb-color-scheme={colorScheme}
              className={cx(classNames?.root, className)}
              {...(style ? { style } : {})}
            >
              <Bar
                extensions={extensions}
                density={density}
                activePanelId={state.activePanelId}
                openPanel={store.openPanel}
                closePanel={store.closePanel}
                togglePanel={store.togglePanel}
                classNames={classNames}
              />
              <OverlayHost
                extensions={extensions}
                density={density}
                position={state.position}
                classNames={classNames}
              />
              <PanelHost
                extensions={extensions}
                activePanelId={state.activePanelId}
                position={state.position}
                density={density}
                panelHeight={state.panelHeight}
                setPanelHeight={store.setPanelHeight}
                closePanel={store.closePanel}
                classNames={classNames}
              />
            </div>,
            target,
          )
        : null}
    </DevToolbarContext.Provider>
  );
}

function stopExtension(
  id: string,
  entry: { controller: AbortController; dispose?: () => void },
): void {
  try {
    entry.controller.abort();
  } catch {
    /* ignore */
  }
  try {
    entry.dispose?.();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      `[dev-toolbar] extension "${id}" threw from its start() cleanup.`,
      error,
    );
  }
}
