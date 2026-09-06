/**
 * `embed()` — the frame around a third-party devtool panel. [dev-toolbar/kit]
 *
 * Everything an embedded tool needs from the toolbar is already public: a
 * `{ id, label, panel }` object mounts one, core supplies the trigger, the
 * single-active-panel rule, `keepMounted`, and one error boundary per slot
 * (`src/core/ExtensionBoundary.tsx`). This helper adds none of that. It covers
 * the four things that are fiddly rather than hard — a native-looking chip, the
 * panel `height` handed through with a floor, the embedded `render()` left
 * uncalled until the panel first opens, and `keepMounted` as an option — and it
 * deliberately does **not** scope, reset or restyle the embedded subtree: the
 * frame is a bare `<div>` carrying only a `data-dtb-part`, and the one sheet it
 * ensures is the kit's, whose rules are keyed on `data-dtb-kind` attributes the
 * embedded tool never carries. `docs/embedding.md` is the recipe.
 */
import { useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import type {
  CompactSlotProps,
  DevToolbarExtension,
  PanelSlotProps,
  ToolbarAlign,
} from "../core/contract";
import { Chip } from "./controls";
import { resolveStyleNonce } from "./nonce";
import { ensureKitStyles } from "./styles";

/** The frame's default `min-height`, in pixels. */
const DEFAULT_MIN_HEIGHT = 240;

export interface EmbedOptions {
  /** Extension id: dedupe, panel state, storage scope. */
  id: string;
  /** Bar label. The default chip reads it; the panel region is named by it. */
  label: string;
  /**
   * The third-party panel. Called with the live `PanelSlotProps` — `height`
   * is the panel's current height in pixels, `close()` closes it — and **not
   * before the panel first opens**. Size the tool to the frame
   * (`style={{ height: "100%" }}`) or to `height` when it wants a number.
   */
  render: (props: PanelSlotProps) => ReactNode;
  /**
   * Something for the default chip to show beside the label — a count, a
   * status word. Pass an element that subscribes to the tool's own state for a
   * live value. Ignored when `compact` is supplied.
   */
  value?: ReactNode;
  /** Replace the default chip with your own compact slot. */
  compact?: (props: CompactSlotProps) => ReactNode;
  /**
   * Keep the embedded tool mounted, hidden, while the panel is closed — for a
   * tool that loses state or re-fetches on every mount. Default `false`: a
   * closed panel unmounts, as it does for every other extension.
   */
  keepMounted?: boolean;
  /**
   * The frame's `min-height` in pixels. Default `240`. A tool that sizes itself
   * from an auto-height container collapses to nothing without it; with it, a
   * panel dragged shorter scrolls the frame rather than crushing the tool.
   */
  minHeight?: number;
  align?: ToolbarAlign;
  order?: number;
  priority?: number;
  hidden?: boolean;
  /**
   * Ensure the kit stylesheet for the default chip. Default `true`. This is the
   * only sheet the helper touches; nothing is injected for the embedded tool.
   */
  injectStyles?: boolean;
  /** CSP nonce for that sheet. Wins over the `styleNonce` slot prop core forwards. */
  styleNonce?: string;
}

interface EmbedChipProps extends Pick<CompactSlotProps, "isPanelOpen" | "togglePanel"> {
  label: string;
  value: ReactNode;
  injectStyles: boolean;
  styleNonce: string | undefined;
}

function EmbedChip({
  label,
  value,
  injectStyles,
  styleNonce,
  isPanelOpen,
  togglePanel,
}: EmbedChipProps): ReactNode {
  useEffect(() => {
    if (injectStyles) ensureKitStyles(undefined, styleNonce);
  }, [injectStyles, styleNonce]);

  return (
    <button type="button" data-dtb-part="trigger" aria-expanded={isPanelOpen} onClick={togglePanel}>
      <Chip
        label={label}
        value={value}
        data-dtb-part="embed-chip"
        dotProps={{ "data-dtb-part": "embed-dot" }}
        labelProps={{ "data-dtb-part": "embed-label" }}
        valueProps={{ "data-dtb-part": "embed-value" }}
      />
    </button>
  );
}

interface EmbedFrameProps {
  render: (props: PanelSlotProps) => ReactNode;
  slot: PanelSlotProps;
  style: CSSProperties;
}

/**
 * A component, not a call inside the slot function, so `render()` runs when the
 * frame *mounts* — which core only does once the panel opens — and never while
 * core is merely deciding what to mount.
 */
function EmbedFrame({ render, slot, style }: EmbedFrameProps): ReactNode {
  return (
    <div data-dtb-part="embed-frame" style={style}>
      {render(slot)}
    </div>
  );
}

/**
 * Builds an extension that hosts a third-party panel. Call it once, at module
 * scope, like every other factory — the object identity is the lifecycle.
 *
 * ```tsx
 * import { embed } from "@nejcm/dev-toolbar/kit";
 * import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
 *
 * const queryDevtools = embed({
 *   id: "tanstack-query",
 *   label: "Query",
 *   keepMounted: true,
 *   render: ({ close }) => (
 *     <ReactQueryDevtoolsPanel client={queryClient} style={{ height: "100%" }} onClose={close} />
 *   ),
 * });
 * ```
 */
export function embed(options: EmbedOptions): DevToolbarExtension {
  const {
    id,
    label,
    render,
    value,
    compact,
    keepMounted = false,
    minHeight = DEFAULT_MIN_HEIGHT,
    align = "start",
    order = 0,
    priority = 0,
    hidden,
    injectStyles = true,
    styleNonce: optionNonce,
  } = options;

  // `height: 100%` resolves against the panel body, whose height core owns, so
  // a tool that fills the frame tracks the resizer without measuring anything.
  const frameStyle: CSSProperties = { height: "100%", minHeight: `${minHeight}px` };

  return {
    id,
    label,
    contractVersion: 2,
    align,
    order,
    priority,
    keepMounted,
    ...(hidden === undefined ? {} : { hidden }),

    compact:
      compact ??
      (({ isPanelOpen, togglePanel, styleNonce }) => (
        <EmbedChip
          label={label}
          value={value}
          injectStyles={injectStyles}
          styleNonce={resolveStyleNonce(optionNonce, styleNonce)}
          isPanelOpen={isPanelOpen}
          togglePanel={togglePanel}
        />
      )),

    panel: (slot) => <EmbedFrame render={render} slot={slot} style={frameStyle} />,
  };
}
