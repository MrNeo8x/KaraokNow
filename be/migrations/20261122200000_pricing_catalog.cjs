exports.up = (pgm) => {
  pgm.addConstraint('rooms', 'uq_room_id_tenant', { unique: ['id', 'tenant_id'] });

  pgm.createTable('price_plans', {
    id: { type: 'uuid', primaryKey: true },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'RESTRICT' },
    code: { type: 'varchar(50)', notNull: true },
    name: { type: 'varchar(200)', notNull: true },
    status: { type: 'varchar(20)', notNull: true, default: 'DRAFT' },
    effective_from: { type: 'date' },
    effective_to: { type: 'date' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    version: { type: 'bigint', notNull: true, default: 0 }
  });
  pgm.addConstraint('price_plans', 'uq_price_plan_id_tenant', { unique: ['id', 'tenant_id'] });
  pgm.addConstraint('price_plans', 'uq_price_plan_code_tenant', { unique: ['tenant_id', 'code'] });
  pgm.addConstraint('price_plans', 'ck_price_plan_status', "CHECK (status IN ('DRAFT','ACTIVE','INACTIVE'))");
  pgm.addConstraint('price_plans', 'ck_price_plan_dates',
    'CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_to >= effective_from)');

  pgm.createTable('special_dates', {
    id: { type: 'uuid', primaryKey: true },
    tenant_id: { type: 'uuid', notNull: true, references: 'tenants', onDelete: 'RESTRICT' },
    code: { type: 'varchar(50)', notNull: true },
    name: { type: 'varchar(200)', notNull: true },
    start_date: { type: 'date', notNull: true },
    end_date: { type: 'date', notNull: true },
    status: { type: 'varchar(20)', notNull: true, default: 'ACTIVE' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }
  });
  pgm.addConstraint('special_dates', 'uq_special_date_id_tenant', { unique: ['id', 'tenant_id'] });
  pgm.addConstraint('special_dates', 'uq_special_date_code_tenant', { unique: ['tenant_id', 'code'] });
  pgm.addConstraint('special_dates', 'ck_special_date_range', 'CHECK (end_date >= start_date)');
  pgm.addConstraint('special_dates', 'ck_special_date_status', "CHECK (status IN ('ACTIVE','INACTIVE'))");

  pgm.createTable('price_rules', {
    id: { type: 'uuid', primaryKey: true },
    tenant_id: { type: 'uuid', notNull: true },
    price_plan_id: { type: 'uuid', notNull: true },
    special_date_id: { type: 'uuid' },
    room_id: { type: 'uuid' },
    code: { type: 'varchar(50)', notNull: true },
    name: { type: 'varchar(200)', notNull: true },
    priority: { type: 'integer', notNull: true },
    weekdays: { type: 'smallint[]', notNull: true, default: pgm.func("'{}'::smallint[]") },
    start_time: { type: 'time' },
    end_time: { type: 'time' },
    min_duration_minutes: { type: 'integer' },
    max_duration_minutes: { type: 'integer' },
    amount_vnd: { type: 'bigint', notNull: true },
    status: { type: 'varchar(20)', notNull: true, default: 'ACTIVE' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    version: { type: 'bigint', notNull: true, default: 0 }
  });
  pgm.addConstraint('price_rules', 'uq_price_rule_code_plan', { unique: ['price_plan_id', 'code'] });
  pgm.addConstraint('price_rules', 'fk_price_rule_plan_tenant', {
    foreignKeys: { columns: ['price_plan_id', 'tenant_id'], references: 'price_plans(id, tenant_id)', onDelete: 'RESTRICT' }
  });
  pgm.addConstraint('price_rules', 'fk_price_rule_special_date_tenant', {
    foreignKeys: { columns: ['special_date_id', 'tenant_id'], references: 'special_dates(id, tenant_id)', onDelete: 'RESTRICT' }
  });
  pgm.addConstraint('price_rules', 'fk_price_rule_room_tenant', {
    foreignKeys: { columns: ['room_id', 'tenant_id'], references: 'rooms(id, tenant_id)', onDelete: 'RESTRICT' }
  });
  pgm.addConstraint('price_rules', 'ck_price_rule_weekdays',
    'CHECK (weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[])');
  pgm.addConstraint('price_rules', 'ck_price_rule_time_window',
    'CHECK ((start_time IS NULL AND end_time IS NULL) OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time <> start_time))');
  pgm.addConstraint('price_rules', 'ck_price_rule_duration',
    'CHECK ((min_duration_minutes IS NULL OR min_duration_minutes > 0) AND (max_duration_minutes IS NULL OR max_duration_minutes > 0) AND (min_duration_minutes IS NULL OR max_duration_minutes IS NULL OR max_duration_minutes >= min_duration_minutes))');
  pgm.addConstraint('price_rules', 'ck_price_rule_amount', 'CHECK (amount_vnd >= 0)');
  pgm.addConstraint('price_rules', 'ck_price_rule_status', "CHECK (status IN ('ACTIVE','INACTIVE'))");
  pgm.createIndex('price_plans', ['tenant_id', 'status', 'effective_from', 'effective_to']);
  pgm.createIndex('special_dates', ['tenant_id', 'start_date', 'end_date']);
  pgm.createIndex('price_rules', ['tenant_id', 'price_plan_id', 'status', 'priority']);
  pgm.createIndex('price_rules', ['tenant_id', 'room_id']);
};

exports.down = (pgm) => {
  pgm.dropTable('price_rules');
  pgm.dropTable('special_dates');
  pgm.dropTable('price_plans');
  pgm.dropConstraint('rooms', 'uq_room_id_tenant');
};
