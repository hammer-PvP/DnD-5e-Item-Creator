# Item Creator (DnD 5e)

**Version:** 0.1.5 Beta  
**Compatibility:** Foundry VTT 14 / D&D5e 5.3.3

Item Creator is a GM-facing assisted creation interface for custom D&D5e items. Installed compendiums are treated as source references for document structure, template values, icons, and linked spells.

## v0.1.5 Beta

This Beta adds assisted editing for **world Weapon Items** directly from the Foundry Items Directory. A GM can right-click a supported Item and choose **Edit with Item Creator** to reopen the existing creation workflow with the Item's current configuration loaded.

Editing supports two sources:

- Items previously created by Item Creator restore their saved Template, Base Weapon, overrides, Enhancements, Granted Spellcasting, Granted Effects, availability rules, and custom Description draft.
- Native D&D5e or earlier homebrew Weapon Items import their current system data into the same interface. Supported weapon fields, additional damage, Cast Activities, and recognized Active Effects are loaded, while unrecognized Activities, Effects, and module flags are preserved.

The Review stage provides two protected final actions:

- **Update Item** modifies the selected world Item in place while preserving its folder, ID, ownership, and unrelated external data.
- **Save as Copy** creates a separate world Item from the edited configuration and leaves the original unchanged.

Updating a world Item does not automatically replace copies that were already placed on Actors.

This Beta also retains the complete assisted Weapon creation path, the native Description editor, automatic Item Properties and Granted Spellcasting text, conditional Spellbook visibility, and runtime Granted Effects.

Weapon is the only available creation and editing type in this Beta. Equipment, Consumable, and other Item types remain locked until the Weapon workflow is validated.

## Installation

Install through Foundry with this manifest URL after the GitHub Release has been published:

`https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/latest/download/module.json`

For manual installation, extract the contents of `item-creator.zip` into `Data/modules/dnd5e-item-creator`, then enable **Item Creator (DnD 5e)** in the world.

## Release packaging

The canonical GitHub packaging rules are documented in [`RELEASE.md`](RELEASE.md). The installable archive is always named `item-creator.zip`, with the module files directly at the ZIP root.

## Scope discipline

The native Foundry/D&D5e **Create Item** flow remains unchanged. Item Creator is an independent assisted alternative. Version 0.1.5 creates and edits world Weapon Items only after final Review and a protected confirmation. Advanced runtime behaviors remain Beta features and should be tested in a development world before campaign use.

## Runtime dependency

Items created by Item Creator remain valid D&D5e Item documents if the module is disabled. Native data such as name, image, Description, damage, properties, magical bonus, Attack and Cast Activities, uses, and native recovery remains stored on the Item.

Dynamic mechanics require Item Creator to remain active, including conditional Spellbook visibility based on equipped or attuned state, runtime Granted Effects, Ignore Damage Resistance, Conditional Advantage, and state reconciliation between multiple Actor Item copies. Disabling the module can leave the last applied Actor state in place until Item Creator is enabled again and performs reconciliation.

## GitHub Releases

- Manifest: `https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/latest/download/module.json`
- v0.1.5 Beta package: `https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/download/v0.1.5/item-creator.zip`
- Every new build must update the versioned download URL to match its exact Git tag.
