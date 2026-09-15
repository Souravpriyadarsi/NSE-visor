import { useState } from 'react';
import { Card } from './Card.tsx';
import { Toggle } from './Toggle.tsx';
import { roundTripCharges, type TradeKind } from '../lib/tests/costs.ts';

const SIZES = [10_000, 50_000, 1_00_000, 5_00_000, 10_00_000];
const TRADES_PER_DAY = [1, 5, 20, 100];
/** Price move per trade, in the trade's favour, before charges. */
const MOVES = [0.0002, 0.0005, 0.001, 0.0025, 0.005];
const TRADING_DAYS_PER_YEAR = 250;

const rupees = (value: number) => `${value < 0 ? '-' : ''}₹${Math.abs(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const signedRupees = (value: number) => (value > 0 ? `+${rupees(value)}` : rupees(value));
const sizeLabel = (value: number) => (value >= 1_00_000 ? `₹${value / 1_00_000}L` : `₹${value / 1000}k`);
/** "0.083%", "0.5%" */
const pct = (fraction: number) => `${Number((fraction * 100).toFixed(3))}%`;
const tone = (value: number) => (value > 0 ? 'text-emerald-400' : value < 0 ? 'text-rose-400' : '');

/** How far a price must move before a trade makes money, and what charges add up to for frequent trading. */
export function BreakEvenCalculator() {
  const [size, setSize] = useState(1_00_000);
  const [kind, setKind] = useState<TradeKind>('intraday');
  const [tradesPerDay, setTradesPerDay] = useState(20);
  const [move, setMove] = useState(0.0005);

  const charges = roundTripCharges(size, kind);
  const breakEven = charges / size;
  const net = size * move - charges;
  const tradesPerYear = tradesPerDay * TRADING_DAYS_PER_YEAR;
  const yearlyCharges = charges * tradesPerYear;

  const tiles = [
    { label: 'Charges per round trip', value: rupees(charges), sub: `${pct(breakEven)} of the trade` },
    { label: 'Break-even move', value: pct(breakEven), sub: 'the price must move this far your way just to cover charges' },
    { label: `Per trade, if it moves ${pct(move)} your way`, value: signedRupees(net), sub: `${rupees(size * move)} before charges`, className: tone(net) },
    {
      label: `A year at ${tradesPerDay} trade${tradesPerDay === 1 ? '' : 's'} a day`,
      value: signedRupees(net * tradesPerYear),
      sub: `${rupees(yearlyCharges)} of charges`,
      className: tone(net),
    },
  ];

  return (
    <Card
      title="Break-even calculator"
      subtitle="How far a price has to move in your favour before a trade makes any money, and what charges add up to when you trade often. Zerodha's rates; the bid-ask spread and slippage come on top."
    >
      <div className="flex flex-wrap items-center gap-3">
        <Toggle label="Trade size" value={size} choices={SIZES.map((value) => ({ value, label: sizeLabel(value) }))} onChange={setSize} />
        <Toggle
          label="Holding"
          value={kind}
          choices={[
            { value: 'intraday', label: 'Same day' },
            { value: 'delivery', label: 'Overnight' },
          ]}
          onChange={setKind}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Toggle
          label="Trades per day"
          value={tradesPerDay}
          choices={TRADES_PER_DAY.map((value) => ({ value, label: `${value}/day` }))}
          onChange={setTradesPerDay}
        />
        <Toggle label="Move per trade" value={move} choices={MOVES.map((value) => ({ value, label: `${pct(value)} move` }))} onChange={setMove} />
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg border border-ink-800 bg-ink-950/40 px-3 py-2">
            <dt className="text-[11px] text-ink-400">{tile.label}</dt>
            <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${tile.className ?? ''}`}>{tile.value}</dd>
            <dd className="text-[11px] text-ink-500">{tile.sub}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-sm text-ink-300">
        At {tradesPerDay} trade{tradesPerDay === 1 ? '' : 's'} a day, charges alone come to {rupees(yearlyCharges)} a year:{' '}
        <span className="font-medium text-ink-100">{(yearlyCharges / size).toFixed(1)}×</span> the money in each trade.
        {kind === 'intraday' && ' Same-day charges never fall much below 0.04% however large the trade, because STT and stamp duty grow with its value.'}
      </p>

      <div className="scroll-area mt-4">
        <table className="w-full min-w-[480px] text-sm">
          <thead>
            <tr className="text-xs text-ink-400">
              <th className="py-2 pr-3 text-left font-medium">Trade size</th>
              <th className="py-2 pr-3 text-right font-medium">Same day: charges</th>
              <th className="py-2 pr-3 text-right font-medium">Break-even</th>
              <th className="py-2 pr-3 text-right font-medium">Overnight: charges</th>
              <th className="py-2 pr-3 text-right font-medium">Break-even</th>
            </tr>
          </thead>
          <tbody>
            {SIZES.map((value) => {
              const intraday = roundTripCharges(value, 'intraday');
              const delivery = roundTripCharges(value, 'delivery');
              return (
                <tr key={value} className={`border-t border-ink-800 ${value === size ? 'bg-accent-500/10' : ''}`}>
                  <td className="py-2 pr-3">{rupees(value)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{rupees(intraday)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-ink-400">{pct(intraday / value)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{rupees(delivery)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-ink-400">{pct(delivery / value)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
