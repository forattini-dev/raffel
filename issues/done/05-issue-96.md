# Co-located policies: match.routes and match.channels patterns for scoped enforcement [AFK]

GitHub: https://github.com/forattini-dev/raffel/issues/96

## Parent

#91

## What to build

Add a `match` block to the policy YAML/JSON schema so a single policy file can scope itself to a route prefix or a channel-name pattern without depending on file location:

- `match.routes`: array of glob patterns matched against the procedure route (e.g. `/admin/*`, `/v1/leads/**`).
- `match.channels`: array of glob patterns matched against channel names (e.g. `chat.*`, `tenant-*`).

When `match` is present, the policy applies only to entries whose route or channel name matches at least one pattern. When `match` is absent, scope is determined purely by file location (the conventions from #92 / #93 / #94 / #95). Match-pattern policies accumulate as additional applicable rules alongside location-scoped policies — they do not replace them.

End-to-end behaviour: place a single `_policy.yaml` (in the root `policiesDir` or anywhere co-located) with `match.routes: ['/admin/*']`, hit any route under `/admin/*` — the policy is evaluated; routes outside the prefix are unaffected.

## Acceptance criteria

- [ ] Policy schema (YAML/JSON and the published JSON Schema for tooling validation) gains an optional `match` object with `routes?: string[]` and `channels?: string[]`.
- [ ] Glob semantics are documented: the pattern syntax used (e.g. `*` single segment, `**` multi-segment) and case sensitivity.
- [ ] Resolver tests are table-driven over `(pattern, route|channel)` pairs and cover positive matches, negative matches, multi-pattern files, and patterns that match nothing.
- [ ] Integration test demonstrates a single policy file scoping enforcement to `/admin/*` while leaving other routes untouched.
- [ ] Integration test demonstrates a single policy file scoping enforcement to a channel-name glob.
- [ ] When a policy file with `match` is loaded but matches zero discovered entries, a warning is emitted (or, in strict mode, the load fails) per the PRD's documented failure mode.
- [ ] No regression: location-scoped policies without `match` continue to behave per #92 / #93 / #94 / #95.

## Blocked by

- #92
