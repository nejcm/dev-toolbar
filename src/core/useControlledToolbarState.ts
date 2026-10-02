import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { ToolbarColorScheme, ToolbarDensity, ToolbarPosition } from "./contract";
import type { DevToolbarProps } from "./DevToolbar";
import { useLatestRef } from "./latest";
import type { ToolbarState, ToolbarStore } from "./store";

export type ToolbarSettingsSections = Required<
  Exclude<DevToolbarProps["settings"], false | undefined>
>;

function resolveSettings(settings: DevToolbarProps["settings"]): ToolbarSettingsSections {
  if (settings === undefined) {
    return { position: true, density: true, colorScheme: true, extensions: true };
  }
  if (settings === false) {
    return { position: false, density: false, colorScheme: false, extensions: false };
  }
  return {
    position: settings.position === true,
    density: settings.density === true,
    colorScheme: settings.colorScheme === true,
    extensions: settings.extensions === true,
  };
}

export function useControlledToolbarState(
  store: ToolbarStore,
  state: ToolbarState,
  props: Pick<
    DevToolbarProps,
    "visible" | "position" | "settings" | "onVisibleChange" | "onPositionChange" | "onPanelChange"
  > & { density: ToolbarDensity; colorScheme: ToolbarColorScheme },
): {
  visible: boolean;
  position: ToolbarPosition;
  density: ToolbarDensity;
  colorScheme: ToolbarColorScheme;
  settings: ToolbarSettingsSections;
  setVisible(next: boolean): void;
  toggleVisible(): void;
  setPosition(next: ToolbarPosition): void;
  /** For `ExtensionRuntimeApi`: last committed effective visibility. */
  visibleRef: RefObject<boolean>;
  /** For `ExtensionRuntimeApi.subscribeVisibility`. */
  subscribeVisibility(callback: (visible: boolean) => void): () => void;
} {
  const { visible: visibleProp, position: positionProp } = props;
  const settings = resolveSettings(props.settings);
  const visibleControlled = visibleProp !== undefined;
  const positionControlled = positionProp !== undefined;
  const hasVisibleChangeHandler = props.onVisibleChange !== undefined;
  const hasPositionChangeHandler = props.onPositionChange !== undefined;
  const effectiveVisible = visibleProp ?? state.visible;
  const effectivePosition =
    positionProp ?? (settings.position ? state.position : store.getServerSnapshot().position);
  const effectiveDensity = settings.density ? (state.density ?? props.density) : props.density;
  const effectiveColorScheme = settings.colorScheme
    ? (state.colorScheme ?? props.colorScheme)
    : props.colorScheme;
  const visibilitySubscribersRef = useRef(new Set<(visible: boolean) => void>());
  const lastNotifiedVisibleRef = useRef(effectiveVisible);
  const visibleRef = useLatestRef(effectiveVisible);
  const onVisibleChangeRef = useLatestRef(props.onVisibleChange);
  const onPositionChangeRef = useLatestRef(props.onPositionChange);
  const onPanelChangeRef = useLatestRef(props.onPanelChange);

  useEffect(() => {
    if (lastNotifiedVisibleRef.current === effectiveVisible) return;
    lastNotifiedVisibleRef.current = effectiveVisible;
    for (const subscriber of Array.from(visibilitySubscribersRef.current)) {
      subscriber(effectiveVisible);
    }
  }, [effectiveVisible]);

  const subscribeVisibility = useCallback((callback: (visible: boolean) => void) => {
    visibilitySubscribersRef.current.add(callback);
    return () => {
      visibilitySubscribersRef.current.delete(callback);
    };
  }, []);

  const reportVisibleChange = useCallback(
    (next: boolean): void => {
      try {
        onVisibleChangeRef.current?.(next);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[dev-toolbar] onVisibleChange handler threw.", error);
      }
    },
    [onVisibleChangeRef],
  );
  const reportPositionChange = useCallback(
    (next: ToolbarPosition): void => {
      try {
        onPositionChangeRef.current?.(next);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[dev-toolbar] onPositionChange handler threw.", error);
      }
    },
    [onPositionChangeRef],
  );
  const reportPanelChange = useCallback(
    (next: string | null): void => {
      try {
        onPanelChangeRef.current?.(next);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[dev-toolbar] onPanelChange handler threw.", error);
      }
    },
    [onPanelChangeRef],
  );

  // The baseline is the snapshot the *first render* saw, not the one that
  // exists when the observer subscribes: React runs a descendant's effects
  // before the parent's, so a child calling `setVisible`/`setPosition`/
  // `openPanel` in its own mount effect has already mutated the store by the
  // time this effect runs. Baselining here would swallow exactly that change.
  // Reading through the store rather than the rendered `state` keeps
  // hydration honest too — `state` is the *server* snapshot on the first
  // client render, so it would make every persisted preference look like a
  // change and fire the callbacks on mount.
  const observedStateRef = useRef(store.getSnapshot());
  useEffect(() => {
    const observe = () => {
      const previous = observedStateRef.current;
      const next = store.getSnapshot();
      if (next === previous) return;
      observedStateRef.current = next;
      if (next.visible !== previous.visible) reportVisibleChange(next.visible);
      if (settings.position && next.position !== previous.position) {
        reportPositionChange(next.position);
      }
      if (next.activePanelId !== previous.activePanelId) reportPanelChange(next.activePanelId);
    };
    // Reconcile before subscribing, so a mutation that landed between the
    // first render and this line is reported rather than lost.
    observe();
    return store.subscribe(observe);
  }, [store, reportVisibleChange, reportPositionChange, reportPanelChange, settings.position]);

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
    onPositionChangeRef,
    onVisibleChangeRef,
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
  // Not closed over visibility: a stable identity keeps `useToolbarShortcuts`'s
  // listener in place, and the store's sync state makes two batched toggles cancel.
  const toggleVisible = useCallback(
    () => (visibleControlled ? setVisible(!visibleRef.current) : store.toggleVisible()),
    [visibleControlled, visibleRef, setVisible, store],
  );
  const setPosition = useCallback(
    (next: ToolbarPosition) => {
      if (positionControlled) {
        if (next !== positionProp) reportPositionChange(next);
        return;
      }
      if (!settings.position) return;
      store.setPosition(next);
    },
    [positionControlled, positionProp, reportPositionChange, settings.position, store],
  );

  return {
    visible: effectiveVisible,
    position: effectivePosition,
    density: effectiveDensity,
    colorScheme: effectiveColorScheme,
    settings,
    setVisible,
    toggleVisible,
    setPosition,
    visibleRef,
    subscribeVisibility,
  };
}
