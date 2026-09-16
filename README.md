# NSE Visor

A lightweight web app for NSE (India) stocks, with these pages in the sidebar:

- **Dashboard**: today's sheet for every NIFTY 200 stock (latest close, predicted price in 1 month, expected change, chance of ending higher), plus each stock's research **Rank** and forecast **Trust** grade and the current market condition. Sortable and filterable.
- **Prices**: a plain price chart for any stock over 1D, 1W, 1M, 3M, 6M, 1Y, 5Y or All (back to the first price on record, using monthly prices before the last 10 years), with the latest day's open, high, low, volume and 52-week range. Below it, every stock's price at the start of the time frame, its current price, and how much it has risen or fallen.
- **Analyze**: one stock's ~10-year price chart with a **1-month forecast** (22 trading days) and 80% likely range, a **backtest** over the last 6 months, and **technical indicators** (50/200-day averages, RSI, MACD) with plain-English signals.
- **Watchlist**: your starred stocks at a glance. Click one to open it in Analyze.
- **Tracker**: every weekday evening the day's forecasts are saved. The Tracker shows each saved prediction next to the actual price once its month has passed, as a chart and as tables by stock or by day. Predictions still inside their month show as pending.
- **Model report**: an honest, month-by-month backtest over the NIFTY 200 with the last 2 years sealed as a final test: how accurate the forecasts and ranges have been against simple baselines, and which stock-ranking signals (momentum, low volatility and others) have beaten the average stock after trading costs.
- **Tests**: trading-rule experiments on real prices with typical Indian brokerage charges, for any stock and any start date, with an all-stocks table for each. The **same-day trading test** trades 50, 100 or 200 shares every day, either overnight (buy at the close, sell at the next open) or intraday (buy at the open, sell at the close), charted against simply holding the stock. **Minimal Margin Maximus** buys that many shares at every close and sells on a trailing stop (₹2 up, ₹1 back by default) — first for the whole holding once it is above its average buy price, otherwise lot by lot — with no stop-loss, so lots pile up in a fall. Daily prices don't say whether the high came before the low, so every result is a range from a worst case to a best case, with a 5-minute check over the last ~60 days to narrow it.
- **Day trading**: intraday strategies (opening-range breakout, VWAP pullback, moving-average crossover) backtested on ~60 days of 5-minute prices after Zerodha intraday charges and slippage, with settings chosen on the first two-thirds of the days and judged on the rest. A **paper trader** then runs a strategy on live 5-minute prices with hard risk limits (risk per trade, daily loss limit, 15:15 square-off) and a kill switch, and keeps a track record. Live orders through Zerodha Kite Connect are a later step. With a free Angel One account, the local app also shows live **market depth** and uses Angel One's official prices (see below).
- **Fetch any stock**: search all ~2,500 NSE stocks by company name or ticker, add them to your Dashboard, and choose which ones to **track daily**. The Analyze search covers every NSE stock too.

