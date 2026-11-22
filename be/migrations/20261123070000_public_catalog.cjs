exports.up = (pgm) => {
  pgm.createTable('tenant_public_catalog', {
    tenant_id: { type: 'uuid', primaryKey: true, references: 'tenants', onDelete: 'RESTRICT' },
    published: { type: 'boolean', notNull: true, default: false },
    platform_approved: { type: 'boolean', notNull: true, default: false },
    updated_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('clock_timestamp()') },
    version: { type: 'bigint', notNull: true, default: 0 }
  });
};
exports.down = (pgm) => { pgm.dropTable('tenant_public_catalog'); };
