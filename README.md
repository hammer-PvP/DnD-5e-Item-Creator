# Item Creator (DnD 5e)

**Version:** 0.0.1a Alpha  
**Compatibility:** Foundry VTT 14 / D&D5e 5.3.3

Item Creator is a GM-facing assisted creation interface for custom D&D5e items. Installed compendiums are treated as source references for document structure, template values, and icons.

## v0.0.1a Alpha

This Alpha intentionally does **not** create or modify Items. It establishes and validates:

- a GM-only, full-width **Item Creator** button in the Items Directory;
- an ApplicationV2 interface matching the Character Builder visual family;
- a left-side creation menu;
- `Weapon` as the only available Item type;
- a template-driven `Base Item` stage instead of a compendium browser;
- template search, weapon-type filtering, and a compact template dropdown;
- automatic loading of the template name, icon, category, attack configuration, damage, properties, range, Mastery, weight, price, and quantity;
- checkbox-gated customization for each core weapon field;
- immediate inheritance restoration and dependent-state cleanup when a customization checkbox is disabled;
- a compact square icon browser unlocked only through `Customize Icon`;
- preservation of the Base Item scroll position during template and field updates;
- Content Sources available only through Foundry's Module Settings;
- source groups named `SRD 5.1`, `SRD 5.2 Modern`, `Player's Handbook 2024`, `Dungeon Master's Guide`, `Monster Manual`, or the installed package title;
- collapsible source groups and a global Collapse All / Expand All control in Content Sources settings.

## Installation

Install through Foundry with this manifest URL after the GitHub Release has been published:

`https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/latest/download/module.json`

For manual installation, extract the contents of `item-creator.zip` into `Data/modules/dnd5e-item-creator`, then enable **Item Creator (DnD 5e)** in the world.

## Release packaging

The canonical GitHub packaging rules are documented in [`RELEASE.md`](RELEASE.md). The installable archive is always named `item-creator.zip`, with the module files directly at the ZIP root.

## Scope discipline

The native Foundry/D&D5e **Create Item** flow remains unchanged. Item Creator is an independent assisted alternative. Item creation commits, protected transaction overlays, Enhancements, Granted Effects, Description, and Review will be implemented only after the Base Item model has been validated.

## GitHub Releases

- Manifest: `https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/latest/download/module.json`
- v0.0.1a Alpha package: `https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/download/v0.0.1a/item-creator.zip`
- Every new build must update the versioned download URL to match its exact Git tag.
