# ADR 0001 — Co-located policies

- **Status:** Accepted
- **Date:** 2026-05-06
- **Deciders:** Raffel maintainers
- **Tracks:** PRD #91 (slices #92–#97)

## Context

Authorization in Raffel is a first-class but opt-in concern. The pre-#91 model worked like this:

1. The user wrote one or more policy files in a flat directory (`./policies/*.yaml` / `*.json`) and pointed `policy.loadFromDir` at it.
2. The user added inline policies to `policy.policies` for anything that wasn't worth a file.
3. For *every* procedure that should be gated, the user added a builder call: `server.procedure('x').authz({ resource, action })`.

Three friction points emerged in real use:

- **Spatial separation.** A handler in `src/http/leads/get.ts` and the rule that protects it lived in `policies/leads.yaml`. Opening one to review the other meant grepping the codebase. Reviewers couldn't audit a folder by reading it; they had to chase rules across the tree.
- **Boilerplate per surface.** REST resources expose 5–9 operations from one file. The procedure-level `.authz()` model required either repeating the call per operation or hand-rolling a loop. Channels had no first-class authorization story at all — `_auth.ts` covered authentication but not principal-vs-action policy decisions.
- **Coverage anxiety.** `defaultMode: 'deny'` was the only safety net for "did I forget to gate this?", and it surfaced gaps as 403s in production rather than as a startup signal.

A class of users (multi-tenant SaaS, regulated workloads, anything with cross-cutting access rules) needed the policies to be *adjacent* to the code, *cascading* down the tree, and *auditable* at boot.

## Decision

Adopt convention-based **co-located policies**, mirroring Raffel's existing FS-discovery vocabulary (`_middleware`, `_auth`, `_meta`):

1. A `<handler>.policy.{yaml,yml,json}` next to a discovered handler (or REST/resource definition file) covers that operation.
2. A `_policy.{yaml,yml,json}` in any directory under the discovery tree applies to every handler at or below it. Cascade walks broader → closer.
3. Channels participate identically: `<channel>.policy.*` siblings and `_policy.*` cascades. The bridge enforces at subscribe time.
4. Policies gain an optional `scope` block (`protocols`/`routes`/`channels`, all glob arrays) for narrowing applicability without duplicating action/resource patterns.
5. The bootstrap exposes a `getCoverage()` method that produces a structured report of registered names that have no policy interceptor attached. The server surfaces it as `server.policyCoverage()`.
6. Centralised `policy.policies` and `policy.loadFromDir` are **not** removed — they remain the lowest-precedence baseline. Co-location is additive.

The convention is opt-in through `policy.coLocated`. The default is "on when FS discovery is on" so the common case requires zero configuration.

## Consequences

### Positive

- Audits are local. A reviewer reading `src/http/admin/` sees the handlers, the `_middleware.ts`, and the `_policy.yaml` together.
- The framework picks up new rules with zero builder code. Adding a CRUD resource means writing `users.ts` and `users.policy.yaml` — that's it.
- Cascading expresses "tenant isolation applies to everything under here" once, instead of repeated declarations.
- `scope.protocols` makes "this rule only matters over WebSocket" expressible without scattering inline checks across adapters.
- `server.policyCoverage()` turns the question "did we forget to gate something?" into a CI assertion.
- The convention is not Raffel-specific — it's recognisable to anyone who's seen Next.js conventions, Astro conventions, Pulumi component policies, etc.

### Negative

- **Convention surface.** Six file-name patterns (`<n>.policy.yaml`, `_policy.yaml`, ×3 extensions) is more to remember than "one directory of policies". Documentation and tooling have to compensate.
- **Discovery dependency.** Co-location only works for handlers/channels Raffel discovers from the FS. Programmatic registrations get the same precedence rules, but the cascading benefit doesn't apply to code-defined surfaces. Users mixing both styles need to remember which surface uses which mechanism.
- **Engine extension.** The bridge depends on `engine.addPolicies(policies)` being available. Custom engine drivers that build a frozen policy set at construction time must implement (or accept) `addPolicies`, or accept that co-located bridging silently no-ops for them.
- **Schema drift risk.** A policy file references a handler indirectly by living next to it; if the handler is renamed, the sibling file is silently orphaned. The coverage report flags the inverse (handler without policy) but not orphan policy files. We accept this trade-off; cascading and explicit ids make it manageable.

