## ADDED Requirements
### Requirement: gRPC adapter support
The system SHALL provide a gRPC adapter that translates gRPC calls into Raffel Envelopes and routes them through the core router.

#### Scenario: Unary request maps to procedure
- **WHEN** a gRPC unary call invokes `Service.Method`
- **THEN** the router receives a `request` envelope for `Service.Method` and returns the response payload

### Requirement: Streaming mappings
The system SHALL support server streaming, client streaming, and bidirectional streaming gRPC calls.

#### Scenario: Server streaming yields multiple payloads
- **WHEN** a gRPC server-streaming method is invoked
- **THEN** the adapter streams each `stream:data` payload to the client and completes on `stream:end`

### Requirement: Metadata and deadlines
The system SHALL map incoming gRPC metadata into Envelope.metadata and propagate deadlines and cancellations into Context.

#### Scenario: Client cancels a gRPC call
- **WHEN** the gRPC client cancels a call
- **THEN** the adapter aborts the handler Context signal

### Requirement: TLS configuration
The system SHALL allow configuring TLS credentials for the gRPC server.

#### Scenario: TLS credentials are provided
- **WHEN** the gRPC adapter starts with TLS credentials
- **THEN** it binds using secure server credentials
