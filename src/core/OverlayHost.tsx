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
}

/**
 * Renders every extension's `overlay` slot, once each, inside the toolbar root.
 *
 * Two things separate this from the bar: overlays are **never collapsed** —
 * overflow is about horizontal space and an overlay occupies none — and there
 * is no single-active invariant, because an overlay is the extension's own
 * modal and only it knows whether it is showing anything. Most render `null`
 * most of the time.
 *
 * They live inside the root so that the `--dtb-*` tokens, the color-scheme and
 * density attributes and the `@layer` scoping all reach them; the root sets no
 * containing block, so a `position: fixed` overlay still covers the viewport
 * rather than the 30px bar.
 *
 * `hidden` extensions render nothing here, like everywhere else.
 *
 * Memoized on exactly its four props, which is the whole of what it renders
 * from. Without it every overlay slot — and therefore every open palette —
 * re-invokes on each panel-height drag frame and each active-panel change, none
 * of which an overlay has any interest in.
 */
function OverlayHostImpl({
  extensions,
  density,
  position,
  classNames,
}: OverlayHostProps): ReactNode {
  const hosted = extensions.filter(
    (extension) => extension.hidden !== true && typeof extension.overlay === "function",
  );
  if (hosted.length === 0) return null;

  const props: OverlaySlotProps = { density, position };

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
