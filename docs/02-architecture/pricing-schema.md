# Pricing schema foundation

The pricing migrations create tenant-scoped `price_plans`, `special_dates` and `price_rules` tables. Rules can be restricted to a room, a special-date range, weekdays, a time window and a duration range. A rule selects `PER_HOUR` or `PER_BOOKING` as its amount unit; older rows can have a null unit and are not quote-ready. Plans and rules carry status, timestamps and version fields where mutable configuration needs optimistic concurrency later. Weekday selectors use Sunday=0 through Saturday=6; room-type matching is absent because the current room model has no room-type attribute.

Merchant booking duration step/min/max is stored by tenant and can be read or updated by Owner/Branch Manager through the pricing settings API. Defaults are 30-minute steps, 60-minute minimum and 480-minute maximum. The write is audited. Buffer policy is managed separately with availability work.

## Rule precedence

`priority` is an explicit integer. A larger number wins. The selection helper accepts only rules already determined to match the booking inputs, chooses the unique highest priority and rejects a tie; it does not use insertion order or silently pick a winner. This implements PD-011.

## Deliberate boundary

`amount_vnd` is persisted as the rule's configured VND amount. `PER_HOUR` multiplies the configured integer VND amount by duration minutes and divides by 60; `PER_BOOKING` uses the configured amount once. Hourly fractional VND rounds half up to the nearest 1 VND using integer arithmetic. Under PD-023, rule selectors are evaluated once using the booking start's local date/time in the branch timezone; the selected unique highest-priority rule applies to the whole requested duration, even when the booking crosses selector boundaries. Weekdays use Sunday=0 through Saturday=6. Special-date matching uses the local start date, and time windows use a start-inclusive/end-exclusive check; overnight windows are supported. Special-date recurrence and room types are not implemented.

`POST /v1/merchant/rooms/{roomId}/quote` returns a versioned `priceSnapshot` contract. This response is deterministic for the same input and matching configuration. The quote is not persisted yet; the booking/hold workflow must copy the snapshot into the booking record before a booking can claim a durable immutable price.

The database enforces tenant consistency for plan/date references, valid date ranges, paired non-identical time endpoints, weekday values 0–6, positive duration bounds and non-negative amounts. Overnight time windows can be stored and are matched by the quote API. The schema intentionally allows equal priorities because only rules that both match a specific request are ambiguous; that condition is rejected by the selector.

Owner can create/list/read/update tenant price plans through `/v1/merchant/pricing/plans` and `/v1/merchant/pricing/plans/{id}`, special dates through `/v1/merchant/pricing/special-dates` and `/v1/merchant/pricing/special-dates/{id}`, and rules through `/v1/merchant/pricing/rules`, `/v1/merchant/pricing/rules/{id}` and `/v1/merchant/pricing/plans/{id}/rules`. Writes are transactional and audited. Updates replace the editable fields, including optional selectors; omitted optional fields clear those selectors. Rule amount uses a decimal string in VND, and code and plan association are immutable. Status controls applicability; physical deletion is not exposed.
