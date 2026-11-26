exports.up = (pgm) => {
  // Platform role is global (not tenant-scoped). Grants are provisioned out of band; no API can create them (UAT-PD-009).
  pgm.createTable('platform_admins', {
    user_id: { type: 'uuid', primaryKey: true, references: 'users', onDelete: 'RESTRICT' },
    granted_at: { type: 'timestamptz', notNull: true, default: pgm.func('clock_timestamp()') },
    revoked_at: { type: 'timestamptz' }
  });
  pgm.addColumns('tenant_public_catalog', {
    platform_decided_by: { type: 'uuid', references: 'users', onDelete: 'RESTRICT' },
    platform_decided_at: { type: 'timestamptz' }
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('tenant_public_catalog', ['platform_decided_by', 'platform_decided_at']);
  pgm.dropTable('platform_admins');
};
