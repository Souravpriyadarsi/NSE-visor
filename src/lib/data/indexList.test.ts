import { describe, expect, it } from 'vitest';
import { parseIndexList } from './indexList.ts';

describe('parseIndexList', () => {
  it('reads name, industry and Yahoo symbol, skipping bad rows', () => {
    const csv = [
      'Company Name,Industry,Symbol,Series,ISIN Code',
      '360 ONE WAM Ltd.,Financial Services,360ONE,EQ,INE466L01038',
      'Mahindra & Mahindra Ltd.,Automobile and Auto Components,M&M,EQ,INE101A01026',
      'Odd, Name Ltd.,Services,ODDNAME,EQ,INE000000000',
      'Broken row',
      '',
    ].join('\r\n');
    expect(parseIndexList(csv)).toEqual([
      { symbol: '360ONE.NS', name: '360 ONE WAM Ltd.', industry: 'Financial Services' },
      { symbol: 'M&M.NS', name: 'Mahindra & Mahindra Ltd.', industry: 'Automobile and Auto Components' },
      { symbol: 'ODDNAME.NS', name: 'Odd, Name Ltd.', industry: 'Services' },
    ]);
  });
});
