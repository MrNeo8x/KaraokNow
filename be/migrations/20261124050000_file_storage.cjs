exports.up = (pgm) => {
  // PD-037: files in Vercel Blob (public store: room photos, merchant logo; private store: merchant PDF documents).
  // `storage_backend` records where each object lives so deletes go to the right place (LOCAL is dev/test only).
  pgm.addColumns('room_media', {
    storage_url: { type: 'text' }, content_type: { type: 'varchar(100)' }, size_bytes: { type: 'integer' }, storage_backend: { type: 'varchar(20)' }
  });
  pgm.addConstraint('room_media', 'ck_room_media_upload', `CHECK (
    (storage_url IS NULL AND content_type IS NULL AND size_bytes IS NULL AND storage_backend IS NULL)
    OR (storage_url IS NOT NULL AND content_type IN ('image/jpeg','image/png','image/webp') AND size_bytes > 0
        AND storage_backend IN ('VERCEL_BLOB','LOCAL')))`);

  pgm.createTable('merchant_logos', {
    tenant_id: { type: 'uuid', primaryKey: true, references: 'tenants', onDelete: 'RESTRICT' },
    pathname: { type: 'varchar(500)', notNull: true }, url: { type: 'text', notNull: true },
    content_type: { type: 'varchar(100)', notNull: true }, size_bytes: { type: 'integer', notNull: true },
    storage_backend: { type: 'varchar(20)', notNull: true },
    updated_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('clock_timestamp()') }
  });
  pgm.addConstraint('merchant_logos', 'ck_merchant_logo_file', `CHECK (content_type IN ('image/jpeg','image/png','image/webp') AND size_bytes > 0
    AND storage_backend IN ('VERCEL_BLOB','LOCAL'))`);

  pgm.createTable('merchant_documents', {
    id: { type: 'uuid', primaryKey: true }, tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'RESTRICT' },
    title: { type: 'varchar(200)', notNull: true }, pathname: { type: 'varchar(500)', notNull: true, unique: true },
    content_type: { type: 'varchar(100)', notNull: true }, size_bytes: { type: 'integer', notNull: true },
    storage_backend: { type: 'varchar(20)', notNull: true },
    uploaded_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    uploaded_at: { type: 'timestamptz', notNull: true, default: pgm.func('clock_timestamp()') }
  });
  pgm.addConstraint('merchant_documents', 'ck_merchant_document_file', `CHECK (content_type = 'application/pdf' AND size_bytes > 0
    AND storage_backend IN ('VERCEL_BLOB','LOCAL') AND length(trim(title)) > 0)`);
  pgm.createIndex('merchant_documents', ['tenant_id', 'uploaded_at']);
};

exports.down = (pgm) => {
  pgm.dropTable('merchant_documents');
  pgm.dropTable('merchant_logos');
  pgm.dropConstraint('room_media', 'ck_room_media_upload');
  pgm.dropColumns('room_media', ['storage_url', 'content_type', 'size_bytes', 'storage_backend']);
};
