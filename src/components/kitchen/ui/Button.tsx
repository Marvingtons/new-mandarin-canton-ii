import { forwardRef } from "react";
import Icon, { type IconName } from "@/components/kitchen/Icon";
import ui from "@/components/kitchen/ui/ui.module.css";

/**
 * The staff app's one button. Board, POS, history and every dialog use it, so
 * a primary action looks and behaves the same wherever it appears.
 *
 *   primary      the one main action in a place (accept, send, reprint)
 *   secondary    everything else that does something
 *   quiet        toolbar and inline actions
 *   danger       destructive, before the confirm step (outlined)
 *   dangerSolid  destructive, AT the confirm step (the only filled red)
 */
export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "dangerSolid";

export interface ButtonLook {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  /** Square, for an icon alone. Needs an aria-label. */
  iconOnly?: boolean;
  block?: boolean;
}

/** The class string, for a Link or a native element that must look like a button. */
export function buttonClass({ variant = "secondary", size = "md", iconOnly, block }: ButtonLook = {}, extra = ""): string {
  return [
    ui.btn,
    ui[variant],
    size === "sm" ? ui.sm : "",
    iconOnly ? ui.icon : "",
    block ? ui.block : "",
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}

type ButtonProps = ButtonLook &
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: IconName;
    /** The keyboard shortcut, shown as a small hint on laptops only. */
    shortcut?: string;
    busy?: boolean;
  };

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, iconOnly, block, icon, shortcut, busy, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-busy={busy || undefined}
      className={buttonClass({ variant, size, iconOnly, block }, className)}
      {...rest}
    >
      {icon && <Icon name={icon} size={20} />}
      {children}
      {shortcut && (
        <kbd aria-hidden="true" className={ui.kbd}>
          {shortcut}
        </kbd>
      )}
    </button>
  );
});

export default Button;
