exports.up = (pgm) => {
  pgm.addColumns('booking_holds', {
    phone_verified_at: { type: 'timestamptz' },
    phone_verified_by: { type: 'uuid', references: 'users', onDelete: 'RESTRICT' }
  });
  pgm.addConstraint('booking_holds', 'ck_hold_phone_verification',
    'CHECK ((phone_verified_at IS NULL AND phone_verified_by IS NULL) OR (phone_verified_at IS NOT NULL AND phone_verified_by IS NOT NULL AND customer_phone IS NOT NULL))');
};
exports.down = (pgm) => {
  pgm.dropConstraint('booking_holds', 'ck_hold_phone_verification');
  pgm.dropColumns('booking_holds', ['phone_verified_at', 'phone_verified_by']);
};
