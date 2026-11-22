exports.up = (pgm) => {
  pgm.createTable('room_amenities', {
    id: { type: 'uuid', primaryKey: true },
    tenant_id: { type: 'uuid', notNull: true },
    branch_id: { type: 'uuid', notNull: true },
    room_id: { type: 'uuid', notNull: true },
    label: { type: 'varchar(80)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });
  pgm.addConstraint('room_amenities', 'fk_room_amenity_room_tenant', {
    foreignKeys: {
      columns: ['room_id', 'branch_id', 'tenant_id'],
      references: 'rooms(id, branch_id, tenant_id)',
      onDelete: 'RESTRICT'
    }
  });
  pgm.addConstraint('room_amenities', 'uq_room_amenity_label', { unique: ['room_id', 'label'] });
  pgm.addConstraint('room_amenities', 'ck_room_amenity_label', 'CHECK (length(trim(label)) > 0)');
  pgm.createIndex('room_amenities', ['tenant_id', 'room_id']);

  pgm.createTable('room_media', {
    id: { type: 'uuid', primaryKey: true },
    tenant_id: { type: 'uuid', notNull: true },
    branch_id: { type: 'uuid', notNull: true },
    room_id: { type: 'uuid', notNull: true },
    asset_ref: { type: 'varchar(500)', notNull: true },
    alt_text: { type: 'varchar(200)' },
    display_order: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });
  pgm.addConstraint('room_media', 'fk_room_media_room_tenant', {
    foreignKeys: {
      columns: ['room_id', 'branch_id', 'tenant_id'],
      references: 'rooms(id, branch_id, tenant_id)',
      onDelete: 'RESTRICT'
    }
  });
  pgm.addConstraint('room_media', 'ck_room_media_asset_ref',
    "CHECK (asset_ref ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$' AND asset_ref !~ '(^|/)\\.\\.(/|$)')");
  pgm.addConstraint('room_media', 'ck_room_media_display_order', 'CHECK (display_order >= 0)');
  pgm.createIndex('room_media', ['tenant_id', 'room_id', 'display_order']);
};

exports.down = (pgm) => {
  pgm.dropTable('room_media');
  pgm.dropTable('room_amenities');
};
