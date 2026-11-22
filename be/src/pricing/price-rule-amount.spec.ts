import { calculatePriceRuleAmount } from './price-rule-amount';

describe('price rule amount units', () => {
  it('multiplies an hourly rate by minutes and rounds the final VND amount half up', () => {
    expect(calculatePriceRuleAmount('100001', 'PER_HOUR', 90)).toBe('150002');
    expect(calculatePriceRuleAmount('1', 'PER_HOUR', 30)).toBe('1');
  });

  it('uses a fixed amount for each booking regardless of duration', () => {
    expect(calculatePriceRuleAmount('125000', 'PER_BOOKING', 60)).toBe('125000');
    expect(calculatePriceRuleAmount('125000', 'PER_BOOKING', 480)).toBe('125000');
  });

  it('rejects fractional amounts and invalid durations', () => {
    expect(() => calculatePriceRuleAmount('1.25', 'PER_HOUR', 60)).toThrow();
    expect(() => calculatePriceRuleAmount('1000', 'PER_HOUR', 0)).toThrow();
  });
});
