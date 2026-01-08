## ADDED Requirements
### Requirement: Delivery guarantee enforcement
The system SHALL execute event handlers according to their configured delivery guarantee.

#### Scenario: Best-effort event does not retry on failure
- **WHEN** an event is configured as best-effort and the handler throws
- **THEN** the system records the failure and does not retry

#### Scenario: At-least-once retries until ack
- **WHEN** an event is configured as at-least-once and the handler does not call ack
- **THEN** the system retries according to the retry policy until ack or max attempts

#### Scenario: At-least-once acknowledges completion
- **WHEN** a handler calls ack for an at-least-once event
- **THEN** the system stops retrying and marks the event delivered

### Requirement: Retry policy defaults
The system SHALL apply a default retry policy to at-least-once events when no retry policy is provided.

#### Scenario: Default retry policy applied
- **WHEN** an at-least-once event is registered without a retry policy
- **THEN** the system retries with maxAttempts=5, initialDelay=1000, maxDelay=60000, backoffMultiplier=2

### Requirement: At-most-once deduplication
The system SHALL suppress duplicate deliveries for at-most-once events within the deduplication window.

#### Scenario: Duplicate event id suppressed
- **WHEN** the same event id is received within the deduplication window
- **THEN** the handler is not invoked again

### Requirement: Pluggable delivery state
The system SHALL persist delivery state via a configurable store, with an in-memory default.

#### Scenario: Custom store used
- **WHEN** a custom event delivery store is provided
- **THEN** delivery state operations use the custom store
