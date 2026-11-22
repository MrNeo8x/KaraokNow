exports.up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS btree_gist');
  pgm.addConstraint('rooms', 'uq_room_id_branch_tenant', { unique: ['id', 'branch_id', 'tenant_id'] });

  pgm.createTable('room_occupancy', {
    id: { type: 'uuid', primaryKey: true },
    tenant_id: { type: 'uuid', notNull: true },
    branch_id: { type: 'uuid', notNull: true },
    room_id: { type: 'uuid', notNull: true },
    source_type: { type: 'varchar(20)', notNull: true },
    source_id: { type: 'uuid', notNull: true },
    occupied_range: { type: 'tstzrange', notNull: true },
    status: { type: 'varchar(20)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });
  pgm.addConstraint('room_occupancy', 'fk_occupancy_room_tenant', {
    foreignKeys: { columns: ['room_id', 'branch_id', 'tenant_id'], references: 'rooms(id, branch_id, tenant_id)', onDelete: 'RESTRICT' }
  });
  pgm.addConstraint('room_occupancy', 'uq_occupancy_source', { unique: ['source_type', 'source_id'] });
  pgm.addConstraint('room_occupancy', 'ck_occupancy_source_type', "CHECK (source_type IN ('BOOKING','MAINTENANCE'))");
  pgm.addConstraint('room_occupancy', 'ck_occupancy_status',
    "CHECK (status IN ('HELD','CONFIRMED','IN_USE','MAINTENANCE','RELEASED'))");
  pgm.addConstraint('room_occupancy', 'ck_occupancy_range', 'CHECK (NOT isempty(occupied_range))');
  pgm.sql(`ALTER TABLE room_occupancy ADD CONSTRAINT no_active_room_overlap
    EXCLUDE USING gist (room_id WITH =, occupied_range WITH &&)
    WHERE (status IN ('HELD','CONFIRMED','IN_USE','MAINTENANCE'))`);
  pgm.createIndex('room_occupancy', ['tenant_id', 'branch_id', 'room_id']);

  pgm.createTable('room_blocks', {
    id: { type: 'uuid', primaryKey: true },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'RESTRICT' },
    branch_id: { type: 'uuid', notNull: true },
    room_id: { type: 'uuid', notNull: true },
    occupancy_id: { type: 'uuid', notNull: true, unique: true, references: 'room_occupancy', onDelete: 'RESTRICT' },
    reason: { type: 'varchar(500)', notNull: true },
    status: { type: 'varchar(20)', notNull: true },
    created_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });
  pgm.addConstraint('room_blocks', 'fk_room_block_room_tenant', {
    foreignKeys: { columns: ['room_id', 'branch_id', 'tenant_id'], references: 'rooms(id, branch_id, tenant_id)', onDelete: 'RESTRICT' }
  });
  pgm.addConstraint('room_blocks', 'ck_room_block_status', "CHECK (status IN ('ACTIVE','RELEASED'))");
  pgm.createIndex('room_blocks', ['tenant_id', 'branch_id', 'room_id']);
};

exports.down = (pgm) => {
  pgm.dropTable('room_blocks');
  pgm.dropTable('room_occupancy');
  pgm.dropConstraint('rooms', 'uq_room_id_branch_tenant');
};
