# Authentication Lifecycle

## Tokens and sessions

- Access token: signed JWT, 15-minute lifetime, contains user ID and server-side session ID.
- Refresh token: opaque 384-bit random value, 30-day lifetime; only its SHA-256 hash is stored.
- Every authenticated request verifies that the referenced PostgreSQL session is active, unexpired and belongs to an active user.
- Refresh rotates both tokens. Reuse of an already-rotated refresh token revokes the entire token family.
- Logout and session revocation invalidate the database session, so associated access tokens stop working immediately.

## Passwords

- Passwords are stored with bcrypt, cost 12 for application-created or changed passwords.
- Staff accounts created with a temporary password have `must_change_password=true`.
- Until the password is changed, only password change and session-management endpoints are allowed.
- Password change revokes every refresh/access session for that user.

Password-reset storage supports hashed, expiring, single-use tokens, but reset-token delivery is not exposed yet. It remains blocked on an approved notification delivery adapter. Reset secrets must never be returned by production APIs or written to logs.

## Brute-force protection

Failed login counters and lockout state are stored in PostgreSQL, so limits apply across application instances. Five failures in a rolling 15-minute window lock the normalized email for 15 minutes. Responses do not reveal whether an account exists. Security events record success, failure, lockout, refresh reuse and password changes without storing raw passwords or tokens.

