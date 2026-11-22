# KaraokeNow Decision Log

This log separates confirmed implementation direction from product decisions that still require PO/BA approval. The Master Plan remains a planning baseline, not an approved requirements specification.

## Technical decisions in use

| ID | Decision | Status | Consequence |
|---|---|---|---|
| TD-001 | Node.js 24 LTS, TypeScript and NestJS modular monolith | Implemented baseline, approval pending | Keep modules deployable as one service; do not split microservices during MVP |
| TD-002 | PostgreSQL is the transactional source of truth | Implemented baseline, approval pending | Redis may accelerate TTL/read paths but cannot own booking correctness |
| TD-003 | SQL migrations use `node-pg-migrate` | Implemented baseline | Every schema change is reviewed and forward-migratable |
| TD-004 | Tenant ID must be explicit in every tenant-owned query | Implemented in venue and membership slices | Header selects context; JWT identity must have an active membership for that tenant |
| TD-005 | Local email/password login with signed JWT for the MVP foundation | Implemented baseline, security review pending | JWT identifies the user; active tenant membership and branch grants authorize each request |
| TD-006 | Branch and room deletion is represented by `INACTIVE` status | Implemented baseline | Preserves audit and future booking references; no physical delete API |

## Product decisions requiring approval

No default is implied by this table. Code must not hard-code these decisions before approval.

| ID | Decision needed | Blocks |
|---|---|---|
| PD-001 | Booking duration increments and minimum/maximum duration | Pricing and availability contract |
| PD-002 | Setup/cleanup buffer between sessions | Occupancy range calculation |
| PD-003 | Hold TTL by channel | Hold expiry behavior and UX |
| PD-004 | Fixed versus percentage deposit rules | Payment intent and confirmation |
| PD-005 | Whether and when no-deposit confirmation is allowed | Booking state transition authorization |
| PD-006 | Cancellation, partial refund, no-show and grace-period rules | Policy snapshot and refund workflow |
| PD-007 | Payment provider and merchant-of-record model | Provider adapter, reconciliation and compliance |
| PD-008 | Walk-in and cash-deposit treatment | Reception workflow and payment states |
| PD-009 | Marketplace commission eligibility and calculation | Immutable attribution and settlement |
| PD-010 | Customer identity matching and account requirements | Customer and consent model |

## Change control

Product decisions are approved only when the PO records the chosen option, effective date and affected stories here. A code merge alone is not approval of a business rule.

