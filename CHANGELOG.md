# Changelog

## 0.8.5.1 — Description Generator Polish

### Added
- Unified generated description layout for weapons, equipment, and tools.
- Dedicated **Charges & Recharge** section with pool summary and depletion rule text.
- Dedicated **Granted Spellcasting** section with per-spell charge cost / use summary.
- Dedicated **Magical Properties** and **Level Progression** sections in a consistent visual format.

### Improved
- Generated item descriptions now favor a single coherent rules presentation instead of separate fragmented blocks.
- Shared-charge spells no longer present themselves as generic **At will** text in the description.
- Chat summary now includes charge-pool and granted-spell usage summaries.
- Template-description cleanup now removes inherited technical **Foundry Note** sections when present.

### Preserved
- Shared Charges behavior from v0.8.5.
- Materializer source-authority fixes from v0.8.5.
- Supplier and firearms-filter behavior from v0.8.4/v0.8.5.

### Out of scope
- Source Manager screen reduction / category filtering.
- Published Item edit/save investigation.
