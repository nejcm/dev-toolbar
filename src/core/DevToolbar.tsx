import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  CONTRACT_VERSION,
  type DevToolbarClassNames,
  type DevToolbarExtension,
  type ExtensionErrorInfo,
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
import { collectCommands, invokeCommand, registerCommandHost } from "./commands";
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
  /** Controlled visibility. Requires `onVisibleChange` for internal controls. */
  visible?: boolean;
  /** Controlled position. Requires `onPositionChange` for internal controls. */
  position?: ToolbarPosition;
  onVisibleChange?: (visible: boolean) => void;
  onPositionChange?: (position: ToolbarPosition) => void;
  onPanelChange?: (activePanelId: string | null) => void;
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
  /** Called after core logs a slot failure. */
  onExtensionError?: (error: Error, info: ExtensionErrorInfo) => void;
  /**
   * CSP nonce for injected stylesheets. Required under a
   * `style-src 'self' 'nonce-…'` policy, where an un-nonced `<style>` is
   * dropped silently — the bar renders unstyled with nothing in the console
   * but a CSP report.
   *
   * Stamped on core's sheet and forwarded to every slot as `styleNonce`, so
   * first-party extensions pick it up without reading this prop. Applied only
   * when a sheet is created: first-writer-wins, so changing the nonce later
   * does not restyle an existing element. A factory `styleNonce` option, where
   * present, wins over this prop. With `injectStyles={false}` the prop does
   * nothing for core's sheet, because nothing is injected.
   */
  styleNonce?: string;
  /**
   * Class names merged onto core's own parts.
   *
   * Compared field by field, not by identity, so an object literal written
   * inline in JSX is fine and does not defeat the memoisation of the context
   * value or of the overlay host.
   */
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
const EMPTY_CLASS_NAMES: DevToolbarClassNames = {};

