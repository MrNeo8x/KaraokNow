exports.up = (pgm) => {
  // PD-040: Platform Admin user management. Actions on users have no tenant, so they get their own audit table
  // (audit_logs.tenant_id is NOT NULL). Reasons are the operator's justification (like PD-031); never passwords or contact data.
  pgm.createTable('platform_audit_logs', {
    id: { type: 'uuid', primaryKey: true },
    actor_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    action: { type: 'varchar(100)', notNull: true },
    entity_type: { type: 'varchar(50)', notNull: true },
    entity_id: { type: 'uuid', notNull: true },
    tenant_id: { type: 'uuid', references: 'tenants', onDelete: 'RESTRICT' },
    before_data: { type: 'jsonb' },
    after_data: { type: 'jsonb' },
    occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('clock_timestamp()') }
  });
  pgm.createIndex('platform_audit_logs', ['entity_id', 'occurred_at']);
  pgm.createIndex('platform_audit_logs', ['occurred_at']);

  pgm.addColumns('users', {
    disabled_at: { type: 'timestamptz' },
    disabled_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    disabled_reason: { type: 'varchar(500)' }
  });
  pgm.addColumns('platform_admins', {
    granted_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    revoked_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' }
  });
  // Search by email/name for the Platform user list.
  pgm.createIndex('users', ['display_name']);
};

exports.down = (pgm) => {
  pgm.dropIndex('users', ['display_name']);
  pgm.dropColumns('platform_admins', ['granted_by', 'revoked_by']);
  pgm.dropColumns('users', ['disabled_at', 'disabled_by', 'disabled_reason']);
  pgm.dropTable('platform_audit_logs');
};
