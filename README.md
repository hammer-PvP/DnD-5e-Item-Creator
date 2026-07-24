# Item Creator (DnD 5e)

**Version:** 0.0.1b Alpha  
**Compatibility:** Foundry VTT 14 / D&D5e 5.3.3

Item Creator is a GM-facing assisted creation interface for custom D&D5e items. Installed compendiums are treated as source references for document structure, template values, and icons.

## v0.0.1b Alpha

This Alpha intentionally does **not** create or modify Items. It establishes and validates:

- a GM-only, full-width **Item Creator** button in the Items Directory;
- an ApplicationV2 interface matching the Character Builder visual family;
- `Weapon` as the only available Item type;
- a template-driven `Base Item` stage with checkbox-gated inherited fields;
- a prominent **Browse Weapon Templates** button that opens a modal, priority-aware Template Browser;
- manual Weapon Type and Template dropdowns as a fast alternative to the browser;
- compact Template preview, search, compendium filtering, weapon-type filtering, Cancel, and Select Base Item controls;
- a reusable modal **Icon Selection** browser unlocked by `Customize Icon`;
- square, fully contained icon cells, search, compendium filtering, preview, Cancel, and Use Selected Icon controls;
- optional multiple additional-damage parts on the same future Attack Activity;
- die count, die denomination, D&D5e damage type, and an optional ability modifier per additional-damage part;
- source priority controls in Module Settings, with enabled compendiums reordered by Up/Down arrows;
- priority-aware Template dropdowns, Template Browser results, and Icon Selection results;
- named and collapsible source groups in Module Settings;
- cascading cleanup when any optional customization is disabled;
- scroll preservation during normal edits and explicit reset only for confirmed template replacement or sidebar step changes.

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
- v0.0.1b Alpha package: `https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/download/v0.0.1b/item-creator.zip`
- Every new build must update the versioned download URL to match its exact Git tag.
