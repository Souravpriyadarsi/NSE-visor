import { describe, expect, it } from 'vitest';
import { searchStocks } from './search.ts';

const options = [
  { symbol: 'TATAMOTORS.NS', name: 'Tata Motors Limited' },
  { symbol: 'IRFC.NS', name: 'Indian Railway Finance Corporation Limited' },
  { symbol: 'RAILTEL.NS', name: 'Railtel Corporation Of India Limited' },
  { symbol: 'TCS.NS', name: 'Tata Consultancy Services Limited' },
  { symbol: 'ITC.NS', name: 'ITC Limited' },
  { symbol: '^NSEBANK', name: 'Index' },
];

const symbols = (text: string, limit = 10) => searchStocks(options, text, limit).map((o) => o.symbol);

describe('searchStocks', () => {
  it('finds stocks by a word in the company name', () => {
    expect(symbols('railway')).toEqual(['IRFC.NS']);
    expect(symbols('tata')).toEqual(['TATAMOTORS.NS', 'TCS.NS']);
  });

  it('ranks an exact ticker first, then ticker prefixes, then names', () => {
    expect(symbols('tc')).toEqual(['TCS.NS', 'ITC.NS']);
    expect(symbols('rail')).toEqual(['RAILTEL.NS', 'IRFC.NS']);
    expect(symbols('itc')).toEqual(['ITC.NS']);
  });

  it('matches index display names', () => {
    expect(symbols('nifty bank')).toEqual(['^NSEBANK']);
  });

  it('returns the first options for empty text and respects the limit', () => {
    expect(symbols('', 2)).toEqual(['TATAMOTORS.NS', 'IRFC.NS']);
    expect(symbols('limited', 1)).toHaveLength(1);
  });
});
