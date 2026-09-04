import { memo } from "react";
import type { ReactNode } from "react";
import type {
  DevToolbarClassNames,
  DevToolbarExtension,
  OverlaySlotProps,
  ToolbarDensity,
  ToolbarPosition,
} from "./contract";
import { cx } from "./context";
import { ExtensionBoundary } from "./ExtensionBoundary";
import { Slot } from "./Bar";

export interface OverlayHostProps {
  extensions: readonly DevToolbarExtension[];
  density: ToolbarDensity;
  position: ToolbarPosition;
  classNames?: DevToolbarClassNames | undefined;
  styleNonce?: string | undefined;
}

/**
 * Renders every extension's `overlay` slot, once each, inside the toolbar root.
 * Overlays are never collapsed (they occupy no horizontal space) and have no
 * single-active invariant — each is the extension's own modal, and most render
 * `null` most of the time. They live inside the root so `--dtb-*` tokens,
 * color-scheme/density attributes and `@layer` scoping reach them, and so a
 * `position: fixed` overlay covers the viewport rather than just the bar.
 * `hidden` extensions render nothing, as elsewhere.
 *
 * Memoized on its props so an overlay slot doesn't re-invoke on every
 * panel-height drag frame or active-panel change, which none of them care about.
 * `styleNonce` is a stable string, so it costs nothing, but it is a prop and
 * belongs in the comparison.
 */
function OverlayHostImpl({
  extensions,
  density,
  position,
  classNames,
  styleNonce,
}: OverlayHostProps): ReactNode {
  const hosted = extensions.filter(
    (extension) => extension.hidden !== true && typeof extension.overlay === "function",
  );
  if (hosted.length === 0) return null;

  const props: OverlaySlotProps = {
    density,
    position,
    ...(styleNonce ? { styleNonce } : {}),
  };

  return (
    <>
      {hosted.map((extension) => (
        <div
          key={extension.id}
          data-dtb-part="overlay"
          data-dtb-ext-id={extension.id}
          className={cx(classNames?.overlay)}
        >
          <ExtensionBoundary
            extensionId={extension.id}
            label={extension.label}
            slot="overlay"
            classNames={classNames}
          >
            <Slot
              render={extension.overlay as (props: OverlaySlotProps) => ReactNode}
              props={props}
            />
          </ExtensionBoundary>
        </div>
      ))}
    </>
  );
}

export const OverlayHost = memo(OverlayHostImpl);
