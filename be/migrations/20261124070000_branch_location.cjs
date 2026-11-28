exports.up = (pgm) => {
  // VEN-004 / PD-042: branch address, public contact phone and Google Maps location (coordinates from a pasted link).
  pgm.addColumns('branches', {
    address: { type: 'varchar(300)' },
    contact_phone: { type: 'varchar(20)' },
    latitude: { type: 'numeric(9,6)' },
    longitude: { type: 'numeric(9,6)' },
    maps_url: { type: 'varchar(500)' }
  });
  pgm.addConstraint('branches', 'ck_branch_location', `CHECK (
    (latitude IS NULL AND longitude IS NULL AND maps_url IS NULL)
    OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))`);
};

exports.down = (pgm) => {
  pgm.dropConstraint('branches', 'ck_branch_location');
  pgm.dropColumns('branches', ['address', 'contact_phone', 'latitude', 'longitude', 'maps_url']);
};
