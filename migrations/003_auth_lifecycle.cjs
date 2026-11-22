exports.up = (pgm) => {
  pgm.addColumns('users', {
    must_change_password: { type: 'boolean', notNull: true, default: false },
    password_changed_at: { type: 'timestamptz' }
  });
  pgm.createTable('auth_sessions', {
    id: { type: 'uuid', primaryKey: true },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    family_id: { type: 'uuid', notNull: true },
    refresh_token_hash: { type: 'char(64)', notNull: true, unique: true },
    expires_at: { type: 'timestamptz', notNull: true },
    revoked_at: { type: 'timestamptz' },
    replaced_by: { type: 'uuid' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_used_at: { type: 'timestamptz' }
  });
  pgm.addConstraint('auth_sessions', 'fk_auth_session_replacement', {
    foreignKeys: { columns: 'replaced_by', references: 'auth_sessions(id)', onDelete: 'SET NULL' }
  });
  pgm.createIndex('auth_sessions', ['user_id', 'created_at']);
  pgm.createIndex('auth_sessions', ['family_id']);

  pgm.createTable('auth_login_throttles', {
    email: { type: 'varchar(254)', primaryKey: true },
    failed_count: { type: 'integer', notNull: true },
    window_started_at: { type: 'timestamptz', notNull: true },
    locked_until: { type: 'timestamptz' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });

  pgm.createTable('password_reset_tokens', {
    id: { type: 'uuid', primaryKey: true },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    token_hash: { type: 'char(64)', notNull: true, unique: true },
    expires_at: { type: 'timestamptz', notNull: true },
    used_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });
  pgm.createIndex('password_reset_tokens', ['user_id', 'created_at']);
  pgm.createTable('auth_security_events', {
    id: { type: 'uuid', primaryKey: true },
    user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    event: { type: 'varchar(80)', notNull: true },
    metadata: { type: 'jsonb', notNull: true, default: '{}' },
    occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });
  pgm.createIndex('auth_security_events', ['user_id', 'occurred_at']);
};

exports.down = (pgm) => {
  pgm.dropTable('auth_security_events');
  pgm.dropTable('password_reset_tokens');
  pgm.dropTable('auth_login_throttles');
  pgm.dropTable('auth_sessions');
  pgm.dropColumns('users', ['must_change_password', 'password_changed_at']);
};
