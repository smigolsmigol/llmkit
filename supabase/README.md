# LLMKit database

The [database guide](../docs/operations/database.md) owns local proof and the gated migration
procedure. Run its commands from the repository root. Production changes require separate approval.

Migrations remain in [migrations/](migrations/), tests in [tests/database/](tests/database/), and
historical recovery evidence in [recovery/](recovery/). Recovery snapshots are not migrations.
