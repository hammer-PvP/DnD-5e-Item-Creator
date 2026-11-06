# Item Creator v0.8.5.1 — Description Generator Polish

## Installation

The release archive `item-creator-v0.8.5.1.zip` contains the installable `item-creator.zip`, a standalone `module.json`, and documentation files. Only `item-creator.zip` is meant to be installed as the Foundry module payload.

## What changed

This patch focuses on the automatically generated item description:

- Replaces the fragmented output with a more coherent presentation layer for rules text.
- Adds a **Charges & Recharge** block describing total charges, recharge cadence/formula, and depletion behavior.
- Adds a **Granted Spellcasting** block where each granted spell or activity shows its availability, cast behavior, and charge/use cost.
- Adds a **Magical Properties** block that keeps non-spell properties without duplicating the spell entries.
- Keeps **Level Progression** as a separate structured section when the item unlocks features by level.
- Cleans inherited technical template notes like the observed **Foundry Note** helper section.

## Scope notes

This is a presentation / UX patch on top of v0.8.5. It does not change the underlying shared-charge mechanics, depletion runtime, or source-priority materialization logic that were already functioning.

The native D&D5e / Foundry item-sheet layout remains authoritative; this patch only improves the generated body text appended by Item Creator.
