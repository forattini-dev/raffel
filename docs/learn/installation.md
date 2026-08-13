# Installation

Get Raffel up and running in your project.

---

## Requirements

- **Node.js**: 18.0.0 or higher
- **TypeScript**: 5.0+ (recommended)
- **Package Manager**: pnpm, npm, yarn, or bun

---

## Package Installation

<!-- tabs:start -->

#### **pnpm (Recommended)**

```bash
pnpm add raffel
```

#### **npm**

```bash
npm install raffel
```

#### **yarn**

```bash
yarn add raffel
```

#### **bun**

```bash
bun add raffel
```

<!-- tabs:end -->

---

## Peer Dependencies

Raffel has optional peer dependencies based on features you use:

| Feature | Package | Install Command |
|:--------|:--------|:----------------|
| **Zod Validation** | `zod` | `pnpm add zod` |
| **Yup Validation** | `yup` | `pnpm add yup` |
| **Joi Validation** | `joi` | `pnpm add joi` |
| **gRPC** | `@grpc/grpc-js` | `pnpm add @grpc/grpc-js` |
| **Redis Session** | `redis` or compatible client | `pnpm add redis` |
| **Prometheus** | `prom-client` | `pnpm add prom-client` |
| **OpenTelemetry** | `@opentelemetry/api` | `pnpm add @opentelemetry/api` |

---

## TypeScript Configuration

Raffel is written in TypeScript and provides full type definitions. Recommended `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "./dist"
  },
  "include": ["src/**/*"]
}
```

---

## Quick Verification

Create a simple test file to verify installation:

```typescript
// test.ts
import { createServer } from 'raffel'

const server = createServer({ port: 3000 })

server
  .procedure('ping')
  .handler(async () => ({ pong: Date.now() }))

server.start().then(() => {
  console.log('Raffel is working!')
})
```

Run it:

```bash
npx tsx test.ts
# or
pnpm dlx tsx test.ts
```

Test the endpoint:

```bash
curl -X POST http://localhost:3000/ping
# {"pong":1704067200000}
```

---

## Project Structure

Recommended project structure for a Raffel application:

```
my-app/
├── src/
│   ├── index.ts           # Server entry point
│   ├── http/              # HTTP handlers (file-based routing)
│   │   └── users/
│   │       ├── get.ts
│   │       └── create.ts
│   ├── streams/           # Streaming handlers
│   │   └── logs/
│   │       └── tail.ts
│   ├── channels/          # WebSocket channels
│   │   └── chat.ts
│   └── middleware/        # Custom interceptors
│       └── custom-auth.ts
├── package.json
└── tsconfig.json
```

---

## Environment Variables

Raffel respects these environment variables:

| Variable | Description | Default |
|:---------|:------------|:--------|
| `PORT` | HTTP server port | `3000` |
| `HOST` | Server bind address | `127.0.0.1` |
| `NODE_ENV` | Environment (development/production) | `development` |
| `LOG_LEVEL` | Logging verbosity | `info` |

---

## Docker

Example `Dockerfile` for production:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

## Build of single executable (SEA)

To ship a standalone CLI binary with Node's SEA (Single Executable Applications), run:

```bash
pnpm run sea
```

This command does:

1. `pnpm run build`
2. generates SEA blob with `scripts/sea.config.json`
3. injects the blob into a copied Node executable (same toolchain used by your current `node`)
4. creates:
   - `dist/sea/raffel` on Linux/macOS
   - `dist/sea/raffel.exe` on Windows

Prerequisite:

```bash
pnpm add -D @vercel/postject
```

Usage examples:

```bash
./dist/sea/raffel inspect src/server.ts
# or on Windows
dist\\sea\\raffel.exe inspect src/server.ts
```

Notes:

- SEA generation needs Node 20+.
- The binary contains the current CLI entrypoint (`dist/mcp/cli.js`).
- The generated binary is not a full redistribution for every environment; run on a compatible OS/arch and test with your deployment target before shipping.

---

## Next Steps

- **[Quickstart](/learn/quickstart.md)** - Build your first multi-protocol server
- **[Core Model](/reference/core-model.md)** - Understand Envelope, Context, handlers
- **[HTTP Protocol](/protocols/http.md)** - REST API configuration
