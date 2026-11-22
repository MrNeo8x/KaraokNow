exports.up = (pgm) => {
  pgm.createTable('outbox_events', {
    id: { type: 'uuid', primaryKey: true },
    tenant_id: { type: 'uuid', references: 'tenants', onDelete: 'RESTRICT' },
    event_type: { type: 'varchar(100)', notNull: true },
    aggregate_type: { type: 'varchar(80)', notNull: true },
    aggregate_id: { type: 'uuid', notNull: true },
    payload: { type: 'jsonb', notNull: true },
    status: { type: 'varchar(20)', notNull: true, default: 'PENDING' },
    attempts: { type: 'integer', notNull: true, default: 0 },
    available_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    locked_at: { type: 'timestamptz' },
    published_at: { type: 'timestamptz' },
    last_error: { type: 'varchar(200)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });
  pgm.addConstraint('outbox_events', 'ck_outbox_status',
    "CHECK (status IN ('PENDING','PROCESSING','PUBLISHED','DEAD'))");
  pgm.addConstraint('outbox_events', 'ck_outbox_attempts', 'CHECK (attempts >= 0)');
  pgm.createIndex('outbox_events', ['status', 'available_at', 'created_at']);
  pgm.createIndex('outbox_events', ['aggregate_type', 'aggregate_id']);
};

exports.down = (pgm) => pgm.dropTable('outbox_events');
