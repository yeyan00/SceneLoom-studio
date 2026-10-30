import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export function RibbonButton({
  icon: Icon,
  large = false,
  className = "",
  children,
  ...props
}) {
  return (
    <button
      className={`${large ? "ribbon-large" : ""} ${className}`}
      {...props}
    >
      {Icon && <Icon size={large ? 23 : 16} />}
      <span>{children}</span>
    </button>
  );
}

// Portal placement keeps menus outside the ribbon's horizontal scrolling area.
// Plugins can reuse the same large buttons and split-button interaction.
export function RibbonSplitButton({
  label,
  icon,
  menuLabel,
  options,
  value,
  onSelect,
  disabled,
  selected,
}) {
  const id = useId(),
    anchor = useRef(),
    trigger = useRef(),
    menu = useRef();
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState({ top: 0, left: 0 });
  useLayoutEffect(() => {
    if (!open) return;
    const bounds = anchor.current.getBoundingClientRect();
    const width = menu.current.getBoundingClientRect().width;
    setPosition({
      top: bounds.bottom + 4,
      left: Math.max(4, Math.min(bounds.left, innerWidth - width - 4)),
    });
    (menu.current.querySelector('[aria-checked="true"]:not(:disabled)') ||
      menu.current.querySelector('[role="menuitemradio"]:not(:disabled)'))?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e) => {
      if (
        !anchor.current?.contains(e.target) &&
        !menu.current?.contains(e.target)
      )
        setOpen(false);
    };
    const close = (event) => {
      if (!menu.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const choose = (option) => {
    setOpen(false);
    trigger.current?.focus();
    onSelect(option.value);
  };
  return (
    <div ref={anchor} className={`ribbon-split ${selected ? "selected" : ""}`}>
      <RibbonButton
        large
        icon={icon}
        disabled={disabled}
        onClick={() => onSelect(value)}
      >
        {label}
      </RibbonButton>
      <button
        ref={trigger}
        className="ribbon-menu-trigger"
        aria-label={menuLabel}
        aria-haspopup="menu"
        aria-controls={open ? id : undefined}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <ChevronDown size={12} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="menu"
            aria-label={menuLabel}
            className="ribbon-menu"
            style={position}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
                trigger.current?.focus();
              }
              if (e.key === "Tab") setOpen(false);
              const items = [
                  ...menu.current.querySelectorAll(
                    '[role="menuitemradio"]:not(:disabled)',
                  ),
                ],
                current = items.indexOf(document.activeElement);
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                items[
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? items.length - 1
                      : (current +
                          (e.key === "ArrowDown" ? 1 : -1) +
                          items.length) %
                        items.length
                ]?.focus();
              }
            }}
          >
            {options.map(({ icon: Icon, ...option }) => (
              <button
                key={option.value}
                role="menuitemradio"
                aria-checked={value === option.value}
                disabled={option.disabled}
                onClick={() => choose(option)}
              >
                {Icon && <Icon size={16} />}
                <span>{option.label}</span>
                {value === option.value && <Check size={14} />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
