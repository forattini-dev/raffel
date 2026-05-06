# Co-located policies: channel sibling and folder _policy.yaml conventions [AFK]

GitHub: https://github.com/forattini-dev/raffel/issues/95

## Parent

#91

## What to build

Extend co-location to the channels (WebSocket) discovery tree. Two conventions:

- A sibling `<channel>.policy.{yaml,yml,json}` next to a channel definition covers connect/subscribe/publish for that single channel.
- A `_policy.{yaml,yml,json}` inside the channels tree cascades to every channel under it, mirroring the cascade rules established in #93.

The resolver treats channel actions (connect, subscribe, publish, plus any custom verbs the channel exposes) as the surface a channel-level policy file applies to.

End-to-end behaviour: drop a sibling or folder-cascade policy in the channels tree; clients that fail authorisation are rejected at the appropriate WebSocket lifecycle stage (connect or subscribe/publish), authorised clients are allowed through.

## Acceptance criteria

- [ ] Sibling `<channel>.policy.*` next to a discovered channel auto-attaches authorisation to that channel's connect/subscribe/publish actions.
- [ ] `_policy.*` placed in any folder under the channels tree cascades to every channel discovered below it, with nearest-wins precedence.
- [ ] Unauthorised connect, subscribe, and publish attempts are rejected at the documented WebSocket lifecycle stage; authorised attempts pass.
- [ ] Resolver tests cover sibling, folder cascade, mixed sibling+folder, and "no policy declared" cases for channels.
- [ ] Integration test stands up a server with a channels tree + co-located policies and asserts allow/deny end-to-end via real WebSocket clients.
- [ ] No regression: channels without co-located policies continue to behave exactly as before.

## Blocked by

- #93
