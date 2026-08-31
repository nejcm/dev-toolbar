import { useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import type {
  DevToolbarClassNames,
  DevToolbarExtension,
  PanelSlotProps,
  ToolbarDensity,
  ToolbarPosition,
} from "./contract";
import { cx } from "./context";
import { ExtensionBoundary } from "./ExtensionBoundary";
import { Slot } from "./Bar";
import { MAX_PANEL_HEIGHT, MIN_PANEL_HEIGHT, clampPanelHeight } from "./store";

export interface PanelHostProps {
  extensions: readonly DevToolbarExtension[];
  activePanelId: string | null;
  position: ToolbarPosition;
  density: ToolbarDensity;
  panelHeight: number;
  setPanelHeight: (height: number) => void;
  closePanel: (id?: string) => void;
  classNames?: DevToolbarClassNames | undefined;
}

const RESIZE_STEP = 16;

/**
 * Core owns the single-active-panel invariant: at most one panel is visible,
 * and a closed panel unmounts unless the extension opts into `keepMounted`.
 */
export function PanelHost({
  extensions,
  activePanelId,
  position,
  density,
  panelHeight,
  setPanelHeight,
  closePanel,
  classNames,
}: PanelHostProps): ReactNode {
  const openedRef = useRef(new Set<string>());
  // Live height during a drag. Persisting on every pointermove would
  // JSON-serialize to storage on each mouse event; the commit happens on
  // pointerup instead.
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const height = dragHeight ?? panelHeight;

  if (activePanelId && !openedRef.current.has(activePanelId)) {
    openedRef.current.add(activePanelId);
  }

  const mounted = extensions.filter((extension) => {
    if (typeof extension.panel !== "function") return false;
    if (extension.id === activePanelId) return true;
    return (
      extension.keepMounted === true && openedRef.current.has(extension.id)
    );
  });

  if (mounted.length === 0) return null;

  const style = {
    "--dtb-panel-height": `${height}px`,
  } as CSSProperties;

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);

    let latest = startHeight;
    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientY - startY;
      latest = clampPanelHeight(
        position === "bottom" ? startHeight - delta : startHeight + delta,
      );
      setDragHeight(latest);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setPanelHeight(latest);
      setDragHeight(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const onResizerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const grow = position === "bottom" ? "ArrowUp" : "ArrowDown";
    const shrink = position === "bottom" ? "ArrowDown" : "ArrowUp";
    // Each keypress is its own commit.
    if (event.key === grow) {
      event.preventDefault();
      setPanelHeight(height + RESIZE_STEP);
    } else if (event.key === shrink) {
      event.preventDefault();
      setPanelHeight(height - RESIZE_STEP);
    }
  };

  return (
    <>
      {mounted.map((extension) => {
        const isActive = extension.id === activePanelId;
        const slotProps: PanelSlotProps = {
          isActive,
          density,
          height,
          close: () => closePanel(extension.id),
        };
        return (
          <div
            key={extension.id}
            data-dtb-part="panel"
            data-dtb-ext-id={extension.id}
            data-dtb-active={isActive ? "true" : undefined}
            className={cx(classNames?.panel)}
            style={style}
            hidden={!isActive}
            role="region"
            aria-label={extension.label}
          >
            <div
              data-dtb-part="panel-resizer"
              className={cx(classNames?.panelResizer)}
              role="separator"
              aria-label="Resize developer toolbar panel"
              aria-orientation="horizontal"
              aria-valuenow={height}
              aria-valuemin={MIN_PANEL_HEIGHT}
              aria-valuemax={MAX_PANEL_HEIGHT}
              tabIndex={0}
              onPointerDown={startResize}
              onKeyDown={onResizerKeyDown}
            />
            <div data-dtb-part="panel-body">
              <ExtensionBoundary
                extensionId={extension.id}
                label={extension.label}
                slot="panel"
                classNames={classNames}
              >
                <Slot
                  render={
                    extension.panel as (props: PanelSlotProps) => ReactNode
                  }
                  props={slotProps}
                />
              </ExtensionBoundary>
            </div>
          </div>
        );
      })}
    </>
  );
}
