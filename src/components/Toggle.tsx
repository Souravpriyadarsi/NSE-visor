/** A row of buttons where one choice is active (value null means none is). */
export function Toggle<T extends string | number>(props: {
  label: string;
  value: T | null;
  choices: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex max-w-full flex-wrap rounded-lg border border-ink-700 p-0.5" role="group" aria-label={props.label}>
      {props.choices.map((choice) => (
        <button
          key={String(choice.value)}
          type="button"
          aria-pressed={choice.value === props.value}
          onClick={() => props.onChange(choice.value)}
          className={`rounded-md px-3 py-1 text-xs whitespace-nowrap ${
            choice.value === props.value ? 'bg-ink-700 text-white' : 'text-ink-400 hover:text-ink-200'
          }`}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}
