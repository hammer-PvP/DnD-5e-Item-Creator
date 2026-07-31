# Item Creator (DnD 5e)

**Version:** 0.2.0 Beta  
**Compatibility:** Foundry VTT 14.365 / D&D5e 5.3.3

Item Creator is a unified GM toolkit for creating, normalizing, progressing, materializing, and stocking D&D5e Items. One module now contains four connected features:

- **Item Creator** for Weapons, Equipment, and Tools;
- **Scroll Factory** for native D&D5e Spell Scrolls;
- **Supplier** for configurable merchant stock generation;
- **Materialization Core** shared by manual creation, pricing, and automatic stock materialization.

The native Foundry and D&D5e Create Item workflow remains available and is not intercepted.

## Unified entry point

The World Items Directory receives one GM-only **Item Creator** button. Its start screen provides:

- Weapon;
- Equipment;
- Tool;
- Scroll Factory;
- Supplier, when the optional Supplier feature is enabled.

Scroll Factory and Supplier open their own dedicated interfaces rather than entering the six-stage Item wizard.

## Item Creator

The assisted Item workflow is:

1. Item Type;
2. Base Item;
3. Enhancements;
4. Granted Effects;
5. Description;
6. Review.

Base Items may come from enabled compendiums, existing World Items, or custom data. The final document is created directly in the World Items Directory. Existing supported World Items can be reopened through **Edit with Item Creator**, then updated in place or saved as a copy.

### Supported Item types

#### Weapon

Supports native weapon data, Base Weapon inheritance, Attack Activity construction, damage, range, properties, Mastery, weapon enchantment, additional damage, Granted Effects, Granted Spellcasting, and character-level progression.

#### Equipment

Supports armor, shields, robes, clothing, cloaks, headwear, amulets, gloves, rings, boots, belts, foci, accessories, and other Equipment. Armor-only fields remain restricted to Armor and Shield forms.

#### Tool

Supports native Tool category, base tool, default ability, proficiency handling, Tool Check Bonus, quantity, weight, price, magical rarity, optional Attunement, Granted Effects, Granted Spellcasting, and character-level progression. A Tool never receives weapon attacks, weapon damage, Mastery, range, Weapon Enhancement, or armor calculation fields.

## Critical Threshold scope

The interface separates two mechanically different features:

- **Weapon Critical Threshold** is a Weapon Enhancement and changes only attacks made with that Weapon;
- **Actor Critical Threshold** is a Granted Effect and changes the Actor's weapon attacks, spell attacks, or all attacks according to **Applies To** and the configured availability.

This avoids presenting a weapon-local attack property as though it were the same as an Actor-wide passive effect.

## Native Effect and Activity normalization

When a Base Item contains native Active Effects or Activities, Item Creator translates recognized mechanics into its editable data model before building the new Item.

A combined Effect can be separated into independent properties. For example, a single native Effect granting `+1 Armor Class` and `+1 to all Saving Throws` becomes two editable Creator fields. The original embedded document is not copied alongside the normalized result, preventing invisible duplication.

Unknown mechanics are preserved as **Custom Imported Effects** or **Custom Imported Activities**. They can be reviewed, kept, disabled where supported, or explicitly removed. Activity-to-Effect references are remapped to fresh IDs when the normalized Item is created.

## Granted Effects

Weapons, Equipment, and Tools may grant Actor-facing bonuses including:

- Armor Class;
- Weapon Attack and Damage Rolls;
- Spell Attack and Spell Save DC;
- Ability Scores, Saving Throws, Ability Checks, and Skills;
- Initiative, Proficiency Bonus, and Maximum Hit Points;
- resistances, immunities, vulnerabilities, and condition immunities;
- movement, senses, passive scores, and critical thresholds;
- Conditional Advantage and Ignore Resistance;
- Granted Spellcasting.

Availability can be configured as:

- **Owned**;
- **Equipped**;
- **Equipped and Attuned**.

`Equipped` may also be used as a simple manual switch for roleplay-controlled effects.

## Level-based Item progression

Weapons, Equipment, and Tools can unlock or improve mechanics according to the owning Actor's **total character level**, including multiclass characters.

Example:

```text
Level 3  — +1 to attack rolls
Level 7  — +2 to attack rolls
Level 13 — +3 to attack rolls
```

Progression tiers in the same group replace earlier tiers rather than stacking with them. At level 7, the example grants a total of `+2`, not `+3`.

The runtime reconciles progression when levels, Items, equipment state, Attunement, or the world state changes. Progression also works downward when an Actor's level is reduced.

