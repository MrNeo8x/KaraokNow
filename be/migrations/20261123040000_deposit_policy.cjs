exports.up = (pgm) => {
  pgm.createTable('tenant_deposit_policies', {
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'RESTRICT' },
    channel: { type: 'varchar(50)', notNull: true }, mode: { type: 'varchar(20)', notNull: true },
    fixed_amount_vnd: { type: 'bigint' }, percent: { type: 'numeric(7,4)' },
    updated_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    version: { type: 'bigint', notNull: true, default: 0 }
  }, { constraints: { primaryKey: ['tenant_id', 'channel'] } });
  pgm.addConstraint('tenant_deposit_policies', 'ck_deposit_channel', "CHECK (channel ~ '^[A-Z][A-Z0-9_]{0,49}$')");
  pgm.addConstraint('tenant_deposit_policies', 'ck_deposit_values', `CHECK (
    (mode='NONE' AND fixed_amount_vnd IS NULL AND percent IS NULL) OR
    (mode='FIXED' AND fixed_amount_vnd IS NOT NULL AND fixed_amount_vnd > 0 AND percent IS NULL) OR
    (mode='PERCENT' AND fixed_amount_vnd IS NULL AND percent IS NOT NULL AND percent > 0 AND percent <= 100))`);
};
exports.down = (pgm) => { pgm.dropTable('tenant_deposit_policies'); };
