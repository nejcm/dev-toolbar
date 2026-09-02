import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import { createExtensionStorage, createInstanceStorage, resolveStorage } from "./storage";
import { createToolbarStore } from "./store";
import { DEFAULT_SHORTCUT, matchesShortcut, parseShortcut } from "./shortcut";
import { ensureStyles } from "./styles";

/**
 * CSS custom property published on `document.documentElement` while the bar is
 * mounted and visible. Measures the whole toolbar root — bar *plus* open panel
 * — so insetting by it never leaves content underneath an expanded panel.
 */
export const HEIGHT_VARIABLE = "--dev-toolbar-height";

/**
 * The `instanceId` default, and the one instance that owns `HEIGHT_VARIABLE`.
 *
 * Internal: not exported from any entry point. Exported only so
 * `src/testing/__tests__/heightVariable.test.ts` can assert the copy in
 * `src/testing/heightVariable.ts` still agrees with this one (that package may
 * not value-import a relative path into `core/`, per AGENTS.md).
 */
export const DEFAULT_INSTANCE_ID = "default";

/**
 * The per-instance form of {@link HEIGHT_VARIABLE}, e.g.
 * `--dev-toolbar-height-admin`. Every mounted toolbar publishes this, so
 * multiple instances on a page never overwrite each other's value; the
 * unsuffixed name stays the default instance's.
 *
 * `instanceId` is arbitrary, so non-CSS-identifier characters are folded to
 * `_` rather than escaped — ids differing only in punctuation collide, hence
 * `[A-Za-z0-9_-]` ids are safest.
 */
