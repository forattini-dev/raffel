# Co-located policies: folder cascade via _policy.yaml with nearest-wins precedence [AFK]

GitHub: https://github.com/forattini-dev/raffel/issues/93

## Parent

#91

## What to build

Extend the policy descriptor resolver and co-located loader to support folder-level cascading via `_policy.{yaml,yml,json}` files. A `_policy.yaml` placed in any folder under the discovery tree applies to every handler in that folder and below; a closer ancestor wins over a more distant one; the root `policiesDir` remains the lowest-precedence baseline.

End-to-end behaviour: place `_policy.yaml` at a feature-folder root, every handler discovered under that folder inherits the rules; place a more specific `_policy.yaml` in a subfolder and it augments/overrides per the documented precedence; sibling files from #92 still win for their specific handler.

## Acceptance criteria

- [ ] A `_policy.yaml` (or `.yml` / `.json`) in any folder under the discovery tree is auto-detected and applied to every handler discovered under that folder.
- [ ] Cascading is recursive: nested folders inherit from all ancestors up to the discovery root.
- [ ] Documented precedence is enforced and tested: sibling co-located file → nearest ancestor `_policy.*` → broader ancestor `_policy.*` → root `policiesDir`.
- [ ] Resolver returns the ordered list of applicable descriptors per the precedence above; tested with table-driven fixtures covering siblings + nested cascades.
- [ ] An integration test demonstrates a baseline policy at folder level being overridden/augmented by a sibling policy at a single handler under that folder.
- [ ] No regression: sibling-only behaviour from #92 continues to work unchanged.

## Blocked by

- #92
