/**
 * `embed()` — the frame around a third-party devtool panel. [dev-toolbar/kit]
 * Core supplies the trigger, single-panel rule and error boundary; this adds
 * only the fiddly parts — a native-looking chip when asked for one, panel
 * height, deferred `render()`, `keepMounted` — and deliberately does not
 * scope, reset or restyle the embedded subtree (the frame carries
 * `data-dtb-embed`, core's opt-out). See docs/embedding.md.
 *
 * Without `value` or `compact` there is no compact slot: core's trigger, no
 * kit hook on the bar.
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

// Literal, not core's `CONTRACT_VERSION` — the kit never value-imports core
// (boundary suite enforces it); embed.test.tsx asserts the two stay equal.
const TARGET_CONTRACT_VERSION = 2;

export interface EmbedOptions {
  /** Extension id: dedupe, panel state, storage scope. */
  id: string;
  /** Bar label. The default chip reads it; the panel region is named by it. */
  label: string;
  /**
   * The third-party panel. Called with live `PanelSlotProps` — `height` is
   * the panel's current height in pixels, `close()` closes it — and **not
   * before the panel first opens**.
   */
  render: (props: PanelSlotProps) => ReactNode;
  /**
   * Something for the kit's chip to show beside the label — a count, a status
   * word. Giving it opts into that chip; without it (and without `compact`)
   * core renders its plain labelled trigger. Ignored when `compact` is supplied.
   */
  value?: ReactNode;
  /** Replace the trigger — core's, or the kit's chip — with your own compact slot. */
  compact?: (props: CompactSlotProps) => ReactNode;
  /**
   * Keep the embedded tool mounted, hidden, while the panel is closed — for a
   * tool that loses state or re-fetches on every mount. Default `false`.
   */
  keepMounted?: boolean;
  /** Show core's close button. Default `true`; set `false` if the tool has its own. */
  closeButton?: boolean;
  /**
   * The frame's `min-height` in pixels. Default `240`. Without it, a tool that
   * sizes itself from an auto-height container collapses to nothing.
   */
  minHeight?: number;
  align?: ToolbarAlign;
  order?: number;
  priority?: number;
  hidden?: boolean;
  /**
   * Ensure the kit stylesheet for the chip `value` opts into. Default `true`.
   * Injected only for that chip — never for core's trigger or the embedded tool.
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
    <div data-dtb-part="embed-frame" data-dtb-embed="" style={style}>
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
    closeButton = true,
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
    contractVersion: TARGET_CONTRACT_VERSION,
    align,
    order,
    priority,
    keepMounted,
    closeButton,
    ...(hidden === undefined ? {} : { hidden }),

    // Absent, not `undefined`: core renders its own trigger for an extension
    // with no `compact`, and that trigger is what the no-`value` case wants.
    ...(compact !== undefined
      ? { compact }
      : value !== undefined
        ? {
            compact: ({ isPanelOpen, togglePanel, styleNonce }: CompactSlotProps) => (
              <EmbedChip
                label={label}
                value={value}
                injectStyles={injectStyles}
                styleNonce={resolveStyleNonce(optionNonce, styleNonce)}
                isPanelOpen={isPanelOpen}
                togglePanel={togglePanel}
              />
            ),
          }
        : {}),

    panel: (slot) => <EmbedFrame render={render} slot={slot} style={frameStyle} />,
  };
}
