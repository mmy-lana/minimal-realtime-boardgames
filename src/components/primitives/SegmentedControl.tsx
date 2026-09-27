"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SegmentedControlOption<TValue extends string> {
  value: TValue;
  /** Visible label. */
  label: string;
  /**
   * Longer explanation surfaced under the control as help text when this
   * option is selected.
   */
  description?: string;
  /** Explains, to assistive tech, why the option cannot be chosen. */
  disabledReason?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<TValue extends string> {
  /**
   * Stable `name` for the underlying radio group. Two controls with the same
   * name would share state, so every instance must pass a distinct value.
   */
  name: string;
  /** Visible group label. */
  label: string;
  /** Associates the group with a visible or visually hidden element. */
  labelHidden?: boolean;
  value: TValue;
  onChange: (value: TValue) => void;
  options: readonly SegmentedControlOption<TValue>[];
  /** Static help text rendered under the control. */
  hint?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  /** Test-friendly id for the container. */
  id?: string;
}

const TRACK_CLASSES = "inline-flex w-full border border-board-border bg-board-light p-0.5";
const ITEM_BASE_CLASSES =
  "relative flex-1 select-none text-center font-medium uppercase tracking-wide transition-colors duration-100";

const SIZE_CLASSES = {
  sm: { track: "h-8 text-[11px]", item: "px-2" },
  md: { track: "h-10 text-xs", item: "px-3" },
} as const;

/**
 * Radio-group styled as the monochrome segmented control described in
 * Section 2.3. Used for the Local / Realtime mode switch and the join-code
 * room picker.
 *
 * Built on real `<input type="radio">` elements rather than `div`s with
 * `role="radio"`, so arrow-key navigation, form association and screen-reader
 * semantics come from the platform and cannot drift.
 */
export function SegmentedControl<TValue extends string>({
  name,
  label,
  labelHidden = false,
  value,
  onChange,
  options,
  hint,
  size = "md",
  disabled = false,
  className,
  id,
}: SegmentedControlProps<TValue>) {
  const reactId = React.useId();
  const baseId = id ?? `segmented-${reactId}`;
  const hintId = `${baseId}-hint`;
  const selectedOption = options.find((option) => option.value === value);
  const resolvedHint = selectedOption?.description ?? hint;
  const isEmpty = options.length === 0;

  return (
    <div className={cn("w-full", className)}>
      <label
        id={`${baseId}-label`}
        htmlFor={`${baseId}-input-${value}`}
        className={cn(
          "mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-board-muted",
          labelHidden && "sr-only",
        )}
      >
        {label}
      </label>

      {isEmpty ? (
        <div
          role="status"
          className={cn(TRACK_CLASSES, "items-center justify-center text-xs text-board-muted")}
        >
          No options available
        </div>
      ) : (
        <div
          role="radiogroup"
          aria-labelledby={`${baseId}-label`}
          aria-describedby={resolvedHint ? hintId : undefined}
          aria-disabled={disabled || undefined}
          className={cn(TRACK_CLASSES, SIZE_CLASSES[size].track)}
        >
          {options.map((option) => {
            const inputId = `${baseId}-input-${option.value}`;
            const isSelected = option.value === value;
            const isDisabled = disabled || option.disabled === true;

            return (
              <label
                key={option.value}
                htmlFor={inputId}
                title={isDisabled ? option.disabledReason : undefined}
                className={cn(
                  ITEM_BASE_CLASSES,
                  SIZE_CLASSES[size].item,
                  "flex items-center justify-center",
                  isSelected ? "bg-board-dark text-white" : "text-board-muted",
                  !isDisabled && !isSelected && "hover:bg-board-subtle hover:text-board-dark",
                  isDisabled && "cursor-not-allowed opacity-40",
                  // A radio input is the accessible control; the label is the
                  // painted surface.
                  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-board-dark",
                )}
              >
                <input
                  id={inputId}
                  type="radio"
                  name={name}
                  value={option.value}
                  checked={isSelected}
                  disabled={isDisabled}
                  aria-describedby={
                    isDisabled && option.disabledReason ? `${baseId}-${option.value}-reason` : undefined
                  }
                  onChange={() => {
                    if (!isDisabled && option.value !== value) onChange(option.value);
                  }}
                  className="sr-only"
                />
                {option.label}
                {isDisabled && option.disabledReason ? (
                  <span id={`${baseId}-${option.value}-reason`} className="sr-only">
                    {option.disabledReason}
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
      )}

      {resolvedHint ? (
        <p id={hintId} className="mt-1.5 text-xs leading-relaxed text-board-muted">
          {resolvedHint}
        </p>
      ) : null}
    </div>
  );
}

export default SegmentedControl;
