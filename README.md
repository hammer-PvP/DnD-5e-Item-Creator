# Item Creator (DnD 5e)

**Version:** 0.2.0b Beta  
**Compatibility:** Foundry VTT 14.365 / D&D5e 5.3.3

Item Creator is a unified GM toolkit for creating, normalizing, progressing, materializing, and stocking D&D5e Items. One module now contains four connected features:

- **Item Creator** for Weapons, Equipment, and Tools;
- **Scroll Factory** for native D&D5e Spell Scrolls;
- **Supplier** for configurable merchant stock generation;
- **Materialization Core** shared by manual creation, pricing, and automatic stock materialization.

The native Foundry and D&D5e Create Item workflow remains available and is not intercepted.

## World Items Directory entry points

The World Items Directory always receives one GM-only **Item Creator** button. Its start screen provides Weapon, Equipment, Tool, and Scroll Factory. Scroll Factory remains inside Item Creator because it creates an individual Spell Scroll loot Item without requiring an Actor sheet.

When **Enable Supplier Tools** is active, the directory also receives a separate GM-only **Supplier** button with an epic-purple tint. Supplier has its own entry because it creates complete vendor stocks rather than an individual reward.

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

When disabled, the Supplier directory button is hidden, Supplier compendiums are not indexed, and Supplier generation/output services do not run. Item Creator and Scroll Factory continue to work normally.

When enabled, **Configure Supplier** separates two independent controls:

- **Level, Quality & Price** profiles determine party-level availability, enchantment distribution, spell limits, and prices. The built-in presets are **Supplier — Official D&D 2024** and **Supplier — HAMMER Homebrew**. Built-ins remain protected; duplicate either preset to edit it.
- **Supplier Profiles** determine the vendor identity, Access I–IV, categories, guarantees, weighted random pools, exclusions, repetition limits, and source compendiums. Profiles can be duplicated or built from scratch.

Every generated stock is calculated from the current **party level** and **party size**. Vendor Access controls commercial reach and restricted families; it does not replace level progression. Access IV uses a gold identity and can reach major relics and artifacts when the party-level profile permits them, while simpler relics can have lower access requirements.

The HAMMER Homebrew presets adapt the Blacksmith, Herbalist / Alchemist, and Magic Assortment flows from the vendor-roll compendium into direct percentages, guarantees, and weighted pools instead of simulated dice or RollTables. Current additional models include Gunsmith, General Trade, and Stable & Livestock.

The Blacksmith uses party-scaled physical stock plus named magic equipment and enchanted ammunition. The Alchemist guarantees one level-appropriate healing potion per party member and restricts random stock to thematic single-use consumables. Magic Assortment scales both Scrolls and magic Items by level band and party size.

Supplier diagnostics are printed for every generation. Developers can also run repeated headless previews through `game.itemCreator.auditSupplier({ profileId, level, players, runs })` without creating World Items.

## Materialization Core

The internal Core is headless: it receives source data, a Base Item when required, resolved choices, and progression constraints, then returns validated Item data and diagnostics without creating a World document itself.

It distinguishes:

- sellable Items;
- enhancement generators;
- Base Item blueprints;
- concrete variant families;
- mechanical documents that should not normally enter merchant stock.

The v0.2.0b integration includes focused handling for official generator and blueprint families, compatible-base validation, direct percentage resolution for resistance variants, canonical idempotent naming, ammunition represented by multiple native Item types, and concrete Wand of the War Mage variants.

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

The v0.2.0b package URL is:

`https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/download/v0.2.0b/item-creator.zip`
