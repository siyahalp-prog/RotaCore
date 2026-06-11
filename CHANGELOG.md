# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Workflows:** Durable `WorkflowStore` for saving definitions and persisting run logs to PostgreSQL.
- **Workflows:** Explicit timeouts (`stepTimeoutMs`) for individual action steps.
- **Events:** `recoverStuck()` mechanism to reclaim events left in the processing state by dead workers.
- **Notifications:** Production-ready SMTP provider using `nodemailer`.
- **Database:** `MigrationRunner` class and `_rota_migrations` table for idempotent schema versioning.
- **Core:** Extracted `RateLimitError` for 429 response standardization.

### Changed
- **API:** Fastify app now delegates request rate-limiting logic through the standardized error handler.
- **API:** Wired `@rota-core/logger` into Fastify `onRequest`, `onResponse`, and `onError` hooks for full structured logging.
- **Analytics:** The tracking script and backend now strip query parameters containing PII from URLs before database insertion.

### Removed
- **Analytics:** Stopped persisting the raw `userAgent` string in the database to improve user privacy (now correctly extracting into distinct browser/device categories).

### Security
- **Workflows:** Implemented strict isolation between `event.payload` and `step.input` to prevent parameter injection attacks.
- **Database:** Eliminated fragile string-replace SQL mapping in `PostgresEventStore`, adopting parameterized `$N` statements exclusively.