Built with TypeScript, React, Tailwind CSS v4, Vite and [lightweight-charts](https://github.com/tradingview/lightweight-charts). All the maths is plain TypeScript with no ML libraries.

## Run it locally

```bash
npm install
npm run fetch-data
npm run dev
```

Open the URL Vite prints. `fetch-data` builds the Dashboard's data; Analyze and Fetch get prices live from Yahoo Finance through the Vite dev server, because browsers can't call Yahoo directly (CORS).

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app |
| `npm test` | Run the unit tests (Vitest) |
| `npm run typecheck` | Type-check everything |
| `npm run fetch-data` | Download NSE's full stock list, plus every built-in and tracked stock with forecasts, to `public/data/`. Also keeps monthly prices from before the last 10 years in `public/data/long/` (re-downloaded monthly, or after a split) and writes the Prices page table, `prices.json` |
| `npm run fetch-data -- TCS INFY` | Download only some stocks |
| `npm run research` | Replay ~8 years of monthly forecasts and rankings into `public/research/` (after `fetch-data`, takes a few minutes) |
| `npm run same-day-test` | Build the Tests page's all-stocks table into `public/research/same-day.json` (after `fetch-data`) |
| `npm run margin-maximus-test` | Build the Minimal Margin Maximus all-stocks table into `public/research/margin-maximus.json` (after `fetch-data`) |
| `npm run intraday-research` | Backtest the Day trading strategies for the NIFTY 50 on 5-minute prices into `public/research/intraday.json`, and keep finished days' bars in `snapshots/intraday/` |
| `npm run intraday-research -- --source angel` | The same backtest on Angel One's ~100 days of 5-minute prices (needs `.env.local`) |
| `npm run angel-tokens` | Save Angel One's NSE instrument tokens (public, no login) to `public/data/angel-tokens.json` |
| `npm run angel-history -- RELIANCE --days 365` | Save Angel One 1-minute candles to `data-local/candles/` (needs `.env.local`; add `--interval 5m` for 5-minute) |
| `npm run save-snapshot` | Save today's forecasts to `snapshots/<date>.json` |
| `npm run build-tracker` | Compare saved snapshots with actual prices into `public/tracker/` |
| `npm run build` | Build the static site into `dist/` |

## How the forecast works

The code is in `src/lib/models/`. Every model gets the last few years of dividend-adjusted closing prices.

1. **Trend line** (`linearTrend.ts`): fits a straight line to log prices over the last year and continues its slope.
2. **Holt smoothing** (`holt.ts`): tracks a level and a trend that adapt over time, with the trend fading out so it doesn't over-extrapolate.
3. **Random-walk simulation** (`gbm.ts`): simulates 2,000 possible price paths using the stock's historical drift and volatility. This gives the likely range and the "chance of ending higher".

The **blend** (`ensemble.ts`) averages the three. Models that did better in the backtest get more weight, but each keeps at least 15%.

The **backtest** (`backtest.ts`) hides each of the last 6 months in turn, forecasts it from earlier data only, and compares the result with what happened. It also scores a "no change" baseline. If the blend can't beat assuming the price stays flat, the app says so.

## How prediction tracking works

1. After fetching prices, the daily GitHub Action runs `save-snapshot`, which saves every stock's 22-day forecast as `<market date>.json` on a separate **`predictions`** branch. A sheet is never overwritten, so saved predictions can't change later.
2. `build-tracker` lines each saved prediction up with the closing price 22 trading days later (`src/lib/tracker.ts`) and writes the Tracker's files into the site.
3. The Tracker scores predictions that have reached their date: average error, how often the up/down direction was right, and how often the actual price landed inside the 80% range.

Tracked stocks are the built-in ones plus any you click **Track daily** on in the Fetch page (stored by the Cloudflare Worker). Stocks that are only fetched in your browser appear on the Dashboard but aren't tracked.

## How the research backtest works

`scripts/research.ts` runs in the daily Action after prices are downloaded (code in `src/lib/research/`).

1. **Forecasts** (`forecastStudy.ts`): at every month-end for ~8 years, each NIFTY 200 stock is forecast 22 trading days ahead using only prices up to that day, then compared with what happened. It scores price error against "no change", direction hit rates with 95% confidence ranges, how often the 80% range held, and results year by year.
2. **Rankings** (`rankingStudy.ts`, signals in `signals.ts`): each month-end the stocks are ranked by 12-month momentum, 6-month momentum, low volatility, distance above the 200-day average, 1-month reversal, and a composite of momentum + low volatility. The top 20% are "bought" equally for a month, less 0.4% per round trip on stocks that change. Results are compared with the average stock and NIFTY 50.
3. **Sealed test**: outcomes in the last 2 years aren't used to set anything. The pass rules were fixed before testing, and a signal is only "confirmed" if it passes the older years and still works in the sealed period.
4. **Outputs**: the Model report page, each stock's Trust grade, and its Rank (Dashboard and Analyze) by the confirmed signal with the strongest development result, or the pre-chosen composite if none passes. The top 20% of that ranking becomes a monthly paper portfolio that the Tracker follows from then on.

The likely range uses "adaptive" volatility (recent days weigh more, and simulated daily moves are resampled from the stock's own history so sudden big moves aren't smoothed away), with its width scaled so about 80% of outcomes land inside in the development years.

## Where the data comes from

| Stock | Locally (`npm run dev`) | Hosted site |
| --- | --- | --- |
| Built-in (`symbols.json`) and tracked | `public/data/` from `fetch-data`, or live via the dev server | Files built by the daily GitHub Action |
| 5-minute prices (Day trading) | Live from Yahoo via the dev server | Live from Yahoo via your Cloudflare Worker. After updating the Worker's code, redeploy it: `npx wrangler deploy` in `worker/` |
| Market depth and official intraday prices (optional) | Angel One SmartAPI through the dev server, using your `.env.local` | Not yet: the hosted site uses Yahoo |
| Fetched in the Fetch page | Live from Yahoo via the dev server | Live from Yahoo via your Cloudflare Worker |

Fetched stocks and their prices are kept in your browser (the list in localStorage, the prices in Cache Storage) and re-download once they're over 6 hours old.

## Angel One market data (free, on your PC)

Angel One's SmartAPI is free: live prices, **market depth** (best 5 bids and asks) and historical candles, with no subscription. The account is free to open and never needs money in it for paper trading (a Basic Services Demat Account with no holdings has no yearly fee). NSE Visor only reads market data; it has no code that places orders.

1. Open an Angel One account.
2. Sign in at [smartapi.angelbroking.com](https://smartapi.angelbroking.com), create an app (any redirect URL, such as `http://localhost`) and copy its API key.
3. Turn on TOTP at [smartapi.angelbroking.com/enable-totp](https://smartapi.angelbroking.com/enable-totp) and copy the secret shown under the QR code (not the API secret).
4. Copy `.env.example` to `.env.local` and fill in `ANGEL_API_KEY`, `ANGEL_CLIENT_CODE`, `ANGEL_PIN` and `ANGEL_TOTP_SECRET`. Optionally list up to 10 stocks in `ANGEL_RECORD` to save their depth every second during market hours to `data-local/depth/<date>/`.
5. Restart `npm run dev`.

What changes once it's set up:

- **Day trading** shows a live market depth panel (bids, asks, spread, buyer/seller balance) for up to 5 stocks.
- The Strategy lab and Paper trader use Angel One's 5-minute candles, with about 100 days of history instead of Yahoo's 60.
- `.env.local` and `data-local/` are ignored by git, and your details never reach the browser: the dev server logs in (generating the TOTP code itself) and passes only market data on.
- If a login fails it isn't retried automatically, because repeated wrong logins can lock an Angel One account. Fix `.env.local` and restart.

Running it on the hosted site (through the Cloudflare Worker, behind your passphrase) is a later step.

## Project map

```
src/
  App.tsx                 layout, page titles and shared state
  tabs/                   DashboardTab, PricesTab, AnalyzeTab, WatchlistTab, TrackerTab, ReportTab, TestsTab, DayTradingTab, FetchTab
  components/             sidebar, stock picker, charts, cards, panels, passphrase dialog
  hooks/                  loading, watchlist, fetched stocks, URL state
  lib/analyze.ts          runs indicators, backtest and forecast for one stock
  lib/tracker.ts          saves daily sheets and compares them with actual prices
  lib/portfolio.ts        monthly paper portfolios and their returns
  lib/prices.ts           price changes over each time frame, long monthly history
  lib/research/           backtest: forecast study, ranking signals and study, report
  lib/tests/              trading-rule tests and Indian brokerage charges
  lib/intraday/           5-minute bars, intraday strategies, risk limits, simulator, walk-forward test, paper trader
  lib/angel/              Angel One SmartAPI (market data only): TOTP login, candles, live depth parsing, instrument tokens
  lib/data/               data loading, browser storage, tracking API, Yahoo parsing, symbols
  lib/indicators/         SMA, EMA, RSI, MACD and signal rules
  lib/models/             forecast models, blend and backtest
scripts/
  fetch-data.ts           downloads NSE's stock list and built-in/tracked prices (runs in GitHub Actions)
  save-snapshot.ts        saves today's sheet
  build-tracker.ts        builds the Tracker's files
  research.ts             runs the research backtest
  same-day-test.ts        same-day trading test for every built-in stock
  margin-maximus-test.ts  Minimal Margin Maximus test for every built-in stock
  intraday-research.ts    Day trading strategy backtest for the NIFTY 50
  angel/                  local Angel One service for the dev server: login, price stream, depth recorder
  angel-tokens.ts         Angel One NSE instrument tokens (runs in GitHub Actions)
  angel-history.ts        saves Angel One candles to data-local/
  yahoo-fetch.ts          fetch with User-Agent header and retries
worker/
  yahoo-proxy.ts          Cloudflare Worker: Yahoo relay and the tracked-stocks list
  wrangler.jsonc          its configuration
symbols.json              NIFTY 50 constituents + the index itself
.github/workflows/deploy.yml
```

## Deploy to GitHub Pages

1. Create a GitHub repository (for example `nse-visor`) and push this project to `main`.
2. In the repository, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The workflow runs on every push, on weekdays at 17:00 IST (after market close), and on demand from the **Actions** tab (**Run workflow**). Each run saves that day's sheet to the `predictions` branch (created on the first run).

Notes:

- If Yahoo fails for a stock, the workflow reuses the copy already on the site. It only fails if more than 20% of stocks have no data.
- GitHub turns off scheduled workflows in public repositories after 60 days without activity on the default branch; the daily sheets go to a separate branch, so they don't count. If the schedule stops, re-enable it from the **Actions** tab.
- The NIFTY 200 member list is downloaded from NSE on every run, so index changes are picked up automatically. `symbols.json` only supplies friendlier names for NIFTY 50 stocks, and is the fallback if NSE's list can't be downloaded.

### Fetch and track any stock on the hosted site (Cloudflare Worker)

Without this, the hosted Fetch page explains that live fetching isn't set up; everything else still works. It takes about ten minutes on Cloudflare's free plan:

1. Create a free account at [cloudflare.com](https://dash.cloudflare.com/sign-up).
2. In `worker/wrangler.jsonc`, replace `YOUR-GITHUB-USERNAME` with your GitHub username, so only your site can use the Worker.
3. From the `worker` folder, sign in and create the storage for the tracked-stocks list:

   ```bash
   npx wrangler login
   ```

   ```bash
   npx wrangler kv namespace create TRACKED
   ```

   Paste the `id` it prints into `worker/wrangler.jsonc` in place of `PASTE-KV-NAMESPACE-ID-HERE`.
4. Choose a passphrase for **Track daily** (the app asks for it once per browser):

   ```bash
   npx wrangler secret put TRACK_PASSPHRASE
   ```

5. Deploy:

   ```bash
   npx wrangler deploy
   ```

   Wrangler prints the Worker's address, e.g. `https://nse-yahoo-proxy.<your-account>.workers.dev`.
6. In your GitHub repository, go to **Settings → Secrets and variables → Actions → Variables** and add a variable named `YAHOO_PROXY_URL` with that address.
7. Re-run the workflow from the **Actions** tab.

The Worker only relays daily price charts for valid tickers, and changing the tracked list requires the passphrase. The free plan allows 100,000 requests a day.

## Limitations

- Forecast dates skip weekends but not NSE holidays.
- One-month stock moves are mostly noise, so expect errors of several percent even from the best simple model.
- Yahoo Finance data is unofficial and can occasionally be missing or late-adjusted for splits. A split during a prediction's month makes that comparison look wrong.
- Yahoo sometimes rate-limits requests coming from cloud servers. If the hosted Fetch page reports HTTP 429, wait a minute and try again.
- The backtest uses today's NIFTY 200 members. Companies that dropped out of the index over the years are missing, which makes past results (especially momentum) look better than they really were. NSE's free files don't include historical membership.
- Backtests describe the past. The paper portfolio and saved daily predictions in the Tracker are the real test, and take months to build up.
