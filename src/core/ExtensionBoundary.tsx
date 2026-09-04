import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import type { DevToolbarClassNames } from "./contract";
import { DevToolbarContext, cx, type DevToolbarContextValue } from "./context";

export interface ExtensionBoundaryProps {
  extensionId: string;
  label: string;
  slot: "compact" | "panel" | "overlay";
  classNames?: DevToolbarClassNames | undefined;
  children: ReactNode;
}

interface ExtensionBoundaryState {
  error: Error | null;
}

/**
 * One boundary per extension slot. A throwing `compact` or `panel` degrades to an
 * error chip (with a retry button, since nothing else clears the caught error)
 * while the rest of the bar keeps rendering. The `overlay` chip has no retry — an
 * overlay has no reliable visible surface to click.
 */
export class ExtensionBoundary extends Component<ExtensionBoundaryProps, ExtensionBoundaryState> {
  static override contextType = DevToolbarContext;

  declare context: DevToolbarContextValue | null;

  override state: ExtensionBoundaryState = { error: null };

  /**
   * `String(error)` is a call into the thrown value: a hostile or merely broken
   * `toString` throws from here, and a throw inside `getDerivedStateFromError`
   * takes the whole React tree down instead of degrading one slot. Same guard,
   * and same fallback wording, as `describe()` in `diagnostics.ts`.
   */
  static getDerivedStateFromError(error: unknown): ExtensionBoundaryState {
    if (error instanceof Error) return { error };
    try {
      return { error: new Error(String(error)) };
    } catch {
      return { error: new Error("threw a value that could not be described") };
    }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(
      `[dev-toolbar] extension "${this.props.extensionId}" crashed in its ${this.props.slot} slot.`,
      error,
      info.componentStack,
    );

    const onExtensionError = this.context?.onExtensionError;
    const normalizedError = this.state.error;
    if (!onExtensionError || !normalizedError) return;

    try {
      onExtensionError(normalizedError, {
        extensionId: this.props.extensionId,
        label: this.props.label,
        slot: this.props.slot,
        componentStack: info.componentStack ?? null,
      });
    } catch (handlerError) {
      // eslint-disable-next-line no-console
      console.error(
        `[dev-toolbar] onExtensionError handler threw for extension "${this.props.extensionId}".`,
        handlerError,
      );
    }
  }

  private readonly retry = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { extensionId, label, slot, classNames } = this.props;
    const text = `${label}: error`;

    return (
      <span
        data-dtb-part="error-chip"
        data-dtb-ext-id={extensionId}
        data-dtb-slot={slot}
        className={cx(classNames?.errorChip)}
        title={error.message}
        role="status"
      >
        {slot === "overlay" ? (
          text
        ) : (
          <button
            type="button"
            data-dtb-part="error-retry"
            aria-label={`${text}. Retry`}
            onClick={this.retry}
          >
            {text}
          </button>
        )}
      </span>
    );
  }
}
