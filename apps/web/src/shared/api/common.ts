/**
 * The wire types every API area shares (README §4.5: the wire types live
 * once, in `shared/api/<area>.ts`). Each area's module declares what its
 * routes return and what the client sends; the server's handlers are typed
 * with them and `client/lib/*-api.ts` reads them, so a server change that
 * breaks the client fails the typecheck. Types only: both the server and
 * the browser bundle import these modules, so nothing here may import a
 * server module.
 *
 * Naming: a `…Data` type is what a handler hands to `ok()`, dates as
 * `Date`; the plain name is what the client receives, `Jsonified` (dates as
 * ISO strings). A shape without dates has one name for both.
 */

/** A delete that answers `{ deleted: true }`. */
export interface Deleted {
  deleted: true;
}
