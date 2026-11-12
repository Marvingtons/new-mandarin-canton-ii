import { forwardRef } from "react";
import Icon, { type IconName } from "@/components/kitchen/Icon";
import ui from "@/components/kitchen/ui/ui.module.css";
import { buttonClass, type ButtonLook } from "@/components/kitchen/ui/buttonClass";

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
