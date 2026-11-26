import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  it.each(['0912345678', '+84912345678', '84912345678', '+840912345678'])('maps %s to +84912345678', (input) => {
    expect(normalizePhone(input)).toBe('+84912345678');
  });

  it('keeps other international numbers unchanged', () => {
    expect(normalizePhone('+6591234567')).toBe('+6591234567');
  });

  it('keeps numbers whose country cannot be inferred unchanged', () => {
    expect(normalizePhone('12345678')).toBe('12345678');
    expect(normalizePhone('841234567')).toBe('841234567');
  });
});
