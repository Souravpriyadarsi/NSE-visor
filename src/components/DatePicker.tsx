import { useEffect, useMemo, useRef, useState } from 'react';
import { addMonths, calendarGrid, formatDate, formatMonth, startOfMonth } from '../lib/dates.ts';

type Props = {
  value: string;
  min?: string;
  max?: string;
  /** Shows the button as the active choice, e.g. when a custom date is in use rather than a preset. */
  active?: boolean;
  label: string;
  onChange: (date: string) => void;
};

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const arrow = (path: string) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <path d={path} />
  </svg>
);

/** A calendar in the app's own colours, instead of the browser's date picker. */
export function DatePicker({ value, min, max, active = false, label, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(value || max || ''));
  const boxRef = useRef<HTMLDivElement>(null);

  // Reopen on the chosen date's month.
  useEffect(() => setMonth(startOfMonth(value || max || '')), [value, max, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const days = useMemo(() => calendarGrid(month), [month]);
  const outOfRange = (date: string) => (min != null && date < min) || (max != null && date > max);

  const pick = (date: string) => {
    if (outOfRange(date)) return;
    onChange(date);
    setOpen(false);
  };

  const step = (months: number) => setMonth((current) => addMonths(current, months));

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm whitespace-nowrap text-ink-100 hover:border-ink-600 focus:border-accent-500 focus:outline-none ${
          active ? 'border-accent-500/60 bg-accent-500/10' : 'border-ink-700 bg-ink-900'
        }`}
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="h-4 w-4 text-ink-400">
          <rect x="3" y="4.5" width="14" height="13" rx="2" />
          <path d="M3 8.5h14M7 2.5v3M13 2.5v3" />
        </svg>
        {value ? formatDate(value) : 'Pick a date'}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="absolute left-0 z-30 mt-2 w-64 rounded-xl border border-ink-700 bg-ink-900 p-3 shadow-xl shadow-black/50"
        >
          <div className="flex items-center justify-between">
            <span className="flex gap-1">
              <button type="button" aria-label="Previous year" onClick={() => step(-12)} className="rounded-md p-1 text-ink-400 hover:bg-ink-800 hover:text-ink-100">
                {arrow('M12.5 4 7 10l5.5 6M16 4l-5.5 6 5.5 6')}
              </button>
              <button type="button" aria-label="Previous month" onClick={() => step(-1)} className="rounded-md p-1 text-ink-400 hover:bg-ink-800 hover:text-ink-100">
                {arrow('M12.5 4 7 10l5.5 6')}
              </button>
            </span>
            <span className="text-sm font-medium text-ink-100">{formatMonth(month)}</span>
            <span className="flex gap-1">
              <button type="button" aria-label="Next month" onClick={() => step(1)} className="rounded-md p-1 text-ink-400 hover:bg-ink-800 hover:text-ink-100">
                {arrow('M7.5 4 13 10l-5.5 6')}
              </button>
              <button type="button" aria-label="Next year" onClick={() => step(12)} className="rounded-md p-1 text-ink-400 hover:bg-ink-800 hover:text-ink-100">
                {arrow('M7.5 4 13 10l-5.5 6M4 4l5.5 6L4 16')}
              </button>
            </span>
          </div>

          <div className="mt-2 grid grid-cols-7 gap-0.5 text-center">
            {WEEKDAYS.map((day) => (
              <span key={day} className="py-1 text-[10px] font-medium tracking-wide text-ink-500 uppercase">
                {day}
              </span>
            ))}
            {days.map((date) => {
              const disabled = outOfRange(date);
              const selected = date === value;
              const thisMonth = date.slice(0, 7) === month.slice(0, 7);
              return (
                <button
                  key={date}
                  type="button"
                  disabled={disabled}
                  onClick={() => pick(date)}
                  aria-current={selected ? 'date' : undefined}
                  className={`h-7 rounded-md text-xs tabular-nums ${
                    selected
                      ? 'bg-accent-500 font-semibold text-ink-950'
                      : disabled
                        ? 'cursor-not-allowed text-ink-700'
                        : thisMonth
                          ? 'text-ink-100 hover:bg-ink-800'
                          : 'text-ink-600 hover:bg-ink-800'
                  }`}
                >
                  {Number(date.slice(8))}
                </button>
              );
            })}
          </div>

          {max && (
            <button
              type="button"
              onClick={() => pick(max)}
              className="mt-2 w-full rounded-md py-1 text-xs text-accent-400 hover:bg-ink-800"
            >
              Latest close ({formatDate(max)})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
