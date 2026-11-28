import test from 'node:test';
import assert from 'node:assert/strict';
import { exemptionPayload, exemptionText, toForm } from '../src/lib/deposit-exemption.ts';
import { confirmationMode } from '../src/lib/booking-lifecycle.ts';

const base = { maxAmount: '', windows: [], regularMin: '', lookback: '90', waiverRoles: ['BRANCH_MANAGER'] };

test('labels exemption reasons in Vietnamese', () => {
  assert.equal(exemptionText(['AMOUNT', 'OFF_PEAK']), 'Được miễn cọc: giá trị nhỏ, giờ vắng');
  assert.equal(exemptionText([]), ''); assert.equal(exemptionText(null), '');
});

test('policy payload: empty cases are off and Owner always may waive', () => {
  assert.deepEqual(exemptionPayload(base), { payload: { maxAmountVnd: null, offPeakWindows: [], regularMinCompleted: null, regularLookbackDays: 90, waiverRoles: ['OWNER', 'BRANCH_MANAGER'] } });
  const full = exemptionPayload({ ...base, maxAmount: '300.000', regularMin: '3', windows: [{ weekdays: [3, 1, 3], from: '10:00', to: '17:00' }] });
  assert.equal(full.payload.maxAmountVnd, '300000'); assert.equal(full.payload.regularMinCompleted, 3); assert.deepEqual(full.payload.offPeakWindows[0].weekdays, [1, 3]);
});

test('policy payload mirrors backend limits', () => {
  assert.match(exemptionPayload({ ...base, maxAmount: '-5' }).error, /Ngưỡng tiền/);
  assert.match(exemptionPayload({ ...base, windows: [{ weekdays: [], from: '10:00', to: '12:00' }] }).error, /ít nhất một ngày/);
  assert.match(exemptionPayload({ ...base, windows: [{ weekdays: [1], from: '22:00', to: '02:00' }] }).error, /không qua nửa đêm/);
  assert.match(exemptionPayload({ ...base, regularMin: '0' }).error, /1–100/);
  assert.match(exemptionPayload({ ...base, lookback: '5' }).error, /7–730/);
  assert.deepEqual(toForm({ configured: true, maxAmountVnd: null, offPeakWindows: [], regularMinCompleted: 2, regularLookbackDays: 30, waiverRoles: ['OWNER'], version: '1' }), { maxAmount: '', windows: [], regularMin: '2', lookback: '30', waiverRoles: ['OWNER'] });
});

test('confirmation mode: exemption unlocks a missing deposit or a channel without no-deposit', () => {
  assert.equal(confirmationMode({ mode: 'PERCENT' }, false), 'DEPOSIT_MISSING');
  assert.equal(confirmationMode({ mode: 'PERCENT' }, false, true), 'EXEMPT');
  assert.equal(confirmationMode({ mode: 'PERCENT' }, true, true), 'DEPOSIT_COVERED');
  assert.equal(confirmationMode({ mode: 'NONE' }, true, true), 'EXEMPT');
  assert.equal(confirmationMode({ mode: 'NONE' }, true), 'NO_DEPOSIT');
  assert.equal(confirmationMode(null, false, true), 'NO_SNAPSHOT');
});
