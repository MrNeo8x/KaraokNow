exports.up = (pgm) => {
  // PAY-007 / PD-036: manual cash reconciliation. Original money records stay immutable; corrections are reversals.
  pgm.createTable('booking_surcharges', {
    id: { type: 'uuid', primaryKey: true }, tenant_id: { type: 'uuid', notNull: true }, branch_id: { type: 'uuid', notNull: true },
    booking_id: { type: 'uuid', notNull: true }, amount_vnd: { type: 'bigint', notNull: true }, reason: { type: 'varchar(500)', notNull: true },
    recorded_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    idempotency_key: { type: 'varchar(100)', notNull: true }, request_hash: { type: 'char(64)', notNull: true },
    recorded_at: { type: 'timestamptz', notNull: true, default: pgm.func('clock_timestamp()') }
  });
  pgm.addConstraint('booking_surcharges', 'fk_surcharge_booking_context', { foreignKeys: { columns: ['booking_id', 'tenant_id', 'branch_id'], references: 'bookings(id, tenant_id, branch_id)', onDelete: 'RESTRICT' } });
  pgm.addConstraint('booking_surcharges', 'uq_surcharge_idempotency', { unique: ['tenant_id', 'recorded_by', 'idempotency_key'] });
  pgm.addConstraint('booking_surcharges', 'ck_surcharge_amount', 'CHECK (amount_vnd > 0)');
  pgm.addConstraint('booking_surcharges', 'ck_surcharge_reason', 'CHECK (length(trim(reason)) > 0)');
  pgm.createIndex('booking_surcharges', ['tenant_id', 'booking_id', 'recorded_at']);

  pgm.createTable('money_reversals', {
    id: { type: 'uuid', primaryKey: true }, tenant_id: { type: 'uuid', notNull: true }, branch_id: { type: 'uuid', notNull: true },
    entry_type: { type: 'varchar(20)', notNull: true }, entry_id: { type: 'uuid', notNull: true },
    amount_vnd: { type: 'bigint', notNull: true }, reason: { type: 'varchar(500)', notNull: true },
    recorded_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    recorded_at: { type: 'timestamptz', notNull: true, default: pgm.func('clock_timestamp()') }
  });
  pgm.addConstraint('money_reversals', 'uq_money_reversal_entry', { unique: ['entry_type', 'entry_id'] });
  pgm.addConstraint('money_reversals', 'ck_money_reversal_type', "CHECK (entry_type IN ('HOLD_DEPOSIT','MANUAL_PAYMENT','SURCHARGE'))");
  pgm.addConstraint('money_reversals', 'ck_money_reversal_amount', 'CHECK (amount_vnd > 0)');
  pgm.addConstraint('money_reversals', 'ck_money_reversal_reason', 'CHECK (length(trim(reason)) > 0)');
  pgm.createIndex('money_reversals', ['tenant_id', 'branch_id', 'recorded_at']);

  pgm.createTable('hold_deposit_resolutions', {
    id: { type: 'uuid', primaryKey: true }, tenant_id: { type: 'uuid', notNull: true }, branch_id: { type: 'uuid', notNull: true },
    hold_id: { type: 'uuid', notNull: true, unique: true }, net_deposit_vnd: { type: 'bigint', notNull: true },
    refund_amount_vnd: { type: 'bigint', notNull: true }, reason: { type: 'varchar(500)', notNull: true },
    request_hash: { type: 'char(64)', notNull: true },
    recorded_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    recorded_at: { type: 'timestamptz', notNull: true, default: pgm.func('clock_timestamp()') }
  });
  pgm.addConstraint('hold_deposit_resolutions', 'fk_deposit_resolution_hold', { foreignKeys: { columns: ['hold_id', 'tenant_id', 'branch_id'], references: 'booking_holds(id, tenant_id, branch_id)', onDelete: 'RESTRICT' } });
  pgm.addConstraint('hold_deposit_resolutions', 'ck_deposit_resolution_amounts', 'CHECK (refund_amount_vnd >= 0 AND net_deposit_vnd > 0 AND refund_amount_vnd <= net_deposit_vnd)');
  pgm.addConstraint('hold_deposit_resolutions', 'ck_deposit_resolution_reason', 'CHECK (length(trim(reason)) > 0)');
  pgm.createIndex('hold_deposit_resolutions', ['tenant_id', 'branch_id', 'recorded_at']);

  // Daily cash report scans by branch and recorded time.
  pgm.createIndex('manual_payments', ['tenant_id', 'branch_id', 'recorded_at']);
  pgm.createIndex('hold_deposits', ['tenant_id', 'branch_id', 'recorded_at']);
  pgm.createIndex('booking_outcomes', ['tenant_id', 'branch_id', 'recorded_at']);
};

exports.down = (pgm) => {
  pgm.dropIndex('booking_outcomes', ['tenant_id', 'branch_id', 'recorded_at']);
  pgm.dropIndex('hold_deposits', ['tenant_id', 'branch_id', 'recorded_at']);
  pgm.dropIndex('manual_payments', ['tenant_id', 'branch_id', 'recorded_at']);
  pgm.dropTable('hold_deposit_resolutions');
  pgm.dropTable('money_reversals');
  pgm.dropTable('booking_surcharges');
};
