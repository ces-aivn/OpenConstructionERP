// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { useLayoutEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNumberLocale } from '@/stores/usePreferencesStore';
import { caretAfterRegroup, displayAmount, readTypedAmount } from '../amountInput';

interface AmountInputProps {
  id?: string;
  /** Plain decimal string ("9174287000000.5"), "" when empty. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxFractionDigits?: number;
  className?: string;
  'aria-label'?: string;
}

/**
 * Text box for a money amount that groups thousands while the user types.
 *
 * The form keeps a plain decimal string; the box shows it grouped in the
 * reader's number format and puts the caret back after the digit it followed,
 * so typing in the middle of "9.174.287" does not throw the caret to the end.
 */
export function AmountInput({
  id,
  value,
  onChange,
  placeholder,
  maxFractionDigits = 2,
  className,
  'aria-label': ariaLabel,
}: AmountInputProps) {
  const locale = useNumberLocale();
  const ref = useRef<HTMLInputElement>(null);
  // The display can carry a trailing decimal mark the value does not, so it is
  // held separately and resynchronised only when the value moves from outside.
  const [display, setDisplay] = useState(() => displayAmount(value, locale));
  const lastValue = useRef(value);
  const pendingCaret = useRef<number | null>(null);

  const lastLocale = useRef(locale);
  if (locale !== lastLocale.current) {
    lastLocale.current = locale;
    lastValue.current = value;
    setDisplay(displayAmount(value, locale));
  } else if (value !== lastValue.current) {
    lastValue.current = value;
    const fresh = displayAmount(value, locale);
    if (readTypedAmount(display, locale, maxFractionDigits).value !== value) setDisplay(fresh);
  }

  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (caret == null || !ref.current || document.activeElement !== ref.current) return;
    pendingCaret.current = null;
    ref.current.setSelectionRange(caret, caret);
  });

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const caret = e.target.selectionStart ?? raw.length;
    const next = readTypedAmount(raw, locale, maxFractionDigits);
    pendingCaret.current = caretAfterRegroup(raw, caret, next.display, locale);
    setDisplay(next.display);
    lastValue.current = next.value;
    onChange(next.value);
  };

  return (
    <input
      ref={ref}
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={display}
      onChange={handleChange}
      placeholder={placeholder}
      aria-label={ariaLabel}
      maxLength={40}
      className={
        className ??
        'h-10 w-full rounded-lg border border-border bg-surface-primary px-3 text-sm text-content-primary tabular-nums placeholder:text-content-tertiary focus:outline-none focus:ring-2 focus:ring-oe-blue focus:border-transparent'
      }
    />
  );
}
