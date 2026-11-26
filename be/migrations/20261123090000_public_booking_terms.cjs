exports.up = (pgm) => {
  pgm.addColumns('tenant_public_catalog', {
    public_booking_terms: { type: 'text' },
    public_booking_terms_version: { type: 'bigint', notNull: true, default: 0 },
    public_booking_terms_updated_at: { type: 'timestamptz' }
  });
  pgm.addConstraint('tenant_public_catalog', 'ck_public_booking_terms',
    "CHECK (public_booking_terms IS NULL OR (length(trim(public_booking_terms)) > 0 AND length(public_booking_terms) <= 5000))");
};

exports.down = (pgm) => {
  pgm.dropConstraint('tenant_public_catalog', 'ck_public_booking_terms');
  pgm.dropColumns('tenant_public_catalog', ['public_booking_terms', 'public_booking_terms_version', 'public_booking_terms_updated_at']);
};
