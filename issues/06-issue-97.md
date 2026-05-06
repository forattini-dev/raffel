# Co-located policies: default-deny coverage report listing handlers without policy [AFK]

GitHub: https://github.com/forattini-dev/raffel/issues/97

## Parent

#91

## What to build

When the policy server config is set to `defaultMode: 'deny'`, surface a structured **coverage report** at server startup listing every discovered handler, resource, and channel that has *no* matching policy from any source (sibling, folder cascade, resource, channel, root `policiesDir`, or `match` patterns). The report is structured data (suitable for log aggregators and CI assertions) and includes the procedure name / channel name, the route or channel pattern, and the protocol kind.

Public-by-design entries are excluded from the report when they declare `public: true` in policy or via builder annotation, so the report is signal-rich rather than noisy.

End-to-end behaviour: spin up a server with `defaultMode: 'deny'` and a tree where one handler is missing a policy — the gap appears in the structured report; CI can pipe the report through a check that fails the pipeline.

## Acceptance criteria

- [ ] When `defaultMode: 'deny'` is configured, a structured coverage report is emitted at startup listing every handler/resource/channel with no matching policy from any source.
- [ ] Entries with `public: true` (in policy or builder) are excluded from the gap list.
- [ ] The report is machine-readable structured data (e.g. JSON-shaped log line or programmatic accessor on the server instance) — not just a human-formatted string.
- [ ] An integration test asserts: a tree with one gap produces a report with exactly that gap; a tree with no gaps produces an empty report.
- [ ] An integration test asserts: a public-marked handler does not appear in the gap list even when no policy targets it.
- [ ] When `defaultMode: 'allow'`, the coverage report is not emitted (or is opt-in via config), since gaps are not policy violations in that mode.
- [ ] Documentation in this issue's PR describes how to consume the report from CI and from runtime log aggregation.

## Blocked by

- #92
