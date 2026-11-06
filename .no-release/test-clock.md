# No release: freeze Date in tests

The server and client test setup now pin `Date` to `FIXED_NOW` before each
test, so fixture dates can't expire against the real clock. The change touches
only `tests/` and `docs/guides/testing.md`. App code, published packages and
migrations are unchanged.
