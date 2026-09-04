import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  type DevToolbarClassNames,
  type DevToolbarExtension,
  type ExtensionErrorInfo,
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
import { createInstanceStorage, resolveStorage } from "./storage";
import { createToolbarStore } from "./store";
import { DEFAULT_SHORTCUT } from "./shortcut";
import { ensureStyles } from "./styles";
import { useStableClassNames } from "./classNames";
import { useLatestRef } from "./latest";
import { useControlledToolbarState } from "./useControlledToolbarState";
import { useCommandHost } from "./useCommandHost";
import { useExtensionLifecycle } from "./useExtensionLifecycle";
import { DEFAULT_INSTANCE_ID, useHeightVariables } from "./useHeightVariables";
import { useToolbarShortcuts } from "./useToolbarShortcuts";
export { DEFAULT_INSTANCE_ID, HEIGHT_VARIABLE, instanceHeightVariable } from "./useHeightVariables";

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
  /**
   * Bind every aggregated command that declares a `shortcut`. Default `false`.
   *
   * Off by default because many existing `shortcut` strings are display-only
   * hints — some describe a host's own listener, which would then fire twice.
   * Bindings re-enumerate on each keydown, skip commands that declare `input`,
   * yield to {@link shortcut} (the toggle), fire while the bar is hidden, and
   * do not suppress while a text field has focus. First declaration wins; a
   * later command with the same chord warns once.
   */
  bindCommandShortcuts?: boolean;
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
  bindCommandShortcuts = false,
  container,
  className,
  style,
}: DevToolbarProps): ReactNode {
  const classNames = useStableClassNames(classNamesProp);
  // Latest prop values are seeded in render and updated at commit time.
  const onExtensionErrorRef = useLatestRef(onExtensionError);

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

  const extensionInput = useMemo(
    () => [...extensionsProp, ...state.registered],
    [extensionsProp, state.registered],
  );
  const {
    extensions,
    commands,
    getCommands,
    runCommand: scopedRunCommand,
    invokeCommand: scopedInvokeCommand,
    getDiagnostics,
  } = useCommandHost(extensionInput, enabled);

  const reportExtensionError = useCallback(
    (error: Error, info: ExtensionErrorInfo): void => {
      onExtensionErrorRef.current?.(error, info);
    },
    [onExtensionErrorRef],
  );
  const {
    visible: effectiveVisible,
    position: effectivePosition,
    setVisible,
    toggleVisible,
    setPosition,
    visibleRef,
    subscribeVisibility,
  } = useControlledToolbarState(store, state, {
    visible: visibleProp,
    position: positionProp,
    onVisibleChange,
    onPositionChange,
    onPanelChange,
  });

  // Client-only mount: the bar is never part of server HTML, so nothing to
  // hydrate or mismatch. Whether we've mounted can't be derived during
  // render — the effect running at all is the signal.
  const [mounted, setMounted] = useState(false);
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => setMounted(true), []);

  useExtensionLifecycle({
    enabled,
    extensions,
    activePanelId: state.activePanelId,
    store,
    rawStorage,
    instanceId,
    visibleRef,
    subscribeVisibility,
    getCommands,
    runCommand: scopedRunCommand,
    invokeCommand: scopedInvokeCommand,
    getDiagnostics,
  });

  // Style injection. `styleNonce` is in the deps because a host that resolves
  // its nonce asynchronously would otherwise inject before it arrives; the
  // re-run is a no-op once the sheet exists (first-writer-wins), so the only
  // thing it buys is the first injection landing with the nonce.
  useEffect(() => {
    if (!enabled || !injectStyles) return;
    ensureStyles(undefined, undefined, undefined, styleNonce);
  }, [enabled, injectStyles, styleNonce]);

  // Order against extensions matters and is deliberate: this effect is
  // declared *after* the `start(api)` effect, so a listener an extension put
  // up in `start()` is registered first and wins a chord both claim — its
  // `preventDefault()` makes this one bail on `defaultPrevented`. That is why
  // `/ext/command-menu`'s `Mod+K` beats a command bound to `Mod+K`, and why
  // core's binding gets the chord only in the case the palette declines it
  // (while the bar is hidden). Keep the declaration order. Core cannot warn
  // about the collision: it does not know which chords extension listeners
  // claim, and it may not import `ext/` to find out.
  useToolbarShortcuts({
    enabled,
    shortcut,
    bindCommandShortcuts,
    toggleVisible,
    getCommands,
  });

  // Publish the height variables on the document element.
  const shouldRender = enabled && mounted && effectiveVisible;
  const rootRef = useHeightVariables({
    enabled,
    shouldRender,
    instanceId,
    position: effectivePosition,
    panelHeight: state.panelHeight,
    activePanelId: state.activePanelId,
  });

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