### Neutral / call-outs

- **TCP/UDP scope.** Connection-oriented adapters do not get co-located policy enforcement in this iteration. Their lifecycle (per-connection allow/deny rather than per-request action/resource) deserves its own model. Future work tracked outside #92–#97.
- **Hot reload.** The convention reuses Raffel's existing FS discovery hot-reload signal. Anyone running with `hotReload: true` gets policy reload for free; anyone running production builds without it explicitly opts in to "boot-time only".
- **Naming conflict with `match`.** The original PRD draft used `match.routes` / `match.channels`. The codebase already had a top-level `match` field for the JSON-friendly DSL. We renamed the new applicability filter to `scope` to avoid the collision and make the semantics clearer ("scope = where does this rule even consider running").

## Alternatives considered

**A. Keep the centralised `policy.policies` directory only.**
Rejected: the friction points above are real for non-trivial servers. A compromise between "everything centralised" and "everything co-located" doesn't actually exist — the moment any team has a folder of related handlers, they want the policy adjacent.

**B. Codegen baseline policies from resource schemas.**
Considered for a follow-up. Generating "owner can read/write, admin can do anything" boilerplate from a resource schema is useful, but it's strictly orthogonal to *where the file lives*. Co-location is the prerequisite; codegen on top is additive.

**C. Replace `policy.loadFromDir` entirely.**
Rejected: the centralised model is fine for cross-cutting rules ("tenant isolation applies regardless of where the handler lives") and we don't gain anything by deleting it. Co-location and `loadFromDir` compose: cascades give you proximity, the centralised dir gives you cross-cutting baselines.

**D. Use `match.routes`/`match.channels` instead of a new `scope` field.**
Rejected: `match` was already the name of the declarative DSL field. Overloading it would create confusion between "the filter that decides if a policy is applicable" and "the predicate that decides if a policy *matches*". `scope` reads cleanly: scope = applicability, match = predicate.

**E. Build the bridge entirely in user-land via a plugin.**
Rejected for ergonomics: every team would converge on the same plugin and get the same shape of bugs. Shipping the convention in core means the schema, validation, and coverage report can all share one implementation.

## Implementation notes

- The resolver is a deep, pure module: given a list of route descriptors and a list of policy file descriptors, it returns the ordered list of policies per route. It does no I/O. The loader composes the resolver with `DiscoverySource` reads.
- The bridge is two functions: `buildCoLocatedAuthzInterceptorsForName(name, policies, hook)` (used by procedure-style discovery and REST/resource registration) and a separate `ChannelCoLocatedPolicyEnforcer` callback (used by channels because they enforce at subscribe time, not via the procedure interceptor pipeline).
- Coverage tracking lives in the bootstrap. Every call to `interceptorFactory(name, ...)` records `name` in a `Set`. Every call with `config.public === true` adds to a `publicNames` set. The report is a `Set` diff against the registered names provided by the caller.

## References

- PRD: [#91 — Co-located policies for FS discovery](https://github.com/forattini-dev/raffel/issues/91)
- Slices: [#92](https://github.com/forattini-dev/raffel/issues/92) · [#93](https://github.com/forattini-dev/raffel/issues/93) · [#94](https://github.com/forattini-dev/raffel/issues/94) · [#95](https://github.com/forattini-dev/raffel/issues/95) · [#96](https://github.com/forattini-dev/raffel/issues/96) · [#97](https://github.com/forattini-dev/raffel/issues/97)
- Guide: [Co-located policies](../policies/co-located.md)
