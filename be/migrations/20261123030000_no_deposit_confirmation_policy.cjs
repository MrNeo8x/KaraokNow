exports.up = (pgm) => {
  pgm.createTable('tenant_no_deposit_confirmation_policies', {
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'RESTRICT' },
    channel: { type: 'varchar(50)', notNull: true },
    allowed: { type: 'boolean', notNull: true },
    updated_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    version: { type: 'bigint', notNull: true, default: 0 }
  }, { constraints: { primaryKey: ['tenant_id', 'channel'] } });
  pgm.addConstraint('tenant_no_deposit_confirmation_policies', 'ck_no_deposit_channel', "CHECK (channel ~ '^[A-Z][A-Z0-9_]{0,49}$')");
};
exports.down = (pgm) => { pgm.dropTable('tenant_no_deposit_confirmation_policies'); };
