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
| **Redis Session** | `ioredis` | `pnpm add ioredis` |
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
| `HOST` | Server bind address | `0.0.0.0` |
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

---

## Next Steps

- **[Quickstart](quickstart.md)** - Build your first multi-protocol server
- **[Core Model](core-model.md)** - Understand Envelope, Context, handlers
- **[HTTP Protocol](protocols/http.md)** - REST API configuration
