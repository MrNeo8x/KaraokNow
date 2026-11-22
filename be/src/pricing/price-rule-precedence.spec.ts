import { AmbiguousPriceRuleError, selectPriceRule } from './price-rule-precedence';

describe('price rule precedence', () => {
  it('selects the matching rule with the highest explicit priority', () => {
    expect(selectPriceRule([
      { id: 'weekday', priority: 10 },
      { id: 'holiday', priority: 20 }
    ])?.id).toBe('holiday');
  });

  it('rejects a tie at the highest priority instead of picking by insertion order', () => {
    expect(() => selectPriceRule([
      { id: 'rule-b', priority: 20 },
      { id: 'rule-a', priority: 20 },
      { id: 'lower', priority: 10 }
    ])).toThrow(new AmbiguousPriceRuleError(['rule-a', 'rule-b']));
  });

  it('returns null when no active rules match', () => {
    expect(selectPriceRule([])).toBeNull();
  });
});
