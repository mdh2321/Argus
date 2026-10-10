"use client";

import { forwardRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The one place button styling lives. Every CTA in the app should route
 * through here so variant, size, focus ring, and disabled behaviour stay
 * consistent. Keyboard focus is handled globally by the `:focus-visible`
 * rule in globals.css — don't re-add `focus:outline-none` here.
 */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const base =
  "inline-flex min-h-11 items-center justify-center gap-2 font-medium " +
  "rounded-xl transition-all duration-150 " +
  "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none";

const sizes: Record<Size, string> = {
  sm: "px-3 text-[14px]",
  md: "px-4 text-[14px]",
};

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-white hover:bg-accent-2 hover:shadow-[var(--shadow-m)]",
  secondary:
    "border border-border text-fg-2 hover:bg-hover hover:text-fg hover:border-border-hover",
  ghost: "text-fg-3 hover:text-fg-2 hover:bg-hover",
  danger:
    "border border-red/30 text-red-text hover:bg-red-bg hover:border-red/50",
};

interface ButtonOwnProps {
  variant?: Variant;
  size?: Size;
}

type ButtonProps = ButtonOwnProps &
  React.ButtonHTMLAttributes<HTMLButtonElement>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(base, sizes[size], variants[variant], className)}
      {...props}
    />
  )
);
Button.displayName = "Button";

/** Same visual language, rendered as a Next.js link. */
type ButtonLinkProps = ButtonOwnProps &
  React.ComponentProps<typeof Link>;

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      className={cn(base, sizes[size], variants[variant], className)}
      {...props}
    />
  );
}

/**
 * Square icon-only button. Always pass an `aria-label` — an icon alone is
 * not an accessible name.
 */
interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2 text-fg-3",
        "transition-all duration-150 hover:bg-hover hover:text-fg-2",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className
      )}
      {...props}
    />
  )
);
IconButton.displayName = "IconButton";
