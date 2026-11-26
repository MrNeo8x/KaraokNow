exports.up = (pgm) => {
  pgm.dropConstraint('bookings', 'ck_booking_status');
  pgm.addConstraint('bookings', 'ck_booking_status', "CHECK (status IN ('CONFIRMED','CHECKED_IN','COMPLETED','CANCELLED','NO_SHOW'))");
  pgm.addColumns('bookings', {
    checked_in_at: { type: 'timestamptz' }, checked_in_by: { type: 'uuid', references: 'users', onDelete: 'RESTRICT' },
    checked_out_at: { type: 'timestamptz' }, checked_out_by: { type: 'uuid', references: 'users', onDelete: 'RESTRICT' }
  });
  pgm.addConstraint('bookings', 'ck_booking_lifecycle_fields', `CHECK (
    (checked_in_at IS NULL) = (checked_in_by IS NULL) AND (checked_out_at IS NULL) = (checked_out_by IS NULL)
    AND (checked_out_at IS NULL OR checked_in_at IS NOT NULL)
    AND (status <> 'CHECKED_IN' OR (checked_in_at IS NOT NULL AND checked_out_at IS NULL))
    AND (status <> 'COMPLETED' OR checked_out_at IS NOT NULL))`);

  // One staff-reviewed outcome per booking (PD-006/PD-015/PD-027). Refund is a staff-recorded CASH amount, never computed.
  pgm.createTable('booking_outcomes', {
    id: { type: 'uuid', primaryKey: true }, tenant_id: { type: 'uuid', notNull: true }, branch_id: { type: 'uuid', notNull: true },
    booking_id: { type: 'uuid', notNull: true, unique: true }, outcome_type: { type: 'varchar(30)', notNull: true },
    note: { type: 'varchar(1000)', notNull: true }, refund_amount_vnd: { type: 'bigint', notNull: true, default: 0 },
    request_hash: { type: 'char(64)', notNull: true },
    recorded_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    recorded_at: { type: 'timestamptz', notNull: true, default: pgm.func('clock_timestamp()') }
  });
  pgm.addConstraint('booking_outcomes', 'fk_booking_outcome_context', { foreignKeys: { columns: ['booking_id', 'tenant_id', 'branch_id'], references: 'bookings(id, tenant_id, branch_id)', onDelete: 'RESTRICT' } });
  pgm.addConstraint('booking_outcomes', 'ck_booking_outcome_type', "CHECK (outcome_type IN ('CUSTOMER_CANCELLED','MERCHANT_CANCELLED','NO_SHOW'))");
  pgm.addConstraint('booking_outcomes', 'ck_booking_outcome_refund', 'CHECK (refund_amount_vnd >= 0)');
  pgm.addConstraint('booking_outcomes', 'ck_booking_outcome_note', 'CHECK (length(trim(note)) > 0)');
};

exports.down = (pgm) => {
  pgm.dropTable('booking_outcomes');
  pgm.dropConstraint('bookings', 'ck_booking_lifecycle_fields');
  pgm.dropColumns('bookings', ['checked_in_at', 'checked_in_by', 'checked_out_at', 'checked_out_by']);
  pgm.dropConstraint('bookings', 'ck_booking_status');
  pgm.addConstraint('bookings', 'ck_booking_status', "CHECK (status IN ('CONFIRMED'))");
};
