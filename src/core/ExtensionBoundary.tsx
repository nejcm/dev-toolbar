import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import type { DevToolbarClassNames } from "./contract";
import { cx } from "./context";

export interface ExtensionBoundaryProps {
  extensionId: string;
  label: string;
  slot: "compact" | "panel";
  classNames?: DevToolbarClassNames | undefined;
  children: ReactNode;
}

interface ExtensionBoundaryState {
  error: Error | null;
}

/**
 * One boundary per extension slot. A throwing `compact` or `panel` degrades to
 * an error chip; the rest of the bar keeps rendering.
 */
export class ExtensionBoundary extends Component<
  ExtensionBoundaryProps,
  ExtensionBoundaryState
> {
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

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <span
        data-dtb-part="error-chip"
        data-dtb-ext-id={this.props.extensionId}
        data-dtb-slot={this.props.slot}
        className={cx(this.props.classNames?.errorChip)}
        title={error.message}
        role="status"
      >
        {this.props.label}: error
      </span>
    );
  }
}
