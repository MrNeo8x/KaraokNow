/** Shared booking projection. Append `WHERE …` with `b.` aliases; map rows with `toBooking`. */
export const BOOKING_SELECT = `SELECT b.id,b.hold_id AS "holdId",b.branch_id AS "branchId",b.room_id AS "roomId",b.channel,b.start_at AS "startAt",
  b.duration_minutes AS "durationMinutes",b.buffer_minutes AS "bufferMinutes",upper(o.occupied_range) AS "reservedEndAt",
  b.customer_phone AS "customerPhone",b.customer_email AS "customerEmail",b.phone_verified_at AS "phoneVerifiedAt",b.phone_verified_by AS "phoneVerifiedBy",
  b.price_snapshot AS "priceSnapshot",b.cancellation_terms AS "cancellationTerms",b.confirmation_policy_snapshot AS "confirmationPolicySnapshot",
  b.status,b.confirmed_by AS "confirmedBy",b.confirmed_at AS "confirmedAt",
  b.checked_in_at AS "checkedInAt",b.checked_in_by AS "checkedInBy",b.checked_out_at AS "checkedOutAt",b.checked_out_by AS "checkedOutBy",
  b.late_minutes AS "lateMinutes",b.overtime_minutes AS "overtimeMinutes",b.overtime_grace_minutes AS "overtimeGraceMinutes",
  bo.outcome_type AS "outcomeType",bo.note AS "outcomeNote",bo.refund_amount_vnd::text AS "outcomeRefundAmountVnd",
  bo.recorded_by AS "outcomeRecordedBy",bo.recorded_at AS "outcomeRecordedAt"
  FROM bookings b JOIN room_occupancy o ON o.id=b.occupancy_id
  LEFT JOIN booking_outcomes bo ON bo.booking_id=b.id AND bo.tenant_id=b.tenant_id`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toBooking(row: Record<string, any> | undefined): Record<string, any> | undefined {
  if (!row) return row;
  const { outcomeType, outcomeNote, outcomeRefundAmountVnd, outcomeRecordedBy, outcomeRecordedAt, ...booking } = row;
  return {
    ...booking,
    outcome: outcomeType ? { type: outcomeType, note: outcomeNote, refundAmountVnd: outcomeRefundAmountVnd, recordedBy: outcomeRecordedBy, recordedAt: outcomeRecordedAt } : null
  };
}
