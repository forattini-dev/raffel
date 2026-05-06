# Co-located policies: resource-level _policy.yaml covering full CRUD surface [AFK]

GitHub: https://github.com/forattini-dev/raffel/issues/94

## Parent

#91

## What to build

Recognise resource-level policy co-location: a `_policy.{yaml,yml,json}` file inside a discovered resource folder covers every CRUD operation (list/get/create/update/patch/delete and any custom action) for that resource with a single file. The resolver treats the resource's operations as an aggregate surface so authors don't repeat per-operation files for shared rules.

End-to-end behaviour: drop `_policy.yaml` inside a resource folder, every CRUD operation auto-attaches the policy and is gated by the engine accordingly. Per-operation sibling policies (from #92) and folder cascading (from #93) continue to compose with the resource-level rule per documented precedence.

## Acceptance criteria

- [ ] A `_policy.yaml` placed inside a resource folder applies to every operation that resource exposes.
- [ ] Per-operation sibling policy files inside the resource folder still take precedence over the resource-level `_policy.*` for that operation.
- [ ] Resource-level rules participate in the same precedence chain as ordinary folder cascades; documented and tested.
- [ ] Integration test: temp tree with a resource folder + `_policy.yaml`, request each operation with and without a valid principal and assert allow/deny matches the policy.
- [ ] No regression: resources without a co-located policy continue to behave exactly as before.

## Blocked by

- #93
