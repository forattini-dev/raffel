## ADDED Requirements
### Requirement: Directory-based route discovery
The system SHALL provide a loader that scans a directory tree and registers handlers using a deterministic path-to-namespace mapping.

#### Scenario: File path maps to handler name
- **WHEN** a route file exists at `routes/users/create.ts`
- **THEN** the canonical handler name is `users.create`

### Requirement: Route module contract
The system SHALL require each discovered route file to declare its handler kind and handler function in a standard export contract.

#### Scenario: Event handler file is discovered
- **WHEN** a route file declares kind `event`
- **THEN** the loader registers an event handler with its declared metadata

### Requirement: Duplicate handler detection
The system SHALL fail fast when two route files resolve to the same canonical handler name.

#### Scenario: Conflicting paths detected
- **WHEN** two route files resolve to `users.create`
- **THEN** discovery fails with a descriptive error before server start
