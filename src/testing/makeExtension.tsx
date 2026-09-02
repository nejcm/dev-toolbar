import type { ReactNode } from "react";
import type {
  CompactSlotProps,
  DevToolbarExtension,
  OverlaySlotProps,
  PanelSlotProps,
  ToolbarCommand,
} from "../core/contract";

const extensionCounter = { current: 0 };
const commandCounter = { current: 0 };

/** Generates the next `<prefix>-N` id, mutating the counter as a side effect. */
const nextId = (prefix: string, counter: { current: number }): string =>
  `${prefix}-${++counter.current}`;

/**
 * Resets both auto-generated id counters — `makeExtension`'s `fake-N` and
 * `makeCommand`'s `fake-command-N` — back to zero; they are independent.
 * Only needed when a test asserts on a generated id.
 */
export function resetExtensionIds(): void {
  extensionCounter.current = 0;
  commandCounter.current = 0;
}

export interface MakeExtensionOptions extends Partial<
  Omit<DevToolbarExtension, "compact" | "panel" | "overlay">
> {
  /**
   * `true` renders a default toggle button, a string renders that text inside
   * it, a function is used as the slot itself, `false` omits the slot so core
   * falls back to its own trigger. Default `true`.
   */
  compact?: boolean | string | ((props: CompactSlotProps) => ReactNode);
  /** Same shape as `compact`, but for the panel slot. Default `false`. */
  panel?: boolean | string | ((props: PanelSlotProps) => ReactNode);
  /**
   * Same shape again, for the overlay slot — the one core never collapses.
   * Default `false`.
   */
  overlay?: boolean | string | ((props: OverlaySlotProps) => ReactNode);
  /** Throw from `overlay`. */
  throwInOverlay?: boolean | Error;
  /** Throw from `compact` — exercises the per-extension error boundary. */
  throwInCompact?: boolean | Error;
  /** Throw from `panel`. */
  throwInPanel?: boolean | Error;
  /** Throw from `start(api)`. */
  throwInStart?: boolean | Error;
}

const asError = (value: boolean | Error, message: string): Error =>
  value instanceof Error ? value : new Error(message);

/**
 * Builds a throwaway extension for tests. Called with no options, it yields a
 * valid extension with a generated id, a clickable compact slot, and no panel.
 */
export function makeExtension(options: MakeExtensionOptions = {}): DevToolbarExtension {
  const {
    compact = true,
    panel = false,
    overlay = false,
    throwInCompact = false,
    throwInPanel = false,
    throwInOverlay = false,
    throwInStart = false,
    ...rest
  } = options;

  const id = rest.id ?? nextId("fake", extensionCounter);
  const label = rest.label ?? id;

  const extension: DevToolbarExtension = { ...rest, id, label };

  if (throwInCompact !== false) {
    extension.compact = () => {
      throw asError(throwInCompact, `[test] extension "${id}" compact threw`);
    };
  } else if (typeof compact === "function") {
    extension.compact = compact;
  } else if (compact !== false) {
    const text = typeof compact === "string" ? compact : label;
    extension.compact = ({ isPanelOpen, togglePanel }) => (
      <button
        type="button"
        data-dtb-part="trigger"
        data-testid={`dtb-compact-${id}`}
        aria-expanded={isPanelOpen}
        onClick={togglePanel}
      >
        {text}
      </button>
    );
  }

  if (throwInPanel !== false) {
    extension.panel = () => {
      throw asError(throwInPanel, `[test] extension "${id}" panel threw`);
    };
  } else if (typeof panel === "function") {
    extension.panel = panel;
  } else if (panel !== false) {
    const text = typeof panel === "string" ? panel : `${label} panel`;
    extension.panel = () => <div data-testid={`dtb-panel-${id}`}>{text}</div>;
  }

  if (throwInOverlay !== false) {
    extension.overlay = () => {
      throw asError(throwInOverlay, `[test] extension "${id}" overlay threw`);
    };
  } else if (typeof overlay === "function") {
    extension.overlay = overlay;
  } else if (overlay !== false) {
    const text = typeof overlay === "string" ? overlay : `${label} overlay`;
    extension.overlay = () => <div data-testid={`dtb-overlay-${id}`}>{text}</div>;
  }

  if (throwInStart !== false) {
    extension.start = () => {
      throw asError(throwInStart, `[test] extension "${id}" start threw`);
    };
  }

  return extension;
}

export interface MakeCommandOptions extends Partial<ToolbarCommand> {}

/** A `ToolbarCommand` with sensible defaults. Pass your own spy as `run`. */
export function makeCommand(options: MakeCommandOptions = {}): ToolbarCommand {
  const id = options.id ?? nextId("fake-command", commandCounter);
  return {
    ...options,
    id,
    label: options.label ?? id,
    run: options.run ?? (() => {}),
  };
}
