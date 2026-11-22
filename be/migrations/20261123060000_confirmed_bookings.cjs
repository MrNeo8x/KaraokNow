exports.up = (pgm) => {
  pgm.dropConstraint('booking_holds', 'ck_hold_status');
  pgm.addConstraint('booking_holds', 'ck_hold_status', "CHECK (status IN ('HELD','EXPIRED','CONFIRMED'))");
  pgm.addConstraint('booking_holds', 'uq_hold_booking_context', { unique: ['id', 'tenant_id', 'branch_id', 'room_id', 'occupancy_id'] });
  pgm.createTable('bookings', {
    id: { type: 'uuid', primaryKey: true }, tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'RESTRICT' },
    branch_id: { type: 'uuid', notNull: true }, room_id: { type: 'uuid', notNull: true },
    hold_id: { type: 'uuid', notNull: true, unique: true, references: 'booking_holds', onDelete: 'RESTRICT' },
    occupancy_id: { type: 'uuid', notNull: true, unique: true, references: 'room_occupancy', onDelete: 'RESTRICT' },
    channel: { type: 'varchar(50)', notNull: true }, start_at: { type: 'timestamptz', notNull: true },
    duration_minutes: { type: 'integer', notNull: true }, buffer_minutes: { type: 'integer', notNull: true },
    customer_phone: { type: 'varchar(16)', notNull: true }, customer_email: { type: 'varchar(254)' },
    phone_verified_at: { type: 'timestamptz', notNull: true }, phone_verified_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    price_snapshot: { type: 'jsonb', notNull: true }, cancellation_terms: { type: 'text', notNull: true },
    confirmation_policy_snapshot: { type: 'jsonb', notNull: true }, status: { type: 'varchar(20)', notNull: true, default: 'CONFIRMED' },
    confirmed_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    confirmed_at: { type: 'timestamptz', notNull: true, default: pgm.func('clock_timestamp()') }
  });
  pgm.addConstraint('bookings', 'fk_booking_room_tenant', { foreignKeys: { columns: ['room_id', 'branch_id', 'tenant_id'], references: 'rooms(id, branch_id, tenant_id)', onDelete: 'RESTRICT' } });
  pgm.addConstraint('bookings', 'fk_booking_hold_context', { foreignKeys: { columns: ['hold_id', 'tenant_id', 'branch_id', 'room_id', 'occupancy_id'], references: 'booking_holds(id, tenant_id, branch_id, room_id, occupancy_id)', onDelete: 'RESTRICT' } });
  pgm.addConstraint('bookings', 'ck_booking_status', "CHECK (status IN ('CONFIRMED'))");
  pgm.addConstraint('bookings', 'ck_booking_terms', "CHECK (length(trim(cancellation_terms)) > 0 AND length(cancellation_terms) <= 5000)");
  pgm.createIndex('bookings', ['tenant_id', 'branch_id', 'start_at', 'id']);
};
exports.down = (pgm) => {
  pgm.dropTable('bookings');
  pgm.dropConstraint('booking_holds', 'uq_hold_booking_context');
  pgm.dropConstraint('booking_holds', 'ck_hold_status');
  pgm.addConstraint('booking_holds', 'ck_hold_status', "CHECK (status IN ('HELD','EXPIRED'))");
};
