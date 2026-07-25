# Item Creator (DnD 5e)

**Version:** 0.0.1e Alpha  
**Compatibility:** Foundry VTT 14 / D&D5e 5.3.3

Item Creator is a GM-facing assisted creation interface for custom D&D5e items. Installed compendiums are treated as source references for document structure, template values, and icons.

## v0.0.1e Alpha

This Alpha intentionally does **not** create or modify Items. It establishes and validates:

- the approved GM-only Item Creator entry point and Character Builder-aligned ApplicationV2 shell;
- `Weapon` as the first supported Item type;
- the completed template-driven `Base Item` stage with a special Template, required physical Base Weapon, and checkbox-gated core overrides;
- the native D&D5e Compendium Browser as the reusable Template selector for Weapon and future Item types;
- manual Weapon Type and Template dropdowns as a fast alternative;
- reusable Weapon icon selection from enabled content sources;
- multiple typed additional-damage parts and optional ability modifiers in Base Item;
- package-level Content Sources with source priority and automatic internal-compendium discovery;
- an enabled `Enhancements` stage with eight independent checkbox-gated cards;
- Magical Weapon rarity and attunement;
- Weapon Enhancement +1, +2, and +3;
- independent Attack Roll and Damage Roll bonuses;
- Critical Hit Threshold and Extra Critical Damage;
- resistance bypass selections clearly marked as requiring Item Creator Runtime;
- Conditional Advantage with supported runtime conditions or description-only custom rules;
- immediate cascading cleanup when an Enhancement is disabled;
- validation of every enabled Enhancement without adding data for unchecked cards;
- protected Template replacement that also clears Enhancement state after confirmation.

## Installation

Install through Foundry with this manifest URL after the GitHub Release has been published:

`https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/latest/download/module.json`

For manual installation, extract the contents of `item-creator.zip` into `Data/modules/dnd5e-item-creator`, then enable **Item Creator (DnD 5e)** in the world.

## Release packaging

The canonical GitHub packaging rules are documented in [`RELEASE.md`](RELEASE.md). The installable archive is always named `item-creator.zip`, with the module files directly at the ZIP root.

## Scope discipline

The native Foundry/D&D5e **Create Item** flow remains unchanged. Item Creator is an independent assisted alternative. Item creation commits, protected transaction overlays, Granted Effects, Description, and Review will be implemented only after the Base Item and Enhancements draft models have been validated.

## GitHub Releases

- Manifest: `https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/latest/download/module.json`
- v0.0.1e Alpha package: `https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/download/v0.0.1e/item-creator.zip`
- Every new build must update the versioned download URL to match its exact Git tag.
