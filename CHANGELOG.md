# Changelog

## 0.8.5 — Shared Charges & Materializer Source Authority (Candidate)

### Added
- Native shared Item Uses pool with configurable maximum and recovery.
- Granted Spell and composed Activity resource modes: none/shared/separate.
- Per-resource configurable depletion behaviors: none, destroy, conditional roll (d20, ability, skill, tool).
- Runtime exhaustion hook with deduplicated positive-to-zero detection, Chat feedback, and owned Actor Item deletion on configured outcome.

### Corrected
- Priority-source authority for equivalent items, preventing merged representation across different source versions.
- Generic base compatibility via eligible `@UUID` references for enchantment templates.
- Preservation and ID remapping of dependent Rider Activity effects when materializing templates.

### Preserved
- Supplier v0.8.4 firearms filtering, Recipes and pricing, and existing consumable handling.

### Out of scope
- Source Manager UI overhaul; Published Item edit/save integrity bug.
