exports.up = (pgm) => {
  pgm.addColumn('price_rules', {
    amount_unit: { type: 'varchar(20)' }
  });
  pgm.addConstraint('price_rules', 'ck_price_rule_amount_unit',
    "CHECK (amount_unit IS NULL OR amount_unit IN ('PER_HOUR','PER_BOOKING'))");

  pgm.createTable('tenant_booking_policies', {
    tenant_id: { type: 'uuid', primaryKey: true, references: 'tenants', onDelete: 'RESTRICT' },
    duration_step_minutes: { type: 'integer', notNull: true, default: 30 },
    min_duration_minutes: { type: 'integer', notNull: true, default: 60 },
    max_duration_minutes: { type: 'integer', notNull: true, default: 480 },
    updated_by: { type: 'uuid', references: 'users', onDelete: 'RESTRICT' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    version: { type: 'bigint', notNull: true, default: 0 }
  });
  pgm.addConstraint('tenant_booking_policies', 'ck_booking_policy_duration_step', 'CHECK (duration_step_minutes BETWEEN 1 AND 1440)');
  pgm.addConstraint('tenant_booking_policies', 'ck_booking_policy_min_duration', 'CHECK (min_duration_minutes BETWEEN 1 AND 1440)');
  pgm.addConstraint('tenant_booking_policies', 'ck_booking_policy_max_duration',
    'CHECK (max_duration_minutes BETWEEN 1 AND 1440 AND max_duration_minutes >= min_duration_minutes)');
};

exports.down = (pgm) => {
  pgm.dropTable('tenant_booking_policies');
  pgm.dropConstraint('price_rules', 'ck_price_rule_amount_unit');
  pgm.dropColumn('price_rules', 'amount_unit');
};
