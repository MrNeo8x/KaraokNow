exports.up = (pgm) => {
  // Deposit policy is frozen on the hold when its price snapshot is taken (UAT-PD-002).
  pgm.addColumns('booking_holds', { deposit_policy_snapshot: { type: 'jsonb' } });
  pgm.addConstraint('booking_holds', 'ck_hold_deposit_snapshot', `CHECK (deposit_policy_snapshot IS NULL OR (
    deposit_policy_snapshot ? 'mode' AND deposit_policy_snapshot->>'mode' IN ('NONE','FIXED','PERCENT')
    AND deposit_policy_snapshot ? 'requiredAmountVnd'))`);
  pgm.addConstraint('booking_holds', 'uq_hold_tenant_branch', { unique: ['id', 'tenant_id', 'branch_id'] });
  pgm.createTable('hold_deposits', {
    id: { type: 'uuid', primaryKey: true }, tenant_id: { type: 'uuid', notNull: true }, branch_id: { type: 'uuid', notNull: true },
    hold_id: { type: 'uuid', notNull: true }, method: { type: 'varchar(20)', notNull: true }, amount_vnd: { type: 'bigint', notNull: true },
    note: { type: 'varchar(500)' }, recorded_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    idempotency_key: { type: 'varchar(100)', notNull: true }, request_hash: { type: 'char(64)', notNull: true },
    recorded_at: { type: 'timestamptz', notNull: true, default: pgm.func('clock_timestamp()') }
  });
  pgm.addConstraint('hold_deposits', 'fk_hold_deposit_context', { foreignKeys: { columns: ['hold_id', 'tenant_id', 'branch_id'], references: 'booking_holds(id, tenant_id, branch_id)', onDelete: 'RESTRICT' } });
  pgm.addConstraint('hold_deposits', 'uq_hold_deposit_idempotency', { unique: ['tenant_id', 'recorded_by', 'idempotency_key'] });
  pgm.addConstraint('hold_deposits', 'ck_hold_deposit_method', "CHECK (method IN ('CASH'))");
  pgm.addConstraint('hold_deposits', 'ck_hold_deposit_amount', 'CHECK (amount_vnd > 0)');
  pgm.createIndex('hold_deposits', ['tenant_id', 'hold_id', 'recorded_at', 'id']);
};

exports.down = (pgm) => {
  pgm.dropTable('hold_deposits');
  pgm.dropConstraint('booking_holds', 'uq_hold_tenant_branch');
  pgm.dropConstraint('booking_holds', 'ck_hold_deposit_snapshot');
  pgm.dropColumns('booking_holds', ['deposit_policy_snapshot']);
};
