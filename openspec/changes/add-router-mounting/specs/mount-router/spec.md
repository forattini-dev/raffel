## ADDED Requirements
### Requirement: Router module definition
The system SHALL provide a RouterModule object that registers procedures, streams, and events with relative names and module-level interceptors.

#### Scenario: Module registers relative routes
- **WHEN** a module is created with prefix `users` and registers a procedure named `create`
- **THEN** the effective handler name is `users.create`

### Requirement: Router module mounting
The system SHALL allow mounting a RouterModule at a server prefix and MUST compose prefixes across nested modules.

#### Scenario: Server mounts a module with a prefix
- **WHEN** the server mounts a module at prefix `admin` and the module registers `users.create`
- **THEN** the effective handler name is `admin.users.create`

### Requirement: Interceptor ordering for mounted modules
The system SHALL apply interceptors in deterministic order: global, mount, module, then handler-level interceptors.

#### Scenario: Handler executes with ordered interceptors
- **WHEN** a mounted module and its handler define interceptors
- **THEN** interceptors execute in the documented order for every invocation
