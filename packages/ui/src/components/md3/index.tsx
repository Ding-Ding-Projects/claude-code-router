import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/*
 * Thin Material Design 3 wrappers over the existing ui components. They do not
 * reimplement behavior — they restyle the wrapped components through the
 * --md-sys-* custom properties defined in styles/m3/tokens.css, with the
 * structural styles coming from styles/m3/primitives.css.
 *
 * New surfaces should prefer these over the raw components; existing surfaces
 * migrate to them lane by lane.
 */

export type MdButtonVariant = "filled" | "elevated" | "tonal" | "outlined" | "text" | "error";
export type MdButtonSize = "sm" | "default" | "lg" | "icon" | "iconSm";

export interface MdButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color"> {
  size?: MdButtonSize;
  variant?: MdButtonVariant;
}

const mdButtonVariantClass: Record<MdButtonVariant, string> = {
  filled: "md-btn--filled",
  elevated: "md-btn--elevated",
  tonal: "md-btn--tonal",
  outlined: "md-btn--outlined",
  text: "md-btn--text",
  error: "md-btn--error"
};

const mdButtonSizeClass: Record<MdButtonSize, string> = {
  sm: "md-btn--sm",
  default: "",
  lg: "md-btn--lg",
  icon: "md-btn--icon",
  iconSm: "md-btn--icon md-btn--icon-sm"
};

/**
 * M3-styled button. Renders the shared Button in unstyled mode so the M3
 * classes fully own the presentation instead of fighting its utility classes.
 */
const MdButton = React.forwardRef<HTMLButtonElement, MdButtonProps>(
  ({ className, size = "default", variant = "filled", type, ...props }, ref) => (
    <Button
      className={cn("md-btn", mdButtonVariantClass[variant], mdButtonSizeClass[size], className)}
      ref={ref}
      type={type ?? "button"}
      unstyled
      {...props}
    />
  )
);
MdButton.displayName = "MdButton";

export type MdCardVariant = "elevated" | "filled" | "outlined";

export interface MdCardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  variant?: MdCardVariant;
}

/**
 * M3-styled card. The base Card's inline box-shadow is overridden through the
 * style prop (inline wins), colors and radius come from the .md-card rules.
 */
const MdCard = React.forwardRef<HTMLDivElement, MdCardProps>(
  ({ className, interactive = false, style, variant = "filled", ...props }, ref) => (
    <Card
      className={cn(
        "md-card",
        variant === "outlined" && "md-card--outlined",
        interactive && "md-card--interactive",
        className
      )}
      ref={ref}
      style={{
        // The base Card always sets a legacy inline shadow; override it so
        // filled/outlined variants are flat as M3 specifies.
        boxShadow: variant === "elevated" ? "var(--md-elevation-level1)" : "none",
        ...style
      }}
      tabIndex={interactive ? 0 : undefined}
      {...props}
    />
  )
);
MdCard.displayName = "MdCard";

export type MdSwitchProps = React.ComponentProps<typeof Switch>;

/**
 * M3-styled switch. The .md-switch hook recolors track and thumb from the
 * tokens via aria-checked, keeping the wrapped Switch's geometry and a11y.
 */
const MdSwitch = React.forwardRef<HTMLInputElement, MdSwitchProps>(({ className, ...props }, ref) => (
  <Switch className={cn("md-switch", className)} ref={ref} {...props} />
));
MdSwitch.displayName = "MdSwitch";

export { MdButton, MdCard, MdSwitch };
