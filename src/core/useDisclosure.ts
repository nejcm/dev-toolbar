import { useEffect, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])';
const OPEN_EVENT = "dtb:disclosure-open";
const GROUP_SELECTOR = '[data-dtb-part="bar"]';

interface Disclosure {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
}

export function useDisclosure(
  triggerRef: RefObject<HTMLButtonElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
): Disclosure {
  const [open, setOpen] = useState(false);

  /* oxlint-disable react-hooks/exhaustive-deps -- caller-owned refs are stable. */
  useEffect(() => {
    if (!open) return;
    const content = contentRef.current;
    if (!content) return;
    (content.querySelector<HTMLElement>(FOCUSABLE) ?? content).focus();
  }, [open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;

    const trigger = triggerRef.current;
    if (trigger) {
      document.dispatchEvent(new CustomEvent<HTMLElement>(OPEN_EVENT, { detail: trigger }));
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (contentRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("mousedown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [open]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const onOpen = (event: Event) => {
      const openedTrigger = (event as CustomEvent<HTMLElement>).detail;
      const ownTrigger = triggerRef.current;
      if (!ownTrigger || openedTrigger === ownTrigger) return;
      const group = ownTrigger.closest(GROUP_SELECTOR);
      if (!group || openedTrigger.closest(GROUP_SELECTOR) !== group) return;
      setOpen(false);
    };

    document.addEventListener(OPEN_EVENT, onOpen);
    return () => document.removeEventListener(OPEN_EVENT, onOpen);
  }, []);
  /* oxlint-enable react-hooks/exhaustive-deps */

  return { open, setOpen };
}
