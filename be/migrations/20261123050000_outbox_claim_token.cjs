exports.up = (pgm) => { pgm.addColumn('outbox_events', { claim_token: { type: 'uuid' } }); };
exports.down = (pgm) => { pgm.dropColumn('outbox_events', 'claim_token'); };
