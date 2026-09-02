import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { useOptionalDevToolbar } from "./context";
import { HEIGHT_VARIABLE, instanceHeightVariable } from "./DevToolbar";

export interface DevToolbarInsetProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

/**
 * Opt-in inset. The bar overlays the app by default; wrap content in this when
 * you would rather pad it out of the way. Collapses to zero padding when the
 * toolbar is disabled or hidden.
 */
export function DevToolbarInset({ children, style, ...rest }: DevToolbarInsetProps): ReactNode {
  const toolbar = useOptionalDevToolbar();
  // Position/visibility come from persisted state (unknown to the server), so both
  // stay at their defaults until the toolbar reports mounted, keeping SSR and the
  // first client render in sync.
  const settled = toolbar !== null && toolbar.mounted;
  const position = settled ? toolbar.position : "bottom";
  const active = settled && toolbar.enabled && toolbar.visible;
  // Prefer this instance's own variable; fall back to the unsuffixed name so a
  // host that sets it by hand still drives the inset.
  const padding = active
    ? `var(${instanceHeightVariable(toolbar.instanceId)}, var(${HEIGHT_VARIABLE}, 0px))`
    : "0px";

  const insetStyle: CSSProperties = {
    ...(position === "bottom" ? { paddingBottom: padding } : { paddingTop: padding }),
    ...style,
  };

  return (
    <div data-dtb-part="inset" data-dtb-position={position} style={insetStyle} {...rest}>
      {children}
    </div>
  );
}
