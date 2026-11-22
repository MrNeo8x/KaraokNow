exports.up = (pgm) => {
  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true },
    email: { type: 'varchar(254)', notNull: true, unique: true },
    password_hash: { type: 'varchar(100)', notNull: true },
    display_name: { type: 'varchar(200)', notNull: true },
    status: { type: 'varchar(20)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });
  pgm.addConstraint('users', 'ck_user_status', "CHECK (status IN ('ACTIVE','DISABLED'))");

  pgm.createTable('tenant_memberships', {
    id: { type: 'uuid', primaryKey: true },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'RESTRICT' },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    status: { type: 'varchar(20)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });
  pgm.addConstraint('tenant_memberships', 'uq_membership_tenant_user', { unique: ['tenant_id', 'user_id'] });
  pgm.addConstraint('tenant_memberships', 'uq_membership_id_tenant', { unique: ['id', 'tenant_id'] });
  pgm.addConstraint('tenant_memberships', 'ck_membership_status', "CHECK (status IN ('ACTIVE','INACTIVE'))");

  pgm.createTable('membership_roles', {
    membership_id: { type: 'uuid', notNull: true, references: 'tenant_memberships', onDelete: 'CASCADE' },
    role: { type: 'varchar(32)', notNull: true }
  });
  pgm.addConstraint('membership_roles', 'pk_membership_roles', { primaryKey: ['membership_id', 'role'] });
  pgm.addConstraint('membership_roles', 'ck_membership_role',
    "CHECK (role IN ('OWNER','BRANCH_MANAGER','RECEPTIONIST','CASHIER'))");

  pgm.createTable('membership_branches', {
    membership_id: { type: 'uuid', notNull: true },
    tenant_id: { type: 'uuid', notNull: true },
    branch_id: { type: 'uuid', notNull: true }
  });
  pgm.addConstraint('membership_branches', 'pk_membership_branches', { primaryKey: ['membership_id', 'branch_id'] });
  pgm.addConstraint('membership_branches', 'fk_membership_branch_membership', {
    foreignKeys: { columns: ['membership_id', 'tenant_id'], references: 'tenant_memberships(id, tenant_id)', onDelete: 'CASCADE' }
  });
  pgm.addConstraint('membership_branches', 'fk_membership_branch_branch', {
    foreignKeys: { columns: ['branch_id', 'tenant_id'], references: 'branches(id, tenant_id)', onDelete: 'CASCADE' }
  });

  pgm.createTable('audit_logs', {
    id: { type: 'uuid', primaryKey: true },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'RESTRICT' },
    actor_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    action: { type: 'varchar(100)', notNull: true },
    entity_type: { type: 'varchar(50)', notNull: true },
    entity_id: { type: 'uuid', notNull: true },
    before_data: { type: 'jsonb' },
    after_data: { type: 'jsonb' },
    occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });
  pgm.createIndex('tenant_memberships', ['tenant_id', 'user_id']);
  pgm.createIndex('audit_logs', ['tenant_id', 'occurred_at']);
};

exports.down = (pgm) => {
  pgm.dropTable('audit_logs');
  pgm.dropTable('membership_branches');
  pgm.dropTable('membership_roles');
  pgm.dropTable('tenant_memberships');
  pgm.dropTable('users');
};
