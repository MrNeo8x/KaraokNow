exports.up = (pgm) => {
  // PD-043: branch opening hours. closes_at <= opens_at means the branch closes after midnight (e.g. 09:00–02:00).
  // Both NULL = no restriction (open 24 h).
  pgm.addColumns('branches', { opens_at: { type: 'time' }, closes_at: { type: 'time' } });
  pgm.addConstraint('branches', 'ck_branch_opening_hours', `CHECK (
    (opens_at IS NULL AND closes_at IS NULL)
    OR (opens_at IS NOT NULL AND closes_at IS NOT NULL AND opens_at <> closes_at
        AND extract(second FROM opens_at)=0 AND extract(second FROM closes_at)=0))`);
};

exports.down = (pgm) => {
  pgm.dropConstraint('branches', 'ck_branch_opening_hours');
  pgm.dropColumns('branches', ['opens_at', 'closes_at']);
};
