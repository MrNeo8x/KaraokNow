exports.up = (pgm) => {
  pgm.createTable('booking_holds', {
    id: { type: 'uuid', primaryKey: true }, tenant_id: { type: 'uuid', notNull: true, references: 'tenants' },
    branch_id: { type: 'uuid', notNull: true }, room_id: { type: 'uuid', notNull: true },
    occupancy_id: { type: 'uuid', notNull: true, unique: true, references: 'room_occupancy' },
    created_by: { type: 'uuid', notNull: true, references: 'users' },
    idempotency_key: { type: 'varchar(100)', notNull: true }, request_hash: { type: 'char(64)', notNull: true },
    channel: { type: 'varchar(50)', notNull: true }, start_at: { type: 'timestamptz', notNull: true },
    duration_minutes: { type: 'integer', notNull: true }, buffer_minutes: { type: 'integer', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true }, status: { type: 'varchar(20)', notNull: true, default: 'HELD' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });
  pgm.addConstraint('booking_holds', 'uq_hold_idempotency', { unique: ['tenant_id', 'created_by', 'idempotency_key'] });
  pgm.addConstraint('booking_holds', 'fk_hold_room_tenant', { foreignKeys: { columns: ['room_id', 'branch_id', 'tenant_id'], references: 'rooms(id, branch_id, tenant_id)', onDelete: 'RESTRICT' } });
  pgm.addConstraint('booking_holds', 'ck_hold_status', "CHECK (status IN ('HELD','EXPIRED'))");
  pgm.addConstraint('booking_holds', 'ck_hold_minutes', 'CHECK (duration_minutes > 0 AND buffer_minutes >= 0)');
  pgm.createIndex('booking_holds', ['expires_at'], { where: "status = 'HELD'" });
};
exports.down = (pgm) => { pgm.dropTable('booking_holds'); };
