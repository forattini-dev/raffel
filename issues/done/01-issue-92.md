# Co-located policies: sibling .policy.yaml for HTTP procedures (foundation) [AFK]

## Status: shipped (commit 7394146 — full suite green, 2942/2942)

### Slice landed
- Pure resolver `src/middleware/policy/co-located/resolver.ts` (extension-pair
  matching by handler base path, kind discriminator for future cascades).
- Async loader `src/middleware/policy/co-located/loader.ts` (YAML/JSON,
  single-doc + array, AJV schema reuse, `customCondition` registry).
- Engine extension: optional `addPolicies(readonly Policy[])` on
  `PolicyEnginePort`; default driver implements with id-based dedup.
- Discovery bridge: `loadDiscovery` attaches `coLocatedPolicies` per route;
  `registerDiscoveredHandlers` injects synthesised authz interceptor and
  feeds policies to engine. Programmatically-registered names take
  precedence (registry.has-then-skip).
- Server config: `policy.coLocated?: boolean` (defaults true when bootstrap
  exists; opt-out wins).
- Tracer-bullet integration tests at `test/policy/co-located/sibling.int.test.ts`
  cover yaml, json, explicit-wins, opt-out, loadFromDir-regression.
- Resolver unit tests at `test/policy/co-located/resolver.unit.test.ts`
  (table-driven base-key, candidate, pairing).

### Blockers / next iteration
- Test fixtures used `resources: ['*']` — engine glob is segment-bounded
  so `*` cannot match the synthetic `*:*` placeholder tag. Fixture corrected
  to `resources: ['**']`; documented in `docs/policies/co-located.md` so
  authors don't trip on the same convention.
- `engine.list()` now returns `Object.freeze([...policies])` (snapshot)
  to keep the existing frozen contract while `addPolicies()` mutates the
  internal array.
- Slice 2 (#93) extends the resolver with folder cascade `_policy.yaml`;
  the descriptor shape (`PolicyFileKind`, `PolicySource`) was designed so
  cascading consumes the same structure with new `kind` values.
- `resolveDir` now treats absolute discovery dirs as-is — minor side fix
  that lets the new integration tests use temp dirs without `baseDir`.



GitHub: https://github.com/forattini-dev/raffel/issues/92

## Parent

#91

## What to build

Implement the foundation of policy co-location: a sibling `<file>.policy.yaml` (or `.yml` / `.json`) next to a discovered HTTP procedure is auto-loaded and bound to that procedure. This slice introduces the **policy descriptor resolver** as a deep, pure module, the **co-located policy loader** for the sibling case, and the **FS discovery → policy bridge** that synthesises the equivalent `.authz(...)` binding so authors don't write builder glue.

End-to-end behaviour: drop a procedure file under the discovered HTTP directory, drop a sibling policy file, hit the route — unauthorised callers are denied by the engine; authorised callers pass. Explicit `.authz(...)` on a builder always wins over a discovered policy for the same procedure.

## Acceptance criteria

- [ ] A sibling policy file (`.yaml`, `.yml`, or `.json`) is auto-detected next to a discovered HTTP procedure and applied without any builder-side `.authz(...)` call.
- [ ] The resolver is a pure module with no I/O: given a discovery descriptor and a virtual tree, it returns an ordered list of policy descriptors and is unit-tested with table-driven fixtures.
- [ ] An unauthenticated/unauthorised request to a co-located-protected procedure is rejected by the policy engine with the documented status; an authorised request passes.
- [ ] An explicit `.authz(...)` call on the builder takes precedence over a co-located policy for the same procedure (verified by integration test).
- [ ] Both YAML and JSON policy files load successfully; a single-policy and an array-of-policies document shape are both accepted.
- [ ] Co-located discovery is opt-in for projects without FS discovery, and opt-in by default when FS discovery is enabled (overridable via the policy server config).
- [ ] No regression for existing root `policiesDir` behaviour: existing policy projects keep working unchanged.
- [ ] Integration test fixture mirrors a realistic discovery layout (temp dir with one procedure + one sibling policy file) and exercises the full bridge.

## Blocked by

None - can start immediately
