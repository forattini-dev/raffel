# HTTP Adapter

Raffel exposes procedures, streams, and events over HTTP with a REST-like mapping.

## Endpoints

- Procedures: `POST /procedure.name`
- Streams: `GET /streams/procedure.name` (Server-Sent Events)
- Events: `POST /events/event.name`

`basePath` can prefix everything (example: `/api`).

## Procedure example

```bash
curl -X POST http://localhost:3000/users.create \
  -H 'content-type: application/json' \
  -d '{"name":"Maya"}'
```

## Stream example

```bash
curl -N http://localhost:3000/streams/logs.tail?limit=10
```

The response uses SSE events: `data`, `end`, `error`.

## Event example

```bash
curl -X POST http://localhost:3000/events/audit.write \
  -H 'content-type: application/json' \
  -d '{"action":"login"}'
```

## Metadata

HTTP headers are mapped into `metadata` for the Envelope. Headers starting with
`x-` and the `authorization` header are included.
