import { useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { ToolbarPosition } from "./contract";

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

export function useHeightVariables(options: {
  enabled: boolean;
  shouldRender: boolean;
  instanceId: string;
  position: ToolbarPosition;
  panelHeight: number;
  activePanelId: string | null;
}): RefObject<HTMLDivElement | null> {
  const { enabled, shouldRender, instanceId, position, panelHeight, activePanelId } = options;
  const rootRef = useRef<HTMLDivElement | null>(null);
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
  }, [enabled, shouldRender, heightVariables, position, panelHeight, activePanelId]);

  return rootRef;
}
