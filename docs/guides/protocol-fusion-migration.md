# Protocol Fusion Migration

This guide covers the public naming changes around Raffel's protocol-fusion
runtime model.

## Status In This Release

- `sharedPort` is the canonical transport-fusion option on `createServer(...)`
- `enableSharedPort()` is the canonical fluent builder method
- `singlePort` and `enableSinglePort()` still work as compatibility aliases
- `previewConfig().sharedPort` is the canonical preview surface
- `previewConfig().singlePort` is kept as a compatibility alias
- `server.getProtocolFusionState()` is the new runtime inspection API

No breaking change is required to adopt the new names in this release.

## Before / After

### Server options

```typescript
// Before
createServer({
  port: 3000,
  singlePort: {
    enabled: true,
    protocols: ['http', 'tcp'],
  },
})

// After
createServer({
  port: 3000,
  sharedPort: {
    enabled: true,
    protocols: ['http', 'tcp'],
  },
})
```

### Fluent builder

```typescript
// Before
createServer({ port: 3000 })
  .enableSinglePort({ enabled: true })

// After
createServer({ port: 3000 })
  .enableSharedPort({ enabled: true })
```

### Preview and diagnostics

```typescript
const server = createServer({
  port: 3000,
  sharedPort: { enabled: true, protocols: ['http'] },
  frontDoor: { enabled: true, protocols: ['http', 'jsonrpc'] },
})

const preview = server.previewConfig()
console.log(preview.protocolFusion.mode)
console.log(preview.sharedPort.enabled)

await server.start()
console.log(server.getProtocolFusionState())
```

## Deprecation Plan

- `sharedPort` replaces `singlePort` as the preferred public name immediately
- `singlePort` remains supported as an alias during the compatibility window
- `previewConfig().singlePort` remains readable during the same window
- a future major can remove the legacy names once docs, examples, and downstream
  usage have moved to `sharedPort`

## Operational Change

Blocked protocols now preserve the detected protocol in diagnostics when possible.

Examples:
- HTTP blocked by `sharedPort.protocols` reports `protocol: 'http'`
- text/binary TCP blocked by `sharedPort.protocols` reports `protocol: 'tcp'`
- front-door rejections include the request path and allowed protocol list
