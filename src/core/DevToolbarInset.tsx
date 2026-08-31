import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { useOptionalDevToolbar } from "./context";
import { HEIGHT_VARIABLE } from "./DevToolbar";

export interface DevToolbarInsetProps
  extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

/**
 * Opt-in inset. The bar overlays the app by default; wrap content in this when
 * you would rather pad it out of the way. Collapses to zero padding when the
 * toolbar is disabled or hidden.
 */
export function DevToolbarInset({
  children,
  style,
  ...rest
}: DevToolbarInsetProps): ReactNode {
  const toolbar = useOptionalDevToolbar();
  // Position and visibility come from persisted state, which the server cannot
  // know. Both stay at their defaults until the toolbar reports it has mounted,
  // so server HTML and the first client render always agree.
  const settled = toolbar !== null && toolbar.mounted;
  const position = settled ? toolbar.position : "bottom";
  const active = settled && toolbar.enabled && toolbar.visible;
  const padding = active ? `var(${HEIGHT_VARIABLE}, 0px)` : "0px";

  const insetStyle: CSSProperties = {
    ...(position === "bottom"
      ? { paddingBottom: padding }
      : { paddingTop: padding }),
    ...style,
  };

  return (
    <div data-dtb-part="inset" data-dtb-position={position} style={insetStyle} {...rest}>
      {children}
    </div>
  );
}
