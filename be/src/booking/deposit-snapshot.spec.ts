import { requiredDepositVnd } from './deposit-snapshot';

describe('requiredDepositVnd', () => {
  it('requires nothing for NONE', () => {
    expect(requiredDepositVnd('NONE', null, null, '180000')).toBe('0');
  });

  it('uses the fixed amount, capped at the quote total', () => {
    expect(requiredDepositVnd('FIXED', '50000', null, '180000')).toBe('50000');
    expect(requiredDepositVnd('FIXED', '500000', null, '180000')).toBe('180000');
  });

  it('rounds a percentage up to the next whole VND', () => {
    expect(requiredDepositVnd('PERCENT', null, '30.0000', '180000')).toBe('54000');
    expect(requiredDepositVnd('PERCENT', null, '25.1250', '100001')).toBe('25126');
    expect(requiredDepositVnd('PERCENT', null, '33.3333', '100')).toBe('34');
    expect(requiredDepositVnd('PERCENT', null, '100', '180000')).toBe('180000');
  });

  it('keeps integer precision for large totals', () => {
    expect(requiredDepositVnd('PERCENT', null, '50', '9223372036854775806')).toBe('4611686018427387903');
  });

  it('requires nothing when the quote total is zero', () => {
    expect(requiredDepositVnd('FIXED', '50000', null, '0')).toBe('0');
    expect(requiredDepositVnd('PERCENT', null, '10', '0')).toBe('0');
  });
});
