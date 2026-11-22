export interface MatchingPriceRule {
  id: string;
  priority: number;
}

export class AmbiguousPriceRuleError extends Error {
  constructor(readonly ruleIds: string[]) {
    super(`Multiple matching price rules share the highest priority: ${ruleIds.join(', ')}`);
    this.name = 'AmbiguousPriceRuleError';
  }
}

/** Select the unique highest-priority rule from an already-filtered matching set. */
export function selectPriceRule<T extends MatchingPriceRule>(matches: readonly T[]): T | null {
  if (matches.length === 0) return null;
  const highestPriority = Math.max(...matches.map((rule) => rule.priority));
  const highest = matches.filter((rule) => rule.priority === highestPriority);
  if (highest.length > 1) throw new AmbiguousPriceRuleError(highest.map((rule) => rule.id).sort());
  return highest[0];
}
