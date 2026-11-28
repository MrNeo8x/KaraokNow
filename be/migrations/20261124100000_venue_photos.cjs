exports.up = (pgm) => {
  // PD-048: photo galleries for the merchant (branch_id NULL) and for each branch; at most 10 each (enforced in the service
  // under an advisory lock). Files live in the public Blob store like room photos (PD-037).
  pgm.createTable('venue_photos', {
    id: { type: 'uuid', primaryKey: true },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'RESTRICT' },
    branch_id: { type: 'uuid' },
    pathname: { type: 'varchar(500)', notNull: true, unique: true },
    url: { type: 'text', notNull: true },
    content_type: { type: 'varchar(100)', notNull: true },
    size_bytes: { type: 'integer', notNull: true },
    storage_backend: { type: 'varchar(20)', notNull: true },
    alt_text: { type: 'varchar(300)' },
    display_order: { type: 'integer', notNull: true, default: 0 },
    uploaded_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('clock_timestamp()') }
  });
  pgm.addConstraint('venue_photos', 'fk_venue_photo_branch', { foreignKeys: { columns: ['branch_id', 'tenant_id'], references: 'branches(id, tenant_id)', onDelete: 'RESTRICT' } });
  pgm.addConstraint('venue_photos', 'ck_venue_photo', `CHECK (content_type IN ('image/jpeg','image/png','image/webp') AND size_bytes > 0
    AND storage_backend IN ('VERCEL_BLOB','LOCAL') AND display_order BETWEEN 0 AND 1000)`);
  pgm.createIndex('venue_photos', ['tenant_id', 'branch_id', 'display_order']);
};

exports.down = (pgm) => {
  pgm.dropTable('venue_photos');
};
