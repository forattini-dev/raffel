# Change: Add router modules with mountable prefixes

## Why
Route registration is currently tied to a single server builder, which makes it hard to define modular route bundles and compose them with prefixes across protocols.

## What Changes
- Introduce a RouterModule API to register procedures/streams/events with relative names and module-level middleware
- Add server mounting for RouterModules with prefix composition and deterministic interceptor ordering
- Add tests and docs to cover module composition and prefix behavior

## Impact
- Affected specs: mount-router
- Affected code: src/server/builder.ts, new router module utilities, tests and docs
