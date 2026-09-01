import type { ReactNode } from "react";
import type {
  CompactSlotProps,
  DevToolbarClassNames,
  DevToolbarExtension,
  ToolbarDensity,
} from "./contract";
import { cx } from "./context";
import { ExtensionBoundary } from "./ExtensionBoundary";
import { OverflowBar } from "./Overflow";

/**
 * Renders a slot function inside a child component so that a throw lands in
 * the surrounding error boundary rather than in the bar's own render.
 */
export function Slot<T>({
  render,
  props,
}: {
  render: (props: T) => ReactNode;
  props: T;
}): ReactNode {
  return <>{render(props)}</>;
}

/** Visible extensions, split by region and sorted by `order` (stable on ties). */
export function sortExtensions(extensions: readonly DevToolbarExtension[]): {
  start: DevToolbarExtension[];
  end: DevToolbarExtension[];
} {
  const visible = extensions.filter((extension) => extension.hidden !== true);
  const byOrder = (a: DevToolbarExtension, b: DevToolbarExtension) =>
    (a.order ?? 0) - (b.order ?? 0);
  return {
    start: visible.filter((extension) => (extension.align ?? "start") === "start").sort(byOrder),
    end: visible.filter((extension) => extension.align === "end").sort(byOrder),
  };
}

export interface BarProps {
  extensions: readonly DevToolbarExtension[];
  density: ToolbarDensity;
  activePanelId: string | null;
  openPanel: (id: string) => void;
  closePanel: (id?: string) => void;
  togglePanel: (id: string) => void;
  classNames?: DevToolbarClassNames | undefined;
}

export function Bar({
  extensions,
  density,
  activePanelId,
  openPanel,
  closePanel,
  togglePanel,
  classNames,
}: BarProps): ReactNode {
  const { start, end } = sortExtensions(extensions);

  const renderItem = (
    extension: DevToolbarExtension,
    { isOverflowed }: { isOverflowed: boolean },
  ): ReactNode => {
    const isPanelOpen = activePanelId === extension.id;
    const hasPanel = typeof extension.panel === "function";
    const slotProps: CompactSlotProps = {
      isOverflowed,
      isPanelOpen,
      density,
      openPanel: () => openPanel(extension.id),
      closePanel: () => closePanel(extension.id),
      togglePanel: () => togglePanel(extension.id),
    };

    return (
      <div
        key={extension.id}
        data-dtb-part="item"
        data-dtb-ext-id={extension.id}
        data-dtb-align={extension.align ?? "start"}
        data-dtb-overflowed={isOverflowed ? "true" : undefined}
        data-dtb-panel-open={isPanelOpen ? "true" : undefined}
        className={cx(classNames?.item)}
      >
        <ExtensionBoundary
          extensionId={extension.id}
          label={extension.label}
          slot="compact"
          classNames={classNames}
        >
          {extension.compact ? (
            <Slot render={extension.compact} props={slotProps} />
          ) : hasPanel ? (
            <button
              type="button"
              data-dtb-part="trigger"
              aria-expanded={isPanelOpen}
              onClick={() => togglePanel(extension.id)}
            >
              {extension.label}
            </button>
          ) : (
            <span data-dtb-part="trigger">{extension.label}</span>
          )}
        </ExtensionBoundary>
      </div>
    );
  };

  return (
    <OverflowBar
      startItems={start}
      endItems={end}
      renderItem={renderItem}
      classNames={classNames}
    />
  );
}
