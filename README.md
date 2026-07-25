# Item Creator (DnD 5e)

**Version:** 0.0.1d Alpha  
**Compatibility:** Foundry VTT 14 / D&D5e 5.3.3

Item Creator is a GM-facing assisted creation interface for custom D&D5e items. Installed compendiums are treated as source references for document structure, template values, and icons.

## v0.0.1d Alpha

This Alpha intentionally does **not** create or modify Items. It establishes and validates:

- a GM-only, full-width **Item Creator** button in the Items Directory;
- an ApplicationV2 interface matching the Character Builder visual family;
- `Weapon` as the only available Item type;
- a template-driven `Base Item` stage with checkbox-gated inherited fields;
- a prominent **Browse Weapon Templates** button that opens the native D&D5e Compendium Browser in single-selection Weapon mode;
- manual Weapon Type and Template dropdowns as a fast alternative to the browser;
- native D&D5e search, source, Weapon type, Mastery, rarity, property, and other compatible browser filters;
- a reusable modal **Icon Selection** browser unlocked by `Customize Icon`;
- square, fully contained icon cells, search, compendium filtering, preview, Cancel, and Use Selected Icon controls;
- optional multiple additional-damage parts on the same future Attack Activity;
- die count, die denomination, D&D5e damage type, and an optional ability modifier per additional-damage part;
- package-level Content Sources in Module Settings, where each complete source is enabled once and ordered with Up/Down arrows;
- automatic discovery of compatible internal compendiums according to the Item type being created;
- priority-aware manual Template dropdowns and Icon Selection results;
- a fixed Content Sources header/footer with one independently scrollable source list;
- separation between the selected special Template and the physical Base Weapon;
- automatic Base Weapon inheritance when the Template contains a valid `baseItem`;
- a required Base Weapon dropdown when a Template does not define a valid base item;
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
- v0.0.1d Alpha package: `https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/download/v0.0.1d/item-creator.zip`
- Every new build must update the versioned download URL to match its exact Git tag.
