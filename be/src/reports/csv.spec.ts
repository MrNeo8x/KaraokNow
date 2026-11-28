import { toCsv } from './csv';

describe('toCsv (RPT-001)', () => {
  it('escapes quotes, commas and newlines, neutralises formulas and keeps negative numbers', () => {
    const out = toCsv([{ a: 'Karaoke "Vip", Q1', b: '=HYPERLINK("x")', c: -5, d: null }, { a: 'dòng\nmới', b: '-10', c: '+84', d: 0 }], ['a', 'b', 'c', 'd']);
    expect(out.startsWith('﻿a,b,c,d\r\n')).toBe(true);
    expect(out).toContain('"Karaoke ""Vip"", Q1","\'=HYPERLINK(""x"")",-5,\r\n');
    expect(out).toContain('"dòng\nmới",-10,\'+84,0\r\n');
  });
});
