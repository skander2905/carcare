# CarCare — API Design

Interactive documentation is generated from the code and served at
`/api/docs` whenever `SWAGGER_ENABLED` is on (forced off in production).

## 1. Conventions

| Aspect        | Convention                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Base URL      | `/api/v1`                                                                                                                        |
| Versioning    | URI (`/api/v1/...`), `defaultVersion: 1`                                                                                         |
| Health probes | `/health`, `/health/live`, `/health/ready` — **outside** the prefix and version-neutral, so monitoring never breaks on a release |
| Format        | JSON only                                                                                                                        |
| Auth          | `Authorization: Bearer <access token>`; refresh travels in an `httpOnly` cookie                                                  |
| Casing        | `camelCase` in payloads                                                                                                          |
| Dates         | ISO-8601 with offset (`2026-09-13T09:24:11.482Z`)                                                                                |
| Money         | Decimal **string** (`"321.750"`), never a float — JSON numbers lose precision                                                    |
| Correlation   | `X-Request-Id` echoed on every response and present in the error envelope                                                        |

### Status codes

`200` read/update · `201` created · `204` deleted · `400` validation ·
`401` missing or expired access token · `403` authenticated but not permitted ·
`404` absent **or not yours** · `409` conflict · `422` semantically invalid ·
`429` rate limited · `500` unexpected.

`404` rather than `403` for another user's resource is deliberate: a `403`
confirms the id exists, which leaks information to anyone probing for it.

## 2. Error envelope

Every failure — validation, authorisation, or a bug — leaves through one filter
and looks the same:

```json
{
  "statusCode": 400,
  "message": "Odometer cannot be lower than the previous reading",
  "error": "BadRequest",
  "details": ["odometerKm must not be less than 120000"],
  "path": "/api/v1/vehicles/8f1.../fuel",
  "timestamp": "2026-09-13T09:24:11.482Z",
  "requestId": "0f9c3a5e-6f1b-4a2f-9a9a-2d1b0f4c77e1"
}
```

`error` is derived from the status code, never from the thrown exception, so it
is a stable identifier clients can branch on. `details` appears only for
field-level validation failures. In production an unexpected exception yields a
generic message plus the request id — the real message and stack stay in the
logs.

## 3. Authentication flow

```
POST /auth/register ──► 201 { user, accessToken }  + Set-Cookie: refresh (httpOnly)
POST /auth/login    ──► 200 { user, accessToken }  + Set-Cookie: refresh (httpOnly)
POST /auth/refresh  ──► 200 { accessToken }        + Set-Cookie: rotated refresh
POST /auth/logout   ──► 204                         + Set-Cookie: cleared
GET  /auth/me       ──► 200 { user }
```

The access token is returned in the body and held **in memory** by the client;
it is never written to `localStorage`. The refresh token only ever exists as an
`httpOnly` cookie, so no JavaScript — including injected script — can read it.

On boot the web app calls `/auth/refresh` once to recover a session.
Rotation and replay detection are described in
[decisions.md ADR-005](./decisions.md).

`/auth/login`, `/auth/register` and `/auth/refresh` are rate limited per IP and
per account.

## 4. Endpoints

Vehicle-scoped collections are nested; individual records are addressed
top-level, because an id is already unique and nesting adds nothing.

### Auth & profile

```
POST   /auth/register
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
GET    /auth/me
GET    /users/me
PATCH  /users/me
```

### Federated sign-in

```
GET    /auth/providers                     -> providers this deployment configured
GET    /auth/oauth/:provider               -> 302 to the provider
GET    /auth/oauth/:provider/callback      -> 302 into the web app + refresh cookie
GET    /auth/oauth/:provider/link          -> authorization URL (authenticated)
GET    /auth/oauth                         -> providers linked to this account
DELETE /auth/oauth/:provider               -> 204, refused if it is the last credential
```

The callback is a browser redirect, so failures come back as
`?error=<code>` on the login page rather than as the JSON envelope —
`oauth_state`, `oauth_email_taken`, `oauth_already_linked`, `oauth_failed`.
No access token ever travels in a URL: the callback sets the refresh cookie and
the web app calls `/auth/refresh`, exactly as it does on any cold load.
Rationale in [decisions.md ADR-017](./decisions.md).

