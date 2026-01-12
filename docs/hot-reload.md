# Hot Reload

Raffel can watch discovery directories and reload handlers automatically during development.

---

## Enable Hot Reload

```typescript
import { createServer } from 'raffel'

const server = createServer({
  port: 3000,
  discovery: true,
  hotReload: true,
})

await server.start()
```

When a file changes under `src/http`, `src/rpc`, `src/streams`, `src/rest`, etc.,
Raffel reloads handlers without restarting the process.

---

## Manual Reload

```typescript
await server.discoveryWatcher?.reload()
```

---

## Custom Watcher

```typescript
import { createDiscoveryWatcher } from 'raffel'

const watcher = createDiscoveryWatcher({
  discovery: true,
  hotReload: true,
  debounceMs: 200,
  onReload: (result) => {
    console.log('Reloaded', result.stats)
  },
})

await watcher.start()
```
