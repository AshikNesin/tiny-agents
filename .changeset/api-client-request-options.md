---
"@groot/shell": minor
---

`apiClient` takes per-request options. Every verb accepts a trailing
`{ headers }`, and `apiClient.request(method, path, { params, body, headers,
emptyOk })` covers the rest: extra headers such as a step-up token or an
idempotency key, and `emptyOk` for an endpoint that may answer with no data
(as `delete` always allowed). Apps no longer need a second copy of the
client's 401 handling and `ApiError` parsing to send one header.
