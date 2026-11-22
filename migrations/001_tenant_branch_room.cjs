exports.up = (pgm) => {
  pgm.createTable('tenants', {
    id: { type: 'uuid', primaryKey: true },
    code: { type: 'varchar(50)', notNull: true, unique: true },
    name: { type: 'varchar(200)', notNull: true },
    status: { type: 'varchar(20)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });
  pgm.addConstraint('tenants', 'ck_tenant_status', "CHECK (status IN ('ACTIVE','INACTIVE'))");

  pgm.createTable('branches', {
    id: { type: 'uuid', primaryKey: true },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'RESTRICT' },
    code: { type: 'varchar(50)', notNull: true },
    name: { type: 'varchar(200)', notNull: true },
    timezone: { type: 'varchar(64)', notNull: true },
    status: { type: 'varchar(20)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    version: { type: 'bigint', notNull: true, default: 0 }
  });
  pgm.addConstraint('branches', 'uq_branch_code_per_tenant', { unique: ['tenant_id', 'code'] });
  pgm.addConstraint('branches', 'uq_branch_id_tenant', { unique: ['id', 'tenant_id'] });
  pgm.addConstraint('branches', 'ck_branch_status', "CHECK (status IN ('ACTIVE','INACTIVE'))");

  pgm.createTable('rooms', {
    id: { type: 'uuid', primaryKey: true },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'RESTRICT' },
    branch_id: { type: 'uuid', notNull: true },
    code: { type: 'varchar(50)', notNull: true },
    name: { type: 'varchar(200)', notNull: true },
    capacity: { type: 'integer', notNull: true },
    status: { type: 'varchar(20)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    version: { type: 'bigint', notNull: true, default: 0 }
  });
  pgm.addConstraint('rooms', 'fk_room_branch_tenant', {
    foreignKeys: { columns: ['branch_id', 'tenant_id'], references: 'branches(id, tenant_id)' }
  });
  pgm.addConstraint('rooms', 'uq_room_code_per_branch', { unique: ['branch_id', 'code'] });
  pgm.addConstraint('rooms', 'ck_room_capacity', 'CHECK (capacity > 0)');
  pgm.addConstraint('rooms', 'ck_room_status', "CHECK (status IN ('ACTIVE','MAINTENANCE','INACTIVE'))");
  pgm.createIndex('branches', 'tenant_id');
  pgm.createIndex('rooms', ['tenant_id', 'branch_id']);
};

exports.down = (pgm) => {
  pgm.dropTable('rooms');
  pgm.dropTable('branches');
  pgm.dropTable('tenants');
};
