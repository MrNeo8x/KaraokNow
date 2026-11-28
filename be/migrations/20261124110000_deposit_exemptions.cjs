exports.up = (pgm) => {
  // BKG-008 / PD-050: case-level deposit exemptions (per merchant) and per-hold manual waivers.
  pgm.createTable('tenant_deposit_exemption_policies', {
    tenant_id: { type: 'uuid', primaryKey: true, references: 'tenants', onDelete: 'RESTRICT' },
    max_amount_vnd: { type: 'bigint' },
    off_peak_windows: { type: 'jsonb', notNull: true, default: pgm.func(`'[]'::jsonb`) },
    regular_min_completed: { type: 'integer' },
    regular_lookback_days: { type: 'integer', notNull: true, default: 90 },
    waiver_roles: { type: 'text[]', notNull: true, default: pgm.func(`'{OWNER,BRANCH_MANAGER}'::text[]`) },
    version: { type: 'bigint', notNull: true, default: 0 },
    updated_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('clock_timestamp()') }
  });
  pgm.addConstraint('tenant_deposit_exemption_policies', 'ck_deposit_exemption_policy', `CHECK (
    (max_amount_vnd IS NULL OR max_amount_vnd > 0)
    AND (regular_min_completed IS NULL OR regular_min_completed BETWEEN 1 AND 100)
    AND regular_lookback_days BETWEEN 7 AND 730
    AND jsonb_typeof(off_peak_windows)='array' AND jsonb_array_length(off_peak_windows) <= 14
    AND 'OWNER' = ANY(waiver_roles)
    AND waiver_roles <@ ARRAY['OWNER','BRANCH_MANAGER','RECEPTIONIST','CASHIER']::text[])`);
  pgm.createTable('hold_deposit_waivers', {
    id: { type: 'uuid', primaryKey: true },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'RESTRICT' },
    branch_id: { type: 'uuid', notNull: true },
    hold_id: { type: 'uuid', notNull: true, unique: true, references: 'booking_holds', onDelete: 'RESTRICT' },
    reason: { type: 'varchar(500)', notNull: true },
    recorded_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    recorded_at: { type: 'timestamptz', notNull: true, default: pgm.func('clock_timestamp()') }
  });
  pgm.addConstraint('hold_deposit_waivers', 'ck_hold_deposit_waiver_reason', 'CHECK (length(trim(reason)) > 0)');
};

exports.down = (pgm) => {
  pgm.dropTable('hold_deposit_waivers');
  pgm.dropTable('tenant_deposit_exemption_policies');
};
