# Item Creator (DnD 5e)

**Version:** 0.0.1 Alpha  
**Compatibility:** Foundry VTT 14 / D&D5e 5.3.3

Item Creator is a GM-facing assisted creation interface for custom D&D5e items. Installed compendiums are treated as source references for document structure and icons.

## v0.0.1 Alpha

This first Alpha intentionally does **not** create or modify Items. It establishes and validates:

- a GM-only, full-width **Item Creator** button in the Items Directory;
- an ApplicationV2 interface matching the Character Builder visual family;
- a left-side step menu;
- `Weapon` as the only available Item type;
- locked future steps and document types;
- dynamic discovery of active Item compendiums containing Weapon documents;
- GM selection of active content sources;
- base weapon browsing by package and compendium;
- source weapon preview;
- icon browsing from all active Weapon documents, with duplicate image paths removed.

## Installation

Install through Foundry with this manifest URL after a GitHub Release has been published:

`https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/latest/download/module.json`

For manual installation, extract the contents of `item-creator.zip` into `Data/modules/dnd5e-item-creator`, then enable **Item Creator (DnD 5e)** in the world.

## Release packaging

The canonical GitHub packaging rules are documented in [`RELEASE.md`](RELEASE.md). The installable archive is always named `item-creator.zip`, with the module files directly at the ZIP root.

## Scope discipline

The native Foundry/D&D5e **Create Item** flow remains unchanged. Item Creator is an independent assisted alternative. Item creation commits, protected transaction overlays, Enhancements, Granted Effects, Description, and Review will be implemented in later builds after the Base Item flow is validated.

## GitHub Releases

- Manifest: `https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/latest/download/module.json`
- v0.0.1 Alpha package: `https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/download/v0.0.1-alpha/item-creator.zip`
- Every new build must update the versioned download URL to match its exact Git tag.

