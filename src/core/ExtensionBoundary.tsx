import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import type { DevToolbarClassNames } from "./contract";
import { cx } from "./context";

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
  override state: ExtensionBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ExtensionBoundaryState {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(
      `[dev-toolbar] extension "${this.props.extensionId}" crashed in its ${this.props.slot} slot.`,
      error,
      info.componentStack,
    );
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
