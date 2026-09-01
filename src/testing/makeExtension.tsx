import type { ReactNode } from "react";
import type {
  CompactSlotProps,
  DevToolbarExtension,
  PanelSlotProps,
  ToolbarCommand,
} from "../core/contract";

let counter = 0;

/**
 * Resets the auto-generated id counter.
 *
 * Only needed when a test asserts on a generated `fake-N` id; prefer passing an
 * explicit `id`.
 */
export function resetExtensionIds(): void {
  counter = 0;
}

export interface MakeExtensionOptions
  extends Partial<Omit<DevToolbarExtension, "compact" | "panel">> {
  /**
   * `true` renders a default toggle button, a string renders that text inside
   * it, a function is used as the slot itself, `false` omits the slot so core
   * falls back to its own trigger. Default `true`.
   */
  compact?: boolean | string | ((props: CompactSlotProps) => ReactNode);
  /** Same shape as `compact`, but for the panel slot. Default `false`. */
  panel?: boolean | string | ((props: PanelSlotProps) => ReactNode);
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
 * Builds a throwaway extension for tests.
 *
 * `makeExtension()` on its own yields a valid extension with a generated id, a
 * clickable compact slot and no panel. Everything else is opt-in.
 */
export function makeExtension(
  options: MakeExtensionOptions = {},
): DevToolbarExtension {
  const {
    compact = true,
    panel = false,
    throwInCompact = false,
    throwInPanel = false,
    throwInStart = false,
    ...rest
  } = options;

  counter += 1;
  const id = rest.id ?? `fake-${counter}`;
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
  counter += 1;
  const id = options.id ?? `fake-command-${counter}`;
  return {
    ...options,
    id,
    label: options.label ?? id,
    run: options.run ?? (() => {}),
  };
}
