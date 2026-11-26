exports.up = (pgm) => {
  // PD-030: overtime is recorded at check-out only (minutes, no charge, no occupancy extension).
  pgm.createTable('tenant_overtime_policies', {
    tenant_id: { type: 'uuid', primaryKey: true, references: 'tenants', onDelete: 'RESTRICT' },
    grace_minutes: { type: 'integer', notNull: true },
    updated_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    version: { type: 'bigint', notNull: true, default: 0 }
  });
  pgm.addConstraint('tenant_overtime_policies', 'ck_overtime_grace', 'CHECK (grace_minutes BETWEEN 0 AND 60)');
  pgm.addColumns('bookings', {
    late_minutes: { type: 'integer' },
    overtime_minutes: { type: 'integer' },
    overtime_grace_minutes: { type: 'integer' }
  });
  pgm.addConstraint('bookings', 'ck_booking_overtime', `CHECK (
    (late_minutes IS NULL AND overtime_minutes IS NULL AND overtime_grace_minutes IS NULL)
    OR (checked_out_at IS NOT NULL AND late_minutes >= 0 AND overtime_minutes >= 0 AND overtime_grace_minutes BETWEEN 0 AND 60
        AND (overtime_minutes = 0 OR overtime_minutes = late_minutes)))`);
};

exports.down = (pgm) => {
  pgm.dropConstraint('bookings', 'ck_booking_overtime');
  pgm.dropColumns('bookings', ['late_minutes', 'overtime_minutes', 'overtime_grace_minutes']);
  pgm.dropTable('tenant_overtime_policies');
};
