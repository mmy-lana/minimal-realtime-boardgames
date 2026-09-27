"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface ModalProps {
  /** Controls visibility. `false` unmounts the dialog and releases the trap. */
  open: boolean;
  /**
   * Short headline. Rendered as the dialog's accessible name
   * (`aria-labelledby`) and visually, unless `hideTitle` is set.
   */
  title: string;
  /** Optional supporting copy, wired to `aria-describedby`. */
  description?: string;
  /** Dismiss callback. Required whenever the dialog is dismissible. */
  onClose?: () => void;
  /**
   * When `false`, the dialog cannot be closed by Escape, by clicking the
   * backdrop, or by the close button. Use for outcomes a player must
   * acknowledge (an invalid-state conflict, for example).
   */
  dismissible?: boolean;
  /** Visually hide the title while keeping it as the accessible name. */
  hideTitle?: boolean;
  /** Hide the built-in close button even when the dialog is dismissible. */
  hideCloseButton?: boolean;
  /** Tailwind classes for the panel; used to cap width per call site. */
  panelClassName?: string;
  children?: React.ReactNode;
  /** Rendered in a sticky footer strip below `children`. */
  footer?: React.ReactNode;
  /** `data-modal-panel` hook for the test suite. */
  id?: string;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Inline 10px "×". Drawn here so the UI needs no icon-library dependency. */
function CloseGlyph() {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true" className="size-2.5" focusable="false">
      <path
        d="M0.5 0.5 L9.5 9.5 M9.5 0.5 L0.5 9.5"
        stroke="currentColor"
        strokeWidth="1.25"
        fill="none"
      />
    </svg>
  );
}

/**
 * Accessible dialog wrapper (Section 2.5).
 *
 * Provides the full contract a modal owes its user, none of which is left to
 * individual call sites:
 * - `role="dialog"` + `aria-modal="true"` + an accessible name and description.
 * - Focus moves into the panel on open and returns to the invoking element on
 *   close.
 * - Tab and Shift+Tab cycle within the panel; focus cannot escape to the page
 *   behind it.
 * - Escape and backdrop click dismiss, unless `dismissible` is `false`.
 * - Background scroll is locked while open and restored exactly once.
 * - The close control is an inline SVG, so no icon library is required.
 */
export function Modal({
  open,
  title,
  description,
  onClose,
  dismissible = true,
  hideTitle = false,
  hideCloseButton = false,
  panelClassName,
  children,
  footer,
  id,
}: ModalProps) {
  const reactId = React.useId();
  const baseId = id ?? `modal-${reactId}`;
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const [portalReady, setPortalReady] = React.useState(false);

  // Portals need a DOM; the first client render decides.
  React.useEffect(() => {
    setPortalReady(true);
  }, []);

  const canDismiss = dismissible && typeof onClose === "function";

  // Remember the invoker so focus can be handed back when the dialog closes.
  React.useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [open]);

  // Move focus into the panel once it exists, preferring a real control.
  React.useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const firstFocusable = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstFocusable ?? panel).focus();
  }, [open, portalReady]);

  // Lock background scroll without letting the compensating scrollbar cause a
  // layout shift, and restore the previous inline style exactly once.
  React.useEffect(() => {
    if (!open) return;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
    };
  }, [open]);

  // Escape to dismiss + Tab focus trap.
  React.useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && canDismiss) {
        event.preventDefault();
        event.stopPropagation();
        onClose?.();
        return;
      }

      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => element.offsetParent !== null || element === document.activeElement);

      if (focusables.length === 0) {
        // Nothing to cycle through: keep focus pinned to the panel itself.
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [open, canDismiss, onClose]);

  if (!open || !portalReady || typeof document === "undefined") return null;

  return createPortal(
    <div
      data-modal-backdrop=""
      className="fixed inset-0 z-50 flex items-end justify-center bg-board-dark/40 p-4 sm:items-center animate-fade-in"
      onMouseDown={(event) => {
        // Only a press that both starts and ends on the backdrop dismisses, so
        // a drag-select that ends outside the panel is not treated as a click.
        if (canDismiss && event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        id={baseId}
        data-modal-panel=""
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "w-full max-w-md border border-board-border bg-board-light shadow-xl outline-none animate-slide-up",
          "max-h-[90dvh] overflow-y-auto",
          panelClassName,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-board-border px-5 py-4">
          <h2
            id={titleId}
            className={cn(
              "text-sm font-medium uppercase tracking-wide",
              hideTitle && "sr-only",
            )}
          >
            {title}
          </h2>
          {canDismiss && !hideCloseButton ? (
            <button
              type="button"
              onClick={() => onClose?.()}
              aria-label={`Close ${title}`}
              className="-mr-1 -mt-1 inline-flex size-8 shrink-0 items-center justify-center text-board-muted transition-colors hover:bg-board-subtle hover:text-board-dark"
            >
              <CloseGlyph />
            </button>
          ) : null}
        </div>

        <div className="px-5 py-4">
          {description ? (
            <p id={descriptionId} className="mb-4 text-sm leading-relaxed text-board-muted">
              {description}
            </p>
          ) : null}
          {children}
        </div>

        {footer ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-board-border px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export default Modal;
