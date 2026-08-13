# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's
private vulnerability reporting flow in the repository **Security** tab so the
maintainers can investigate and coordinate a fix before disclosure.

Include the affected version, deployment topology, reproduction steps, impact,
and any proof-of-concept material you can safely share. Do not access data that
is not yours, disrupt a service, or perform denial-of-service testing.

We will acknowledge a report as soon as practical, keep the reporter informed,
and coordinate disclosure after affected users have a reasonable upgrade path.

## Supported versions

Security fixes are made on the latest stable release. A short-lived hotfix line
may be maintained while a security-related major migration is in progress.
Users should run the most recent patch available for their selected major.

## Deployment baseline

- Bind listeners to loopback unless remote access is intentional.
- Put externally reachable endpoints behind TLS and authentication.
- Use explicit origin allowlists when enabling CORS.
- Keep proxy target filters enabled and deny private/link-local destinations.
- Rotate OAuth, OIDC, session, and API-key secrets after suspected exposure.
- Run `pnpm security:audit` and retain the CycloneDX SBOM from each release.

Stable tags are also gated by a ZAP baseline scan against the URL stored as
`DAST_TARGET_URL` in the protected `security-testing` GitHub environment. Keep
that target isolated, authorized for scanning, and representative of production.
