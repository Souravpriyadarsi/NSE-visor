import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { displaySymbol, resolveSymbol } from '../lib/data/symbols.ts';
import { searchStocks } from '../lib/search.ts';
import type { SymbolInfo } from '../types.ts';

export type PickerOption = SymbolInfo & { badge?: string };

type Props = {
  options: PickerOption[];
  onSelect: (symbol: string) => void;
  placeholder?: string;
  /** Accept tickers that aren't in the list. */
  allowCustom?: boolean;
};

const MAX_VISIBLE = 100;

/** Searchable stock dropdown styled like the rest of the app (instead of the browser's datalist). */
export function StockPicker({ options, onSelect, placeholder = 'Search stocks, e.g. TCS', allowCustom = true }: Props) {
  const id = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState('');

  const matches = useMemo(() => searchStocks(options, text, MAX_VISIBLE), [options, text]);

  const showList = open && matches.length > 0;

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function choose(symbol: string) {
    setText('');
    setOpen(false);
    setActive(0);
    setError('');
    // Leave the box after picking, so it isn't left highlighted and the next click opens the list again.
    inputRef.current?.blur();
    onSelect(symbol);
  }

  function submit() {
    const highlighted = showList ? matches[active] : undefined;
    if (highlighted) return choose(highlighted.symbol);
    const symbol = allowCustom ? resolveSymbol(text, options) : null;
    if (symbol) choose(symbol);
    else setError(allowCustom ? 'Enter an NSE symbol like RELIANCE or TCS.' : 'Pick a stock from the list.');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="w-full sm:w-80">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <svg
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-500"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="9" cy="9" r="6" />
            <path d="m14 14 4 4" strokeLinecap="round" />
          </svg>
          <input
            role="combobox"
            aria-expanded={showList}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={showList ? `${id}-${active}` : undefined}
            aria-label="Search stocks"
            value={text}
            placeholder={placeholder}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
              setActive(0);
              setError('');
            }}
            ref={inputRef}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            className="w-full rounded-lg border border-ink-700 bg-ink-900 py-2 pr-3 pl-9 text-sm placeholder:text-ink-500 focus:border-accent-500 focus:outline-none"
          />
          {showList && (
            <ul
              id={`${id}-list`}
              ref={listRef}
              role="listbox"
              className="absolute z-30 mt-1 max-h-80 w-full min-w-80 overflow-y-auto rounded-lg border border-ink-700 bg-ink-900 py-1 shadow-xl shadow-black/50"
            >
              {matches.map((option, i) => (
                <li
                  key={option.symbol}
                  id={`${id}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(option.symbol)}
                  className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm ${
                    i === active ? 'bg-accent-500/15 text-white' : 'text-ink-300'
                  }`}
                >
                  <span className="w-28 shrink-0 truncate font-medium" title={displaySymbol(option.symbol)}>
                    {displaySymbol(option.symbol)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-400">{option.name}</span>
                  {option.badge && (
                    <span className="shrink-0 rounded bg-ink-800 px-1.5 py-0.5 text-[10px] tracking-wide text-ink-400 uppercase">
                      {option.badge}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
    </div>
  );
}
