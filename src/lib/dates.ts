const NSE_TIME_ZONE = 'Asia/Kolkata';
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Calendar date (YYYY-MM-DD) and minutes since midnight, as seen on the exchange's clock. */
export function exchangeClock(moment: Date, timeZone = NSE_TIME_ZONE): { date: string; minutes: number } {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(moment).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function toExchangeDate(unixSeconds: number, timeZone = NSE_TIME_ZONE): string {
  return exchangeClock(new Date(unixSeconds * 1000), timeZone).date;
}

function parseDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

/** The next `count` weekdays after `lastDate`. NSE holidays are not skipped. */
export function nextTradingDays(lastDate: string, count: number): string[] {
  const cursor = parseDate(lastDate);
  const days: string[] = [];
  while (days.length < count) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(toIsoDate(cursor));
  }
  return days;
}

export function subtractMonths(date: string, months: number): string {
  const d = parseDate(date);
  d.setUTCMonth(d.getUTCMonth() - months);
  return toIsoDate(d);
}

export function formatDate(date: string): string {
  return parseDate(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** "Jan 1996" */
export function formatMonth(date: string): string {
  return parseDate(date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function subtractDays(date: string, days: number): string {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() - days);
  return toIsoDate(d);
}

/** First day of a date's month: "2026-09-15" -> "2026-09-01". */
export function startOfMonth(date: string): string {
  return date ? `${date.slice(0, 7)}-01` : toIsoDate(new Date());
}

/** Moves to another month, keeping day 1: addMonths("2026-09-01", -1) -> "2026-08-01". */
export function addMonths(date: string, months: number): string {
  const d = parseDate(startOfMonth(date));
  d.setUTCMonth(d.getUTCMonth() + months);
  return toIsoDate(d);
}

/** The 42 days a calendar shows for a month: six Monday-to-Sunday weeks, including days either side. */
export function calendarGrid(monthStart: string): string[] {
  const cursor = parseDate(startOfMonth(monthStart));
  cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7));
  return Array.from({ length: 42 }, () => {
    const date = toIsoDate(cursor);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    return date;
  });
}

/** Whole days between two dates: daysBetween("2026-09-01", "2026-09-15") === 14. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000);
}