/** Field-by-field equality. Every value is `string | undefined`, so this is exact. */
function sameClassNames(a: DevToolbarClassNames, b: DevToolbarClassNames): boolean {
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof DevToolbarClassNames>;
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

/**
 * Holds one `classNames` object identity for as long as its *strings* are
 * unchanged.
 *
 * `classNames={{ bar: "x" }}` written inline in JSX is a new object every
 * render, and two things key on that identity: the context value's `useMemo`,
 * which would then re-run for every consumer of `useDevToolbar()`, and
 * `OverlayHost`'s `memo`, which would re-invoke every extension's overlay slot
 * on every panel-height drag frame — exactly the two costs those memos exist
 * to avoid.
 *
 * Chosen over documenting "hoist the object": the inline form is the natural
 * React idiom, a doc note is unenforceable, and eleven optional string fields
 * make the comparison exact rather than a heuristic. The ref is written during
 * render, which is safe because the write is idempotent and derived purely
 * from props — a discarded render can only store a value string-equal to the
 * one the retried render would produce.
 */
function useStableClassNames(next: DevToolbarClassNames | undefined): DevToolbarClassNames {
  const held = useRef<DevToolbarClassNames>(EMPTY_CLASS_NAMES);
  const value = next ?? EMPTY_CLASS_NAMES;
  /* oxlint-disable react/refs -- read and written in render on purpose, above. */
  if (!sameClassNames(held.current, value)) held.current = value;
  return held.current;
  /* oxlint-enable react/refs */
}

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
  visible: visibleProp,
  position: positionProp,
  onVisibleChange,
  onPositionChange,
  onPanelChange,
  storage: storageProp,
  injectStyles = true,
  onExtensionError,
  styleNonce,
  classNames: classNamesProp,
  shortcut = DEFAULT_SHORTCUT,
  container,
  className,
  style,
}: DevToolbarProps): ReactNode {
  const classNames = useStableClassNames(classNamesProp);
  const onExtensionErrorRef = useRef(onExtensionError);
  const onVisibleChangeRef = useRef(onVisibleChange);
  const onPositionChangeRef = useRef(onPositionChange);
  const onPanelChangeRef = useRef(onPanelChange);
  const effectiveVisibleRef = useRef(true);

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

  // The third argument is the *server* snapshot, and it is deliberately not
  // `getSnapshot`: storage is a browser fact, so hydration's first client
  // render has to see the same defaults the server did or every consumer
  // reading `position`/`visible` during render mismatches. See
  // `ToolbarStore.getServerSnapshot`.
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

  const visibleControlled = visibleProp !== undefined;
  const positionControlled = positionProp !== undefined;
  const hasVisibleChangeHandler = onVisibleChange !== undefined;
  const hasPositionChangeHandler = onPositionChange !== undefined;
  const effectiveVisible = visibleProp ?? state.visible;
  const effectivePosition = positionProp ?? state.position;
  const visibilitySubscribersRef = useRef(new Set<(visible: boolean) => void>());
  const lastNotifiedVisibleRef = useRef(effectiveVisible);
  /* oxlint-disable react/refs -- render-phase prop refs keep handlers and the effective visibility current. */
  onExtensionErrorRef.current = onExtensionError;
  onVisibleChangeRef.current = onVisibleChange;
  onPositionChangeRef.current = onPositionChange;
  onPanelChangeRef.current = onPanelChange;
  effectiveVisibleRef.current = effectiveVisible;
  /* oxlint-enable react/refs */
  const reportExtensionError = useCallback((error: Error, info: ExtensionErrorInfo): void => {
    onExtensionErrorRef.current?.(error, info);
  }, []);
  const reportVisibleChange = useCallback((next: boolean): void => {
    try {
      onVisibleChangeRef.current?.(next);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[dev-toolbar] onVisibleChange handler threw.", error);
    }
  }, []);
  const reportPositionChange = useCallback((next: ToolbarPosition): void => {
    try {
      onPositionChangeRef.current?.(next);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[dev-toolbar] onPositionChange handler threw.", error);
    }
  }, []);
  const reportPanelChange = useCallback((next: string | null): void => {
    try {
      onPanelChangeRef.current?.(next);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[dev-toolbar] onPanelChange handler threw.", error);
    }
  }, []);

  useEffect(() => {
    if (lastNotifiedVisibleRef.current === effectiveVisible) return;
    lastNotifiedVisibleRef.current = effectiveVisible;
    for (const subscriber of Array.from(visibilitySubscribersRef.current)) {
      subscriber(effectiveVisible);
    }
  }, [effectiveVisible]);

  useEffect(() => {
    let previous = store.getSnapshot();
    return store.subscribe(() => {
      const next = store.getSnapshot();
      const visibleChanged = next.visible !== previous.visible;
      const positionChanged = next.position !== previous.position;
      const panelChanged = next.activePanelId !== previous.activePanelId;
      previous = next;
      if (visibleChanged) reportVisibleChange(next.visible);
      if (positionChanged) reportPositionChange(next.position);
      if (panelChanged) reportPanelChange(next.activePanelId);
    });
  }, [store, reportVisibleChange, reportPositionChange, reportPanelChange]);

  const controlWarningsRef = useRef(new Set<string>());
  const previousVisibleControlledRef = useRef<boolean | null>(null);
  const previousPositionControlledRef = useRef<boolean | null>(null);
  const warnControlOnce = useCallback((key: string, message: string): void => {
    if (controlWarningsRef.current.has(key)) return;
    controlWarningsRef.current.add(key);
    // eslint-disable-next-line no-console
    console.warn(`[dev-toolbar] ${message}`);
  }, []);

  useEffect(() => {
    const previousVisibleControlled = previousVisibleControlledRef.current;
    if (previousVisibleControlled !== null && previousVisibleControlled !== visibleControlled) {
      const transition = previousVisibleControlled
        ? "controlled to uncontrolled"
        : "uncontrolled to controlled";
      warnControlOnce(
        `visible:${transition}`,
        `<DevToolbar> changed from ${transition} for "visible". Do not switch between controlled and uncontrolled props.`,
      );
    }
    previousVisibleControlledRef.current = visibleControlled;

    const previousPositionControlled = previousPositionControlledRef.current;
    if (previousPositionControlled !== null && previousPositionControlled !== positionControlled) {
      const transition = previousPositionControlled
        ? "controlled to uncontrolled"
        : "uncontrolled to controlled";
      warnControlOnce(
        `position:${transition}`,
        `<DevToolbar> changed from ${transition} for "position". Do not switch between controlled and uncontrolled props.`,
      );
    }
    previousPositionControlledRef.current = positionControlled;
  }, [positionControlled, visibleControlled, warnControlOnce]);

  useEffect(() => {
    if (visibleControlled && onVisibleChangeRef.current === undefined) {
      warnControlOnce(
        "visible:missing-callback",
        `<DevToolbar> controlled "visible" needs an "onVisibleChange" callback; internal visibility controls are inert.`,
      );
    }
    if (positionControlled && onPositionChangeRef.current === undefined) {
      warnControlOnce(
        "position:missing-callback",
        `<DevToolbar> controlled "position" needs an "onPositionChange" callback; internal position controls are inert.`,
      );
    }
  }, [
    hasPositionChangeHandler,
    hasVisibleChangeHandler,
    positionControlled,
    visibleControlled,
    warnControlOnce,
  ]);

  const setVisible = useCallback(
    (next: boolean) => {
      if (visibleControlled) {
        if (next !== visibleProp) reportVisibleChange(next);
        return;
      }
      store.setVisible(next);
    },
    [reportVisibleChange, store, visibleControlled, visibleProp],
  );
  const toggleVisible = useCallback(
    () => setVisible(!effectiveVisible),
    [effectiveVisible, setVisible],
  );
  const setPosition = useCallback(
    (next: ToolbarPosition) => {
      if (positionControlled) {
        if (next !== positionProp) reportPositionChange(next);
        return;
      }
      store.setPosition(next);
    },
    [positionControlled, positionProp, reportPositionChange, store],
  );

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
    (id: string, input?: unknown) =>
      invokeCommand(id, { input, scope: getCommands() }).then((outcome) => outcome.ok),
    [getCommands],
  );

  const scopedInvokeCommand = useCallback(
    <Out,>(id: string, input?: unknown) => invokeCommand<Out>(id, { input, scope: getCommands() }),
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
        isVisible: () => effectiveVisibleRef.current,
        subscribeVisibility: (callback) => {
          // The signal is documented as aborted on teardown, and this is the
          // subscription abort must release, so an extension keeping only the
          // signal is a legal reading of the contract. Already aborted at call
          // time: subscribe to nothing rather than leak an unreleasable listener.
          if (controller.signal.aborted) return () => {};

          const subscriber = (next: boolean) => {
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
          };
          visibilitySubscribersRef.current.add(subscriber);

          // Idempotent and removes the abort listener too, so nothing leaks
          // regardless of whether the extension unsubscribes or the signal
          // aborts first.
          let released = false;
          const unsubscribe = () => {
            if (released) return;
            released = true;
            visibilitySubscribersRef.current.delete(subscriber);
            controller.signal.removeEventListener("abort", unsubscribe);
          };
          controller.signal.addEventListener("abort", unsubscribe, { once: true });
          return unsubscribe;
        },
        storage: createExtensionStorage(rawStorage, instanceId, extension.id),
        getCommands: () => collectCommands(extensionsRef.current),
        runCommand: (id: string, input?: unknown) =>
          invokeCommand(id, { input, scope: collectCommands(extensionsRef.current) }).then(
            (outcome) => outcome.ok,
          ),
        invokeCommand: <Out,>(id: string, input?: unknown) =>
          invokeCommand<Out>(id, { input, scope: collectCommands(extensionsRef.current) }),
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

  // Style injection. `styleNonce` is in the deps because a host that resolves
  // its nonce asynchronously would otherwise inject before it arrives; the
  // re-run is a no-op once the sheet exists (first-writer-wins), so the only
  // thing it buys is the first injection landing with the nonce.
  useEffect(() => {
    if (!enabled || !injectStyles) return;
    ensureStyles(undefined, undefined, undefined, styleNonce);
  }, [enabled, injectStyles, styleNonce]);

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
      toggleVisible();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, parsedShortcut, toggleVisible]);

  // Publish the height variables on the document element.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const shouldRender = enabled && mounted && effectiveVisible;
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
    effectivePosition,
    state.panelHeight,
    state.activePanelId,
  ]);

  /* oxlint-disable react/use-memo, react-hooks/exhaustive-deps -- reporter is stable; handler presence is the only context dependency. */
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
      invokeCommand: scopedInvokeCommand,
      density,
      classNames,
      onExtensionError: onExtensionError ? reportExtensionError : undefined,
      storage: baseStorage,
      visible: effectiveVisible,
      position: effectivePosition,
      activePanelId: state.activePanelId,
      panelHeight: state.panelHeight,
      setVisible,
      toggleVisible,
      setPosition,
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
      scopedInvokeCommand,
      density,
      classNames,
      onExtensionError !== undefined,
      baseStorage,
      effectiveVisible,
      effectivePosition,
      setVisible,
      toggleVisible,
      setPosition,
      state,
    ],
  );
  /* oxlint-enable react/use-memo, react-hooks/exhaustive-deps */

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
              data-dtb-position={effectivePosition}
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
                styleNonce={styleNonce}
              />
              <OverlayHost
                extensions={extensions}
                density={density}
                position={effectivePosition}
                classNames={classNames}
                styleNonce={styleNonce}
              />
              <PanelHost
                extensions={extensions}
                activePanelId={state.activePanelId}
                position={effectivePosition}
                density={density}
                panelHeight={state.panelHeight}
                setPanelHeight={store.setPanelHeight}
                closePanel={store.closePanel}
                classNames={classNames}
                styleNonce={styleNonce}
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
