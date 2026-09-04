import { forwardRef, useCallback, useState } from "react";
import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { writeClipboardText } from "../runtime";

type DataAttributes = { [name: `data-${string}`]: string | undefined };

export type CopyStatus = "idle" | "ok" | "failed";

/** Text shown in the live region for each clipboard outcome. */
export interface CopyButtonStatusText {
  idle: string;
  ok: string;
  failed: string;
}

/** Clipboard status and an event-safe copy action for one or more buttons. */
export interface UseCopyStatusResult {
  status: CopyStatus;
  copy(text: string | null): void;
}

/** Own clipboard outcome state without owning any DOM. */
export function useCopyStatus(): UseCopyStatusResult {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const copy = useCallback((text: string | null) => {
    if (text === null) {
      setStatus("failed");
      return;
    }
    void writeClipboardText(text).then((ok) => setStatus(ok ? "ok" : "failed"));
  }, []);
  return { status, copy };
}

/** Props for a button that writes text and reports the outcome. */
export interface CopyButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The text to copy, resolved on activation when supplied as a function. */
  text: string | (() => string);
  statusText: CopyButtonStatusText;
  statusProps?: HTMLAttributes<HTMLSpanElement> & DataAttributes;
}

/** A copy action with an honest, polite status region. */
export const CopyButton = forwardRef<HTMLButtonElement, CopyButtonProps>(function CopyButton(
  { children, onClick, statusProps, statusText, text, type = "button", ...rest },
  ref,
) {
  const { status, copy } = useCopyStatus();
  const { role = "status", ...statusRest } = statusProps ?? {};

  return (
    <>
      <button
        {...rest}
        ref={ref}
        type={type}
        data-dtb-kind="action"
        onClick={(event) => {
          onClick?.(event);
          copy(typeof text === "function" ? text() : text);
        }}
      >
        {children}
      </button>
      <span {...statusRest} data-dtb-kind="note" role={role}>
        {statusText[status]}
      </span>
    </>
  );
});
