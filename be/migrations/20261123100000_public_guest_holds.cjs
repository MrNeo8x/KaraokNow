exports.up = (pgm) => {
  pgm.alterColumn('booking_holds', 'created_by', { notNull: false });
  pgm.addColumns('booking_holds', {
    public_phone_hash: { type: 'char(64)' },
    booking_code_hash: { type: 'char(64)' },
    public_accepted_terms: { type: 'text' },
    public_accepted_terms_version: { type: 'bigint' }
  });
  pgm.addConstraint('booking_holds', 'ck_hold_creation_context', `CHECK (
    (created_by IS NOT NULL AND public_phone_hash IS NULL AND booking_code_hash IS NULL AND public_accepted_terms IS NULL AND public_accepted_terms_version IS NULL)
    OR
    (created_by IS NULL AND channel='WEB' AND public_phone_hash IS NOT NULL AND booking_code_hash IS NOT NULL AND public_accepted_terms IS NOT NULL AND public_accepted_terms_version IS NOT NULL)
  )`);
  pgm.createIndex('booking_holds', ['tenant_id', 'public_phone_hash', 'idempotency_key'], {
    name: 'uq_public_hold_idempotency', unique: true, where: 'created_by IS NULL'
  });
  pgm.createIndex('booking_holds', ['public_phone_hash', 'booking_code_hash'], {
    name: 'ix_public_hold_lookup', where: 'created_by IS NULL'
  });
  pgm.createTable('public_rate_limit_buckets', {
    scope: { type: 'varchar(40)', notNull: true },
    key_hash: { type: 'char(64)', notNull: true },
    window_started_at: { type: 'timestamptz', notNull: true, default: pgm.func('clock_timestamp()') },
    request_count: { type: 'integer', notNull: true, default: 1 },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('clock_timestamp()') }
  });
  pgm.addConstraint('public_rate_limit_buckets', 'pk_public_rate_limit_buckets', { primaryKey: ['scope', 'key_hash'] });
  pgm.addConstraint('public_rate_limit_buckets', 'ck_public_rate_limit_count', 'CHECK (request_count > 0)');
};

exports.down = (pgm) => {
  pgm.dropTable('public_rate_limit_buckets');
  pgm.dropIndex('booking_holds', ['public_phone_hash', 'booking_code_hash'], { name: 'ix_public_hold_lookup' });
  pgm.dropIndex('booking_holds', ['tenant_id', 'public_phone_hash', 'idempotency_key'], { name: 'uq_public_hold_idempotency' });
  pgm.dropConstraint('booking_holds', 'ck_hold_creation_context');
  pgm.dropColumns('booking_holds', ['public_phone_hash', 'booking_code_hash', 'public_accepted_terms', 'public_accepted_terms_version']);
  pgm.alterColumn('booking_holds', 'created_by', { notNull: true });
};
