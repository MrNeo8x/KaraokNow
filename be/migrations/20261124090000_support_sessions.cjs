exports.up = (pgm) => {
  // PD-045: Super Admin read-only support sessions into a merchant (reason required, 60 minutes, audited on both sides).
  pgm.addColumns('platform_admins', { super_admin: { type: 'boolean', notNull: true, default: false } });
  pgm.createTable('support_sessions', {
    id: { type: 'uuid', primaryKey: true },
    admin_user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'RESTRICT' },
    reason: { type: 'varchar(500)', notNull: true },
    started_at: { type: 'timestamptz', notNull: true, default: pgm.func('clock_timestamp()') },
    expires_at: { type: 'timestamptz', notNull: true },
    ended_at: { type: 'timestamptz' }
  });
  pgm.addConstraint('support_sessions', 'ck_support_session', `CHECK (length(trim(reason)) > 0 AND expires_at > started_at)`);
  pgm.createIndex('support_sessions', ['admin_user_id', 'tenant_id'], { name: 'ix_support_session_active', where: 'ended_at IS NULL' });
  pgm.createIndex('support_sessions', ['started_at']);
};

exports.down = (pgm) => {
  pgm.dropTable('support_sessions');
  pgm.dropColumns('platform_admins', ['super_admin']);
};