export function instanceHeightVariable(instanceId: string): string {
  return `${HEIGHT_VARIABLE}-${instanceId.replace(/[^A-Za-z0-9_-]+/g, "_")}`;
}

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
   * Read once, on mount; changing it later is ignored — remount (e.g. with a
   * `key`) to move an instance to a different namespace. Joined unescaped
   * with `:` into the storage key, so an id containing `:` can alias another
   * instance's or extension's scope — safest as `[A-Za-z0-9_-]`.
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
  /**
   * e.g. `"Mod+Shift+."`. `null` disables the toggle shortcut. Ignored when
   * the event is already `defaultPrevented`, mid-IME-composition, or an
   * auto-repeat; the focused element does not matter.
   */
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
  instanceId: instanceIdProp = DEFAULT_INSTANCE_ID,
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
  // Captured once, on mount, so the store and everything derived from it
  // can never disagree about where preferences live. See prop docs above.
  const [{ raw: rawStorage, base: baseStorage, instance: instanceId }] = useState(() => {
    const raw = resolveStorage(storageProp);
    return { raw, base: createInstanceStorage(raw, instanceIdProp), instance: instanceIdProp };
  });

  const [store] = useState(() =>
    createToolbarStore({
      storage: baseStorage,
      defaultVisible,
      defaultPosition,
      ...(defaultPanelHeight === undefined ? {} : { defaultPanelHeight }),
    }),
  );

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  // Client-only mount: the bar is never part of server HTML, so nothing to
  // hydrate or mismatch. Whether we've mounted can't be derived during
  // render — the effect running at all is the signal.
  const [mounted, setMounted] = useState(false);
  // oxlint-disable-next-line react/set-state-in-effect
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

  // Keeps the extension list, not the aggregated commands, in a ref: every
  // imperative path re-enumerates via `getCommands` below instead of reading
  // a stale aggregation.
  const extensionsRef = useRef(extensions);
  // Written in render, not an effect: an effect would leave `getCommands()`
  // a render behind the list it exists to enumerate.
  // oxlint-disable-next-line react/refs
  extensionsRef.current = extensions;

  const getCommands = useCallback(() => collectCommands(extensionsRef.current), []);

  /**
   * The declarative snapshot behind `useToolbarCommands()`. Recomputed only
   * when the extension list changes. Anything that must be current (a
   * palette opening, `runCommand`) calls `getCommands()` instead.
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

  // Contract version check, deduped by id (not object): an `extensions` array
  // rebuilt inside render re-runs this effect every render, which without the
  // ref would flood the console in exactly the case the warning is for.
  const contractWarnedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!enabled) return;
    for (const extension of extensions) {
      if (
        extension.contractVersion !== undefined &&
        extension.contractVersion !== CONTRACT_VERSION &&
        !contractWarnedRef.current.has(extension.id)
      ) {
        contractWarnedRef.current.add(extension.id);
        // eslint-disable-next-line no-console
        console.warn(
          `[dev-toolbar] extension "${extension.id}" targets contract version ` +
            `${extension.contractVersion}, but this core implements ${CONTRACT_VERSION}. ` +
            "It may not render correctly.",
        );
      }
    }
  }, [extensions, enabled]);

  // A panel open when its extension becomes hidden must close, not just stop
  // painting: `activePanelId` is persisted, so leaving it set would reopen the
  // panel next reload. Only a *present and hidden* extension closes — an
  // absent id is left alone, so a persisted panel survives until its
  // extension registers.
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
    new Map<string, { controller: AbortController; dispose?: () => void; start: unknown }>(),
  );
  const identityWarnedRef = useRef(new Set<string>());
  useEffect(() => {
    const running = runningRef.current;

    // Disabling at runtime is a real teardown: abort every signal and run
    // every dispose, rather than leaving timers alive until unmount.
    if (!enabled) {
      for (const [id, entry] of Array.from(running)) stopExtension(id, entry);
      running.clear();
      return;
    }

    // `hidden` means this extension does not exist for this actor. Running
    // its collectors anyway would be exactly the leak `hidden` exists to
    // prevent, so a hidden extension is stopped, not merely unpainted.
    const present = new Set(
      extensions.filter((extension) => extension.hidden !== true).map((extension) => extension.id),
    );

    // Copied: the loop deletes from `running`.
    for (const [id, entry] of Array.from(running)) {
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
        // consumer rebuilt the extension inside render, its state is silently
        // lost. `{...ext, hidden}` keeps the same `start` reference, so this
        // does not fire for that legitimate pattern.
        if (existing.start !== extension.start && !identityWarnedRef.current.has(extension.id)) {
          identityWarnedRef.current.add(extension.id);
          // eslint-disable-next-line no-console
          console.warn(
            `[dev-toolbar] extension "${extension.id}" was rebuilt after it started. ` +
              "Its start() lifecycle still belongs to the first object, so whatever " +
              "that object owns is unreachable from what the bar now renders. Build " +
              "extensions once, at module scope, not inside render.",
          );
        }
        continue;
      }
      const controller = new AbortController();
      const api: ExtensionRuntimeApi = {
        signal: controller.signal,
        isVisible: () => store.getSnapshot().visible,
        subscribeVisibility: (callback) => {
          // The signal is documented as aborted on teardown, and this is the
          // subscription abort must release, so an extension keeping only the
          // signal is a legal reading of the contract. Already aborted at call
          // time: subscribe to nothing rather than leak an unreleasable listener.
          if (controller.signal.aborted) return () => {};

          let last = store.getSnapshot().visible;
          const unsubscribeStore = store.subscribe(() => {
            const next = store.getSnapshot().visible;
            if (next === last) return;
            last = next;
            // Caught here, not in the store's `emit`: this callback is
            // extension code running inside whatever flipped visibility, and
            // letting it throw would abort the notification loop for every
            // extension after this one.
            try {
              callback(next);
            } catch (error) {
              // eslint-disable-next-line no-console
              console.error(
                `[dev-toolbar] extension "${extension.id}" threw from its ` +
                  "subscribeVisibility() callback.",
                error,
              );
            }
          });

          // Idempotent and removes the abort listener too, so nothing leaks
          // regardless of whether the extension unsubscribes or the signal
          // aborts first.
          let released = false;
          const unsubscribe = () => {
            if (released) return;
            released = true;
            unsubscribeStore();
            controller.signal.removeEventListener("abort", unsubscribe);
          };
          controller.signal.addEventListener("abort", unsubscribe, { once: true });
          return unsubscribe;
        },
        storage: createExtensionStorage(rawStorage, instanceId, extension.id),
        getCommands: () => collectCommands(extensionsRef.current),
        runCommand: (id: string) => runCommand(id, collectCommands(extensionsRef.current)),
        // Reads through the ref, like `getCommands`, so a snapshot taken now
        // reflects the extension list now.
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
        console.error(`[dev-toolbar] extension "${extension.id}" threw from start().`, error);
      }
    }
  }, [extensions, enabled, store, rawStorage, instanceId]);

  useEffect(() => {
    const running = runningRef.current;
    return () => {
      for (const [id, entry] of Array.from(running)) stopExtension(id, entry);
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
      // Listener is on `window`, so `document` handlers ran first:
      // `defaultPrevented` is how a host claims the chord. `isComposing` keeps
      // IME out; `repeat` keeps a held chord from flickering the bar.
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (!matchesShortcut(event, parsedShortcut)) return;
      event.preventDefault();
      store.toggleVisible();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, parsedShortcut, store]);

  // Publish the height variables on the document element.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const shouldRender = enabled && mounted && state.visible;
  // What this instance owns, and therefore all it ever removes.
  const heightVariables = useMemo(
    () =>
      instanceId === DEFAULT_INSTANCE_ID
        ? [HEIGHT_VARIABLE, instanceHeightVariable(instanceId)]
        : [instanceHeightVariable(instanceId)],
    [instanceId],
  );
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    const root = document.documentElement;
    const node = rootRef.current;
    const write = (value: string) => {
      for (const name of heightVariables) root.style.setProperty(name, value);
    };
    const clear = () => {
      for (const name of heightVariables) root.style.removeProperty(name);
    };
    if (!shouldRender || !node) {
      write("0px");
      return clear;
    }

    const publish = () => write(`${Math.round(node.getBoundingClientRect().height)}px`);
    publish();

    if (typeof ResizeObserver === "undefined") return clear;
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      clear();
    };
  }, [
    enabled,
    shouldRender,
    heightVariables,
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

  const target = container ?? (typeof document === "undefined" ? null : document.body);

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
    console.error(`[dev-toolbar] extension "${id}" threw from its start() cleanup.`, error);
  }
}
