exports.up = (pgm) => {
  pgm.addConstraint('bookings', 'uq_booking_tenant_branch', { unique: ['id', 'tenant_id', 'branch_id'] });
  pgm.createTable('manual_payments', {
    id: { type: 'uuid', primaryKey: true }, tenant_id: { type: 'uuid', notNull: true }, branch_id: { type: 'uuid', notNull: true },
    booking_id: { type: 'uuid', notNull: true }, method: { type: 'varchar(20)', notNull: true }, amount_vnd: { type: 'bigint', notNull: true },
    note: { type: 'varchar(500)' }, recorded_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    idempotency_key: { type: 'varchar(100)', notNull: true }, request_hash: { type: 'char(64)', notNull: true },
    recorded_at: { type: 'timestamptz', notNull: true, default: pgm.func('clock_timestamp()') }
  });
  pgm.addConstraint('manual_payments', 'fk_manual_payment_booking_context', { foreignKeys: { columns: ['booking_id', 'tenant_id', 'branch_id'], references: 'bookings(id, tenant_id, branch_id)', onDelete: 'RESTRICT' } });
  pgm.addConstraint('manual_payments', 'uq_manual_payment_idempotency', { unique: ['tenant_id', 'recorded_by', 'idempotency_key'] });
  pgm.addConstraint('manual_payments', 'ck_manual_payment_method', "CHECK (method IN ('CASH'))");
  pgm.addConstraint('manual_payments', 'ck_manual_payment_amount', 'CHECK (amount_vnd > 0)');
  pgm.createIndex('manual_payments', ['tenant_id', 'booking_id', 'recorded_at', 'id']);
};
exports.down = (pgm) => { pgm.dropTable('manual_payments'); pgm.dropConstraint('bookings', 'uq_booking_tenant_branch'); };
