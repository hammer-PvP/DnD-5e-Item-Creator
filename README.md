# Item Creator (DnD 5e)

**Version:** 0.1.3 Beta  
**Compatibility:** Foundry VTT 14 / D&D5e 5.3.3

Item Creator is a GM-facing assisted creation interface for custom D&D5e items. Installed compendiums are treated as source references for document structure, template values, icons, and linked spells.

## v0.1.3 Beta

This Beta fixes the native Description editor surface so rich text is visibly selectable and editable, and adds compact automatic English Item Properties summaries for enabled Enhancements and Granted Effects. Generated properties and Granted Spellcasting rules are included in both the full Item description and the chat description.

This Beta implements the complete assisted Weapon creation path:

- native D&D5e Compendium Browser selection for Weapon Templates and granted Spells;
- separate special Template and physical Base Weapon composition;
- checkbox-gated Base Item overrides, Enhancements, Granted Spellcasting, and Granted Effects;
- Template-only Description inheritance with a cleaned preview and full original HTML loaded into Foundry's native rich-text editor when customization is enabled;
- final Review with a native D&D5e chat-card preview, compact inventory presentation, activity list, and configuration summary;
- protected `Save Item` confirmation and blocking processing overlay;
- creation of the final world Weapon Item with Attack and Cast Activities, generated Active Effect blueprints, source metadata, and Item Creator runtime flags;
- runtime mirroring of Granted Effects when the created Item is owned, equipped, or equipped and attuned on an Actor.

Weapon is the only available creation type in this Beta. Equipment, Consumable, and other Item types remain locked until the Weapon workflow is validated.

## Installation

Install through Foundry with this manifest URL after the GitHub Release has been published:

`https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/latest/download/module.json`

For manual installation, extract the contents of `item-creator.zip` into `Data/modules/dnd5e-item-creator`, then enable **Item Creator (DnD 5e)** in the world.

## Release packaging

The canonical GitHub packaging rules are documented in [`RELEASE.md`](RELEASE.md). The installable archive is always named `item-creator.zip`, with the module files directly at the ZIP root.

## Scope discipline

The native Foundry/D&D5e **Create Item** flow remains unchanged. Item Creator is an independent assisted alternative. Version 0.1.3 creates world Weapon Items only after final Review and a protected confirmation. Advanced runtime behaviors remain Beta features and should be tested in a development world before campaign use.

## GitHub Releases

- Manifest: `https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/latest/download/module.json`
- v0.1.3 Beta package: `https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/download/v0.1.3/item-creator.zip`
- Every new build must update the versioned download URL to match its exact Git tag.
