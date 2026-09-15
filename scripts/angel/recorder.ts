import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createGzip, type Gzip } from 'node:zlib';
import type { DepthTick } from '../../src/lib/angel/stream.ts';
import { fileId } from '../../src/lib/data/symbols.ts';
import { istDate, isMarketOpen } from '../../src/lib/intraday/bars.ts';
import type { AngelService } from './service.ts';

export type RecordedStock = { symbol: string; token: string };

const SNAPSHOT_MS = 1000;
const FLUSH_MS = 60_000;

/** One line per snapshot: time, last price, volume, whole-book buy/sell quantity, best 5 [price, quantity, orders] each side. */
const toLine = (tick: DepthTick) =>
  JSON.stringify({
    t: tick.time,
    p: tick.ltp,
    v: tick.volume,
    tb: tick.totalBuyQty,
    ts: tick.totalSellQty,
    b: tick.bids.map((l) => [l.price, l.quantity, l.orders]),
    a: tick.asks.map((l) => [l.price, l.quantity, l.orders]),
  });

/**
 * During market hours, saves the latest depth for each stock once a second (when it changed) to
 * data-local/depth/<date>/<SYMBOL>.jsonl.gz. Restarts append to the same file.
 */
export class DepthRecorder {
  private readonly pending = new Map<string, DepthTick>();
  private readonly files = new Map<string, { date: string; gzip: Gzip }>();
  private readonly service: AngelService;
  private readonly stocks: RecordedStock[];
  private readonly dir: URL;
  private unwatch: (() => void) | null = null;
  private snapshotTimer: ReturnType<typeof setInterval> | undefined;
  private flushTimer: ReturnType<typeof setInterval> | undefined;

  constructor(service: AngelService, stocks: RecordedStock[], dir: URL) {
    this.service = service;
    this.stocks = stocks;
    this.dir = dir;
  }

  start(): void {
    if (this.stocks.length === 0) return;
    this.unwatch = this.service.watch(
      this.stocks.map((s) => s.token),
      (tick) => this.pending.set(tick.token, tick),
    );
    this.snapshotTimer = setInterval(() => void this.snapshot(), SNAPSHOT_MS);
    this.flushTimer = setInterval(() => this.files.forEach((f) => f.gzip.flush()), FLUSH_MS);
  }

  stop(): void {
    this.unwatch?.();
    clearInterval(this.snapshotTimer);
    clearInterval(this.flushTimer);
    this.files.forEach((f) => f.gzip.end());
    this.files.clear();
  }

  private async snapshot(): Promise<void> {
    const now = new Date();
    if (!isMarketOpen(now)) return;
    const date = istDate(Math.floor(now.getTime() / 1000));
    for (const stock of this.stocks) {
      const tick = this.pending.get(stock.token);
      if (!tick) continue;
      this.pending.delete(stock.token);
      (await this.fileFor(stock.symbol, date)).write(`${toLine(tick)}\n`);
    }
  }

  private async fileFor(symbol: string, date: string): Promise<Gzip> {
    const open = this.files.get(symbol);
    if (open?.date === date) return open.gzip;
    open?.gzip.end();
    const dayDir = new URL(`${date}/`, this.dir);
    await mkdir(dayDir, { recursive: true });
    const gzip = createGzip();
    gzip.pipe(createWriteStream(new URL(`${fileId(symbol)}.jsonl.gz`, dayDir), { flags: 'a' }));
    this.files.set(symbol, { date, gzip });
    return gzip;
  }
}
