import { describe, expect, it } from 'vitest';
import { parseEquityList, toListedStocks } from './stockList.ts';

const csv = [
  'SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE',
  '20MICRONS,20 Microns Limited,EQ,06-OCT-2008,5,1,INE144J01027,5',
  'M&M,Mahindra & Mahindra Limited,EQ,23-JAN-1996,5,1,INE101A01026,5',
  'AARTECH,Aartech Solonics Limited,BE,10-JUL-2023,5,1,INE01C001026,5',
  'ODDNAME,Odd Name, Private Limited,BZ,01-JAN-2020,10,1,INE000000000,10',
  '../BAD,Bad Symbol,EQ,01-JAN-2020,10,1,INE000000001,10',
  '',
].join('\r\n');

describe('parseEquityList', () => {
  it('reads symbol, name and series, skipping the header and bad rows', () => {
    expect(parseEquityList(csv)).toEqual([
      ['20MICRONS', '20 Microns Limited', 'EQ'],
      ['M&M', 'Mahindra & Mahindra Limited', 'EQ'],
      ['AARTECH', 'Aartech Solonics Limited', 'BE'],
      ['ODDNAME', 'Odd Name, Private Limited', 'BZ'],
    ]);
  });

  it('turns the file into Yahoo symbols', () => {
    const stocks = toListedStocks({ updatedAt: '', stocks: [['IRFC', 'Indian Railway Finance Corporation Limited', 'EQ']] });
    expect(stocks).toEqual([{ symbol: 'IRFC.NS', name: 'Indian Railway Finance Corporation Limited', series: 'EQ' }]);
  });
});
