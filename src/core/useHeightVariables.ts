import { useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { ToolbarPosition } from "./contract";
import { resolveMeasurer } from "./measurer";

/**
 * CSS custom property published on `document.documentElement` while exactly
 * one toolbar is mounted and enabled, whatever its `instanceId`. Measures the
 * whole toolbar root — bar *plus* open panel — so insetting by it never leaves
 * content underneath an expanded panel.
 *
 * With two or more instances mounted nobody owns this name and it is removed;
 * each instance still publishes its own {@link instanceHeightVariable}, and
 * the last one standing takes the unsuffixed name back.
 */
export const HEIGHT_VARIABLE = "--dev-toolbar-height";

/**
 * The `instanceId` default.
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
 * unsuffixed name is published only while a single instance is mounted.
 *
 * `instanceId` is arbitrary, so non-CSS-identifier characters are folded to
 * `_` rather than escaped — ids differing only in punctuation collide, hence
 * `[A-Za-z0-9_-]` ids are safest.
 */
export function instanceHeightVariable(instanceId: string): string {
  return `${HEIGHT_VARIABLE}-${instanceId.replace(/[^A-Za-z0-9_-]+/g, "_")}`;
}

/** One mounted, enabled toolbar; `value` is `null` until its first measurement lands. */
interface MountedInstance {
  value: string | null;
}

// On `globalThis` like `MEASURER_SLOT`: two copies of this module on one page
// must share one count, or each believes itself alone (architecture.md §2, "No global registry").
const INSTANCES_SLOT: unique symbol = Symbol.for("@nejcm/dev-toolbar.instances");

type InstancesSlot = { [INSTANCES_SLOT]?: Set<MountedInstance> | undefined };

function mountedInstances(): Set<MountedInstance> {
  const host = globalThis as InstancesSlot;
  return (host[INSTANCES_SLOT] ??= new Set());
}

// Always from the whole registry, so the order two instances' effects run in is irrelevant.
function reconcile(): void {
  const instances = mountedInstances();
  const root = document.documentElement;
  const [sole] = instances;
  if (instances.size === 1 && sole !== undefined && sole.value !== null) {
    root.style.setProperty(HEIGHT_VARIABLE, sole.value);
  } else {
    root.style.removeProperty(HEIGHT_VARIABLE);
  }
}

function registerInstance(): MountedInstance {
  const instance: MountedInstance = { value: null };
  mountedInstances().add(instance);
  reconcile();
  return instance;
}

function unregisterInstance(instance: MountedInstance): void {
  mountedInstances().delete(instance);
  reconcile();
}

function publishInstanceHeight(instance: MountedInstance | null, value: string): void {
  if (instance === null) return;
  instance.value = value;
  reconcile();
}

/** Test harness only (`vitest.setup.ts`): forgets a registration an unmount that threw left behind. */
export function resetMountedInstances(): void {
  mountedInstances().clear();
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
  // What this instance owns, and therefore all it ever removes itself.
  const instanceVariable = useMemo(() => instanceHeightVariable(instanceId), [instanceId]);

  // Keyed on `enabled` alone so a re-measure never re-registers. Must stay
  // declared before the measuring effect: effects run in declaration order, and
  // the first `write` reports to this token ("publishes on re-enable" pins it).
  const instanceRef = useRef<MountedInstance | null>(null);
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    const instance = registerInstance();
    instanceRef.current = instance;
    return () => {
      instanceRef.current = null;
      unregisterInstance(instance);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    const root = document.documentElement;
    const node = rootRef.current;
    const write = (value: string) => {
      root.style.setProperty(instanceVariable, value);
      publishInstanceHeight(instanceRef.current, value);
    };
    const clear = () => root.style.removeProperty(instanceVariable);
    if (!shouldRender || !node) {
      write("0px");
      return clear;
    }

    // Resolved inside `publish`, not once above it: the observer keeps this
    // closure long after the commit that made it, and the slot can be replaced
    // between two deliveries. A captured measurer would freeze the first
    // answer for the closure's whole life and keep publishing stale pixels.
    const publish = () => write(`${Math.round(resolveMeasurer().height(node))}px`);
    publish();

    // Whereas this resolution is used immediately, and the subscription it
    // returns is torn down with the effect — an observer cannot be swapped
    // retroactively, so the live measurer at setup is the right one to own it.
    const observer = resolveMeasurer().observe(publish);
    if (!observer) return clear;
    observer.sync([node]);
    return () => {
      observer.disconnect();
      clear();
    };
  }, [enabled, shouldRender, instanceVariable, position, panelHeight, activePanelId]);

  return rootRef;
}
