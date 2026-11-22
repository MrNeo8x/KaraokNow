# API Error and Correlation Contract

Every HTTP response includes `X-Correlation-ID`. A caller-supplied ID is retained only when it contains 1–128 safe alphanumeric/`._-` characters; otherwise the server generates a UUID.

Errors use this envelope:

```json
{
  "timestamp": "2026-11-22T00:00:00.000Z",
  "path": "/v1/merchant/branches",
  "correlationId": "request-id",
  "error": {
    "code": "BAD_REQUEST",
    "message": "name is required",
    "details": ["name is required", "code is invalid"]
  }
}
```

`details` is present only for multiple safe client-facing validation messages. Unexpected server errors always return `INTERNAL_ERROR` and never expose exception messages, SQL, stack traces or secrets.

Structured request logs contain only timestamp, level, event, correlation ID, method, path without query string, status, duration and—after authentication—user and tenant IDs. Request bodies, query parameters, Authorization headers, JWTs and passwords are never logged.
