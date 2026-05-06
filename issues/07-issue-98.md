# Co-located policies: ADR and documentation update consolidating the convention [HITL]

GitHub: https://github.com/forattini-dev/raffel/issues/98

## Parent

#91

## What to build

Consolidate the policy co-location convention in an ADR and update the documentation site:

- A new ADR records the decision to extend (rather than replace) the existing root `policiesDir`, the precedence chain, the `match` pattern semantics, and the rationale for using the `_policy.*` / `<name>.policy.*` naming consistent with `_middleware`, `_auth`, `_meta`.
- The docs site gains a "Co-located policies" guide walking through the conventions for HTTP, REST, resources, and channels, with concrete fixture-style examples; the existing policies docs link to it.
- The OpenAPI/USD export advertises which policies cover each route, so consumers of generated docs can see what authorisation is enforced.
- Onboarding/getting-started material is updated to position FS discovery + co-located policies as the recommended default for non-trivial servers.

This slice is HITL because it formalises a public framework convention and shapes how new users are guided onto Raffel.

## Acceptance criteria

- [ ] ADR is added under `docs/adr/` covering: precedence chain, cascading semantics, `match` pattern semantics, file naming convention rationale, and the explicit-`.authz()`-wins rule.
- [ ] A "Co-located policies" guide is added under `docs/policies/` (or equivalent) with examples for HTTP, REST resources, resources tree, and channels.
- [ ] The OpenAPI/USD export annotates each route with the policy file(s) that cover it (or a link / identifier consumers can resolve).
- [ ] Existing policies documentation links to the new guide; the migration story from a flat `./policies/` directory to co-located layout is documented.
- [ ] Onboarding / getting-started docs (or equivalent landing material) call out FS discovery + co-located policies as the recommended default.
- [ ] A human review pass is requested before merging — this slice is HITL.

## Blocked by

- #92
- #93
- #94
- #95
- #96
- #97
