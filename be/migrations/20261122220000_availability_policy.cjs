exports.up = (pgm) => {
  pgm.createTable('tenant_availability_policies', {
    tenant_id: { type: 'uuid', primaryKey: true, references: 'tenants', onDelete: 'RESTRICT' },
    buffer_enabled: { type: 'boolean', notNull: true, default: true },
    buffer_minutes: { type: 'integer', notNull: true, default: 15 },
    updated_by: { type: 'uuid', references: 'users', onDelete: 'RESTRICT' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    version: { type: 'bigint', notNull: true, default: 0 }
  });
  pgm.addConstraint('tenant_availability_policies', 'ck_availability_policy_buffer_minutes',
    'CHECK (buffer_minutes BETWEEN 0 AND 1440)');
};

exports.down = (pgm) => {
  pgm.dropTable('tenant_availability_policies');
};
