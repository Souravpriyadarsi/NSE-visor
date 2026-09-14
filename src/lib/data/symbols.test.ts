import { describe, expect, it } from 'vitest';
import { displaySymbol, fileId, isValidSymbol, normalizeSymbol, resolveSymbol } from './symbols.ts';

const options = [
  { symbol: 'RELIANCE.NS', name: 'Reliance Industries' },
  { symbol: 'M&M.NS', name: 'Mahindra & Mahindra' },
  { symbol: '^NSEI', name: 'NIFTY 50 Index' },
];

describe('symbols', () => {
  it('normalizes user input to Yahoo tickers', () => {
    expect(normalizeSymbol(' reliance ')).toBe('RELIANCE.NS');
    expect(normalizeSymbol('^nsei')).toBe('^NSEI');
    expect(normalizeSymbol('tcs.bo')).toBe('TCS.BO');
    expect(normalizeSymbol('bajaj-auto')).toBe('BAJAJ-AUTO.NS');
  });

  it('validates symbols', () => {
    expect(isValidSymbol('M&M.NS')).toBe(true);
    expect(isValidSymbol('^NSEI')).toBe(true);
    expect(isValidSymbol('../ETC')).toBe(false);
    expect(isValidSymbol('')).toBe(false);
  });

  it('builds safe file names', () => {
    expect(fileId('^NSEI')).toBe('_NSEI');
    expect(fileId('M&M.NS')).toBe('M_M.NS');
  });

  it('shows friendly names', () => {
    expect(displaySymbol('^NSEI')).toBe('NIFTY 50');
    expect(displaySymbol('^NSEBANK')).toBe('NIFTY BANK');
    expect(displaySymbol('TCS.NS')).toBe('TCS');
  });

  it('resolves search text by ticker, display name or company name', () => {
    expect(resolveSymbol('nifty 50', options)).toBe('^NSEI');
    expect(resolveSymbol('mahindra', options)).toBe('M&M.NS');
    expect(resolveSymbol('reliance', options)).toBe('RELIANCE.NS');
    expect(resolveSymbol('irfc', options)).toBe('IRFC.NS');
    expect(resolveSymbol('   ', options)).toBeNull();
  });
});