The GM's flavor text remains at the top of the Item description. Item Creator maintains generated **Item Properties** and **Level Progression** sections below it without duplicating them during later edits.

## Granted Spellcasting

Items can grant existing Spells with independent uses, recovery, slot consumption, cast level, spellcasting calculation, Spellbook visibility, availability, and level requirements.

Adding the first granted Spell marks the Item as magical. It does not automatically add a `+1`, `+2`, or `+3` enchantment and does not require Attunement unless the GM chooses those options separately.

## Rarity and pricing

The selected Rarity is written to the native `system.rarity` field and appears in the final D&D5e Item header and Review.

The shared Materialization Core provides two world-level pricing profiles:

- **Official 2024 Template**: Common 100 GP, Uncommon 400 GP, Rare 4,000 GP, Very Rare 40,000 GP, Legendary 200,000 GP, and Artifact as Priceless;
- **Custom World Values**: GM-defined values and denomination.

A newly created magical Item can receive the configured rarity price automatically. A manual price entered by the GM takes priority. Existing official or source-specific magic Item prices are preserved unless the GM explicitly replaces them through Item editing. Scroll Factory keeps the native price generated by D&D5e.

## Scroll Factory

Scroll Factory accepts a Spell dropped from a compendium, World Items, or an Actor, and also supports selection through the native D&D5e Compendium Browser.

The factory calls the native D&D5e Spell Scroll generator. D&D5e remains responsible for the Scroll structure, embedded Cast Activity, Save DC, Spell Attack Bonus, uses, properties, and price. The result is created directly in the World Items Directory rather than an Actor inventory.

Scrolls use the Spell's base level and do not offer upcasting. Generated Scrolls remain compatible with native D&D5e use and supported Scribe Spell workflows.

## Optional Supplier

Supplier is integrated but disabled by default. Enable it through:

**Configure Settings → Item Creator Configuration → Enable Supplier Tools**

When disabled, the Supplier card is hidden, Supplier compendiums are not indexed, and Supplier generation/output services do not run. Item Creator and Scroll Factory continue to work normally.

When enabled, **Configure Supplier** exposes the complete Supplier configuration:

- Compendium Sources and source priority;
- Supplier Profiles and editable Homebrew Suppliers;
- Access Levels;
- party-level rarity, spell-level, and enchantment progression;
- mundane catalog, guaranteed stock, and random stock;
- weighted pools, local curation, profile bans, and mechanical-document policy;
- materializers, blueprints, variant families, price fallbacks, and output settings;
- stock preview, confirmation, Folder creation, quantity stacking, and diagnostics.

Current Homebrew models include Blacksmith, Gunsmith, Alchemist / Herbalist, Magic Assortment, General Trade, and Stable & Livestock.

Supplier may use the shared Materialization Core rarity prices or disable that option and use the fallback values stored in its own progression profiles.

## Materialization Core

The internal Core is headless: it receives source data, a Base Item when required, resolved choices, and progression constraints, then returns validated Item data and diagnostics without creating a World document itself.

It distinguishes:

- sellable Items;
- enhancement generators;
- Base Item blueprints;
- concrete variant families;
- mechanical documents that should not normally enter merchant stock.

The v0.2.0 integration includes focused handling for official generator and blueprint families, compatible-base validation, RollTable choices, canonical idempotent naming, ammunition represented by multiple native Item types, and concrete Wand of the War Mage variants.

## Supplier standalone transition

The previous standalone Supplier settings are not imported. The standalone project was not publicly released and the integrated Supplier starts with a clean configuration under the Item Creator namespace.

The standalone module can remain installed during development without sharing settings or Application IDs, but it is now redundant. Future Supplier and Materialization Core development belongs to Item Creator.

## Runtime dependency

Created Items remain valid native D&D5e documents when Item Creator is disabled. Names, images, descriptions, properties, damage, Activities, uses, recovery, rarity, and price remain stored.

The module must remain active for dynamic behavior such as level progression, conditional Spellbook visibility, runtime Granted Effects, Ignore Resistance, Conditional Advantage, and Actor-copy reconciliation. Disabling the module may leave the last reconciled Actor state in place until it is enabled again.

## Installation

Manifest URL:

`https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/latest/download/module.json`

For manual installation, extract `item-creator.zip` into `Data/modules/dnd5e-item-creator` with `module.json` directly inside that folder.

## Release assets

Every GitHub Release publishes exactly:

- `module.json`;
- `item-creator.zip`.

The v0.2.0 package URL is:

`https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/download/v0.2.0/item-creator.zip`
