# Item Creator (DnD 5e)

**Version:** 0.0.2 Alpha  
**Compatibility:** Foundry VTT 14 / D&D5e 5.3.3

Item Creator is a GM-facing assisted creation interface for custom D&D5e items. Installed compendiums are treated as source references for document structure, template values, icons, and linked spells.

## v0.0.2 Alpha

This Alpha intentionally does **not** create or modify Items. It establishes and validates:

- the approved GM-only Item Creator entry point and Character Builder-aligned ApplicationV2 shell;
- `Weapon` as the first supported Item type;
- the completed template-driven `Base Item` stage with a special Template, required physical Base Weapon, and checkbox-gated core overrides;
- the native D&D5e Compendium Browser as the reusable Template selector for Weapon and future Item types;
- reusable Weapon icon selection from enabled content sources;
- multiple typed additional-damage parts and optional ability modifiers in Base Item;
- package-level Content Sources with source priority and automatic internal-compendium discovery;
- the checkbox-gated `Enhancements` stage for magical, offensive, critical, resistance-bypass, and conditional-advantage configuration;
- `Granted Spellcasting` with multiple linked Spells per weapon;
- native D&D5e Spell Browser selection and drag-and-drop from compendiums or the Item directory;
- independent usage limits, Short Rest or Long Rest recovery, optional spell-slot consumption, and casting eligibility per granted Spell;
- Base Spell Level, Fixed Higher Level, and compatible Spell Slot casting modes;
- Actor Default Spellcasting, Highest Spellcasting, Intelligence/Wisdom/Charisma + Proficiency, or fixed item-owned Spell Attack and Save DC values;
- optional spellbook display and Owned, Equipped, or Equipped and Attuned availability;
- immediate cascading cleanup when any optional card is disabled;
- validation of every enabled Enhancement without adding data for unchecked cards.

## Installation

Install through Foundry with this manifest URL after the GitHub Release has been published:

`https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/latest/download/module.json`

For manual installation, extract the contents of `item-creator.zip` into `Data/modules/dnd5e-item-creator`, then enable **Item Creator (DnD 5e)** in the world.

## Release packaging

The canonical GitHub packaging rules are documented in [`RELEASE.md`](RELEASE.md). The installable archive is always named `item-creator.zip`, with the module files directly at the ZIP root.

## Scope discipline

The native Foundry/D&D5e **Create Item** flow remains unchanged. Item Creator is an independent assisted alternative. Item creation commits, protected transaction overlays, Granted Effects, Description, and Review will be implemented only after the draft stages have been validated.

## GitHub Releases

- Manifest: `https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/latest/download/module.json`
- v0.0.2 Alpha package: `https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/download/v0.0.2/item-creator.zip`
- Every new build must update the versioned download URL to match its exact Git tag.
