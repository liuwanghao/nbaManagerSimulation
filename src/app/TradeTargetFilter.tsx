import { useEffect, useId, useRef, useState } from "react";

interface TradeTargetFilterProps<T extends string> {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}

export function TradeTargetFilter<T extends string>({ label, value, options, onChange }: TradeTargetFilterProps<T>) {
  const [open, setOpen] = useState(false);
  const [opensUpward, setOpensUpward] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusOnOpenRef = useRef(false);
  const menuId = useId();
  const selectedLabel = options.find((option) => option.value === value)?.label ?? options[0]?.label;

  useEffect(() => {
    if (!open) return;
    if (focusOnOpenRef.current) {
      const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
      rootRef.current?.querySelectorAll<HTMLButtonElement>(".trade-target-filter-option")[selectedIndex]?.focus();
      focusOnOpenRef.current = false;
    }
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open, options, value]);

  const openMenu = (focusSelected = false) => {
    const bounds = rootRef.current?.getBoundingClientRect();
    const menuHeight = Math.min(options.length * 39 + 8, 268);
    setOpensUpward(Boolean(bounds && window.innerHeight - bounds.bottom < menuHeight && bounds.top > window.innerHeight - bounds.bottom));
    focusOnOpenRef.current = focusSelected;
    setOpen(true);
  };
  const focusOption = (index: number) => {
    const buttons = rootRef.current?.querySelectorAll<HTMLButtonElement>(".trade-target-filter-option");
    buttons?.[Math.max(0, Math.min(index, buttons.length - 1))]?.focus();
  };

  return <div ref={rootRef} className="trade-target-filter" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={(event) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openMenu(true);
      else {
        const buttons = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>(".trade-target-filter-option") ?? []);
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        focusOption(current < 0 ? (event.key === "ArrowDown" ? 0 : buttons.length - 1) : current + (event.key === "ArrowDown" ? 1 : -1));
      }
    }
  }}>
    <span className="trade-target-filter-label">{label}</span>
    <button ref={triggerRef} type="button" className="trade-target-filter-trigger" aria-label={`按${label}筛选目标球员：${selectedLabel}`} aria-expanded={open} aria-controls={menuId} onClick={() => open ? setOpen(false) : openMenu()}>
      <span>{selectedLabel}</span><i aria-hidden="true" />
    </button>
    {open && <div id={menuId} className={`trade-target-filter-menu${opensUpward ? " open-up" : ""}`} role="group" aria-label={`选择${label}`}>
      {options.map((option) => <button type="button" key={option.value} className="trade-target-filter-option" aria-pressed={option.value === value} onClick={() => {
        onChange(option.value);
        setOpen(false);
        triggerRef.current?.focus();
      }}><span>{option.label}</span>{option.value === value && <b aria-hidden="true">✓</b>}</button>)}
    </div>}
  </div>;
}