### Vehicles

```
GET    /vehicles
POST   /vehicles
GET    /vehicles/:id
PATCH  /vehicles/:id
DELETE /vehicles/:id
GET    /vehicles/:id/odometer
POST   /vehicles/:id/odometer
```

### Costs

```
GET    /vehicles/:id/expenses          ?category=&from=&to=&search=&page=&limit=&sort=
POST   /vehicles/:id/expenses
GET    /expenses/:id
PATCH  /expenses/:id
DELETE /expenses/:id

GET    /vehicles/:id/fuel              ?from=&to=&fuelType=&station=&page=&limit=
POST   /vehicles/:id/fuel
PATCH  /fuel/:id
DELETE /fuel/:id

GET    /vehicles/:id/maintenance       ?type=&from=&to=&provider=&page=&limit=
POST   /vehicles/:id/maintenance
PATCH  /maintenance/:id
DELETE /maintenance/:id

GET    /vehicles/:id/maintenance-schedules
POST   /vehicles/:id/maintenance-schedules
PATCH  /maintenance-schedules/:id
DELETE /maintenance-schedules/:id
```

### Reminders, documents, trips

```
GET    /vehicles/:id/reminders         ?status=&dueBefore=
POST   /vehicles/:id/reminders
PATCH  /reminders/:id
DELETE /reminders/:id

GET    /vehicles/:id/documents         ?type=&expiringBefore=
POST   /vehicles/:id/documents/upload-url     -> presigned PUT + document id
POST   /documents/:id/confirm                 -> PENDING_UPLOAD -> READY
GET    /documents/:id/download-url             -> presigned GET, short-lived
DELETE /documents/:id

GET    /vehicles/:id/trips             ?from=&to=&purpose=&page=&limit=
POST   /vehicles/:id/trips
PATCH  /trips/:id
DELETE /trips/:id
```

### Analytics & notifications

```
GET    /vehicles/:id/analytics/summary          ?from=&to=
GET    /vehicles/:id/analytics/monthly          ?from=&to=
GET    /vehicles/:id/analytics/by-category      ?from=&to=
GET    /vehicles/:id/analytics/consumption      ?from=&to=
GET    /vehicles/:id/analytics/cost-per-km      ?from=&to=
GET    /vehicles/:id/analytics/ownership        -> total cost of ownership

GET    /notifications                  ?unreadOnly=&page=&limit=
PATCH  /notifications/:id/read
POST   /notifications/read-all
```

## 5. Pagination

Offset pagination, because the UI needs page numbers and jumping to a page:

```
GET /vehicles/:id/expenses?page=2&limit=25
```

```json
{
  "data": [ ... ],
  "meta": { "page": 2, "limit": 25, "total": 213, "totalPages": 9, "hasNext": true }
}
```

`limit` is capped server-side (default 25, max 100) so a client cannot ask for
everything. Where a list is purely chronological and could grow without bound,
cursor pagination is the better fit and is noted as a future change — offset
pagination degrades on deep pages because the database still walks the skipped
rows.

## 6. Filtering, sorting, searching

Filters are explicit query parameters with validated DTOs — never a
pass-through query object, which would hand the caller arbitrary access to the
data model.

- **Ranges:** `from` / `to` (inclusive), applied to the record's own date.
- **Enums:** validated against the enum; an unknown value is a `400`, not an
  empty result, because silently returning nothing hides client bugs.
- **Sorting:** `sort=incurredAt:desc`, restricted to an allow-list of columns.
- **Search:** case-insensitive match on description and vendor.

## 7. Validation

`ValidationPipe` runs globally with `whitelist` and `forbidNonWhitelisted`:
unknown properties are stripped _and_ rejected. A client posting
`{ "amount": 10, "role": "ADMIN" }` gets a `400` rather than a silent drop —
mass-assignment fails loudly instead of quietly.

Domain rules live in services, not DTOs. "Odometer cannot be lower than the
previous reading" needs the database, so it is a service-level check that
returns a `400` with an actionable message.

## 8. Idempotency

`POST` is not idempotent by default. Endpoints where a double submit is
plausible and harmful (creating an expense from a slow mobile connection) accept
an `Idempotency-Key` header; the key is stored with the created resource id and
a repeat returns the original result rather than creating a duplicate.
