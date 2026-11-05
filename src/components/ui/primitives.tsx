"use client";

import clsx from "clsx";
import { Check, X } from "@phosphor-icons/react";
import { Checkbox as RadixCheckbox, Dialog as RadixDialog, DropdownMenu as RadixMenu, Popover as RadixPopover, Tooltip as RadixTooltip } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { IconButton } from "./button";

// Radix primitives restyled hard: no default shadows, hairline borders, 6/10 px radii, 160 ms
// opacity + 4 px translate on open. Everything here is a client component by nature.

// ---------------------------------------------------------------------------------------- Dialog

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

/** Centred modal (phone: bottom sheet). `title` is required for screen readers. */
export function DialogContent({ title, description, children, className, wide }: { title: string; description?: string; children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink/30 dark:bg-black/50" />
      <RadixDialog.Content
        className={clsx(
          "card pop-content fixed z-50 flex max-h-[90dvh] flex-col overflow-hidden outline-none",
          "inset-x-0 bottom-0 rounded-b-none pb-safe sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-b-card",
          wide ? "sm:max-w-[720px]" : "sm:max-w-[480px]",
          className,
        )}
      >
        <header className="flex items-start gap-3 border-b border-hairline px-5 py-4">
          <div className="min-w-0 flex-1">
            <RadixDialog.Title className="text-[15px] font-semibold text-ink">{title}</RadixDialog.Title>
            {description ? <RadixDialog.Description className="mt-0.5 text-[13px] leading-[18px] text-ink-2">{description}</RadixDialog.Description> : <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>}
          </div>
          <RadixDialog.Close asChild>
            <IconButton label="Close" className="-mr-2 -mt-1">
              <X size={18} />
            </IconButton>
          </RadixDialog.Close>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

/** Right-side sheet (tablet and phone "Details"). */
export function SideSheetContent({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink/30 dark:bg-black/50" />
      <RadixDialog.Content className={clsx("sheet-right-in fixed inset-y-0 right-0 z-50 flex w-full max-w-[360px] flex-col bg-sheet shadow-card outline-none", className)}>
        <header className="flex items-center gap-3 border-b border-hairline px-5 py-3">
          <RadixDialog.Title className="flex-1 text-[15px] font-semibold text-ink">{title}</RadixDialog.Title>
          <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
          <RadixDialog.Close asChild>
            <IconButton label="Close" className="-mr-2">
              <X size={18} />
            </IconButton>
          </RadixDialog.Close>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 pb-safe">{children}</div>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

// --------------------------------------------------------------------------------------- Popover

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverClose = RadixPopover.Close;

export function PopoverContent({ children, className, align = "start", ...rest }: ComponentProps<typeof RadixPopover.Content>) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        align={align}
        sideOffset={6}
        collisionPadding={12}
        className={clsx("card pop-content z-50 w-[min(92vw,320px)] p-3 outline-none", className)}
        {...rest}
      >
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  );
}

// ---------------------------------------------------------------------------------- DropdownMenu

export const Menu = RadixMenu.Root;
export const MenuTrigger = RadixMenu.Trigger;

export function MenuContent({ children, className, ...rest }: ComponentProps<typeof RadixMenu.Content>) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content align="end" sideOffset={4} collisionPadding={12} className={clsx("card pop-content z-50 min-w-[200px] p-1 outline-none", className)} {...rest}>
        {children}
      </RadixMenu.Content>
    </RadixMenu.Portal>
  );
}

export function MenuItem({ className, danger, children, ...rest }: ComponentProps<typeof RadixMenu.Item> & { danger?: boolean }) {
  return (
    <RadixMenu.Item
      className={clsx(
        "flex h-10 cursor-default items-center gap-2.5 rounded-[6px] px-2.5 text-[14px] outline-none select-none data-[highlighted]:bg-raised data-[disabled]:text-ink-3 lg:h-9",
        danger ? "text-signal" : "text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </RadixMenu.Item>
  );
}

export const MenuSeparator = () => <RadixMenu.Separator className="my-1 h-px bg-hairline" />;

// --------------------------------------------------------------------------------------- Tooltip

export const TooltipProvider = ({ children }: { children: ReactNode }) => <RadixTooltip.Provider delayDuration={300}>{children}</RadixTooltip.Provider>;

export function Tooltip({ label, children, side = "right" }: { label: string; children: ReactNode; side?: "top" | "right" | "bottom" | "left" }) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content side={side} sideOffset={6} className="pop-content z-50 rounded-chip bg-ink px-2 py-1 text-[12px] font-medium text-sheet">
          {label}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

// -------------------------------------------------------------------------------------- Checkbox

/** 20 px box inside a 44 px target on phone. Checked fills bottle green with the check drawn. */
export function Checkbox({ checked, onCheckedChange, label, disabled, className }: { checked: boolean; onCheckedChange: (checked: boolean) => void; label: string; disabled?: boolean; className?: string }) {
  return (
    <RadixCheckbox.Root
      checked={checked}
      disabled={disabled}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      aria-label={label}
      className={clsx("group inline-flex size-11 shrink-0 items-center justify-center rounded-chip outline-none lg:size-8", className)}
    >
      <span
        className={clsx(
          "flex size-5 items-center justify-center rounded-[4px] border transition-colors duration-150",
          checked ? "border-bottle bg-bottle text-sheet" : "border-strong bg-sheet group-hover:border-ink-2",
          disabled && "opacity-50",
        )}
      >
        <RadixCheckbox.Indicator forceMount className={clsx("check-pop", !checked && "hidden")}>
          <Check size={14} weight="bold" />
        </RadixCheckbox.Indicator>
      </span>
    </RadixCheckbox.Root>
  );
}
