# Change: Add file-based route discovery

## Why
Manual registration scales poorly for large APIs and increases duplication across protocols; a directory-based routing system improves modularity and keeps HTTP/JSON-RPC/WS/TCP aligned to the same canonical handler names.

## What Changes
- Add a route discovery loader that maps a directory tree to canonical handler names
- Define a minimal file export contract for procedure/stream/event handlers and metadata
- Integrate the loader with server mounting so discovered routes can be composed with prefixes

## Impact
- Affected specs: route-discovery
- Affected code: new route discovery module, server integration, tests and docs
