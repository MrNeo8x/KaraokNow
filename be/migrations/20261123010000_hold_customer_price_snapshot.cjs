exports.up = (pgm) => {
  pgm.addColumns('booking_holds', {
    customer_phone: { type: 'varchar(16)' },
    customer_email: { type: 'varchar(254)' },
    price_snapshot: { type: 'jsonb' }
  });
  pgm.addConstraint('booking_holds', 'ck_hold_customer_price_together',
    'CHECK ((customer_phone IS NULL AND customer_email IS NULL AND price_snapshot IS NULL) OR (customer_phone IS NOT NULL AND price_snapshot IS NOT NULL))');
};
exports.down = (pgm) => {
  pgm.dropConstraint('booking_holds', 'ck_hold_customer_price_together');
  pgm.dropColumns('booking_holds', ['customer_phone', 'customer_email', 'price_snapshot']);
};
