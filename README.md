# Item Creator (DnD 5e)

**Version:** 0.1.8d Beta  
**Compatibility:** Foundry VTT 14 / D&D5e 5.3.3

Item Creator is a GM-facing assisted interface for creating and editing custom D&D5e **Weapons, Equipment, and Tools**. It also includes a separate **Scroll Factory** that uses the native D&D5e Spell Scroll generator and saves the result directly to the World Items Directory. Installed compendiums are source references for native document structure, base values, icons, and linked Spells. The native Foundry/D&D5e Create Item workflow remains unchanged.

## v0.1.8d Beta — Scroll Factory

A separate GM-only **Scroll Factory** button is available in the World Items Directory. Drop a Spell into the factory or select one through the native D&D5e Compendium Browser. The module then calls D&D5e's own `createScrollFromSpell` routine and opens the native Scroll creation dialog.

The native system remains responsible for the Scroll template, name, description, embedded Cast Activity, Save DC, Spell Attack Bonus, properties, uses, price, and other system data. After confirmation, the result is created as a World Item rather than being placed in an Actor inventory.

Scroll Factory creates one Scroll per confirmation and fixes the Scroll to the Spell's base level. The native dialog still allows the GM to choose the description detail and the native attack/save values. Drop sources may include compendiums, the Compendium Browser, World Items, and Actor Spell Items.

The native Scroll dialog is wrapped by the module's protected modal layer so other windows cannot be focused or moved above it during the transaction. Final creation also uses the protected processing overlay.

## v0.1.8c Beta — Native Item normalization

Base Items from compendiums and existing World Items are now translated into the Item Creator data model before the final Item is built. Native Active Effects and Activities are treated as source mechanics rather than copied hidden documents.

Recognized mechanics fill the normal editable fields. A combined native Effect is split into independent Creator properties. For example, the D&D5e **Cloak of Protection** Effect becomes:

- Armor Class Bonus: +1;
- All Saving Throws Bonus: +1.

Editing either field replaces that translated mechanic instead of silently stacking a second copy. Recognized imported fields can use the same `Unlock on Level` and Progression Tier controls as manually configured properties.

### Custom imported mechanics

Unrecognized Effect changes and Activities are not discarded. They become **Custom Imported Effects** or **Custom Imported Activities** in the Creator draft. Each entry includes a technical-data view and controls to:

- keep it in the final Item;
- create an Effect as disabled;
- exclude an Activity from the final Item while retaining it in the saved draft;
- remove the imported entry explicitly.

The original embedded documents are discarded during the build. The final Item receives newly generated, normalized Effects and Activities with fresh IDs, including remapped Activity-to-Effect references. This prevents old native mechanics from remaining hidden and accumulating with newly configured Creator effects.

The Base Item screen shows the mechanics found during translation. Review separates converted properties, custom imported Effects, custom imported Activities, and newly configured Creator properties. The generated Item description also includes the resulting fixed properties and level progression.

## v0.1.8b Beta — Items that grow with characters

Every supported Item type can now contain mechanics that unlock according to the owning Actor's **total character level**. Multiclass characters use the sum of all class levels; Item progression never reads a specific class level.

Compatible Enhancements, Granted Effects, Additional Damage rows, and Granted Spells include an **Unlock on Level** control. The level requirement is combined with the normal availability rule:

- Item is Owned;
- Equipped;
- Equipped and Attuned.

Both requirements must be satisfied before the mechanic becomes active.

### Replacement progression tiers

Supported numeric mechanics can add **Progression Tiers**. Tiers in the same group replace one another rather than stacking:

```text
Level 3  → +1 Spell Save DC
Level 7  → +2 Spell Save DC
Level 13 → +3 Spell Save DC
```

At level 7 the result is `+2`, not `+3`. Independent effects and independent Additional Damage rows remain separate and can stack normally.

Progression tiers are available for:

- Weapon Enhancement and Armor Enhancement;
- Additional Damage;
- Armor Class Bonus;
- Weapon Attack Roll Bonus and Weapon Damage Roll Bonus;
- Initiative Bonus;
- Proficiency Bonus Modifier;
- Maximum Hit Points Bonus;
- Spell Attack Bonus and Spell Save DC Bonus.

All other compatible mechanics can still use a single Unlock on Level requirement.

### Dynamic reconciliation

The runtime recalculates the active stage when:

- a class level or total Actor level changes;
- an Item is added, removed, or updated;
- the Item is equipped or unequipped;
- Attunement changes;
- an Actor is imported;
- the world loads or the module is re-enabled.

Progression works both upward and downward. Reducing an Actor's level restores the previous eligible tier or removes the mechanic when no tier is eligible. Managed updates are recalculated from the stored baseline so repeated hooks do not accumulate bonuses, damage dice, Active Effects, or Spellbook entries.

### Generated Item description

The GM's flavor text remains at the top of `system.description.value`. Item Creator appends and maintains two generated sections below it:

- **Item Properties** for fixed mechanics;
- **Level Progression** for evolving mechanics.

Example:

```text
Weapon Attack Roll Bonus
[Level 3 — +1 to attack rolls]
[Level 7 — +2 to attack rolls]
```

The complete progression is stored on the Item and remains visible regardless of the current Actor level. Editing and saving regenerates the managed sections without duplicating them or changing manual flavor text.

## Supported Item types

### Weapon

Supports native weapon structure, Base Weapon inheritance, damage, range, properties, Mastery, Weapon Enhancement, Additional Damage, Granted Effects, and Granted Spellcasting.

### Equipment

Supports armor, shields, robes and clothing, cloaks, headwear, amulets, gloves, rings, boots, belts, foci, accessories, and other Equipment. Armor-only fields remain restricted to Armor and Shield forms.

### Tool

Supports native Tool category, base tool, default ability, proficiency handling, Tool Check Bonus, quantity, weight, price, magical rarity, optional Attunement, Granted Effects, and Granted Spellcasting. Tools never receive weapon attacks, weapon damage, Mastery, range, Weapon Enhancement, or armor calculation fields.

## Scope change

Generic Consumable creation is not part of Item Creator. **Scroll Factory** is implemented as a separate focused tool for producing valid Spell Scrolls directly in the World Items Directory through the native D&D5e generator.

## Runtime dependency

Items remain valid D&D5e Item documents when the module is disabled. Native names, images, descriptions, properties, damage, Activities, uses, and recovery data remain stored.

The module must be active for dynamic behavior such as level progression, conditional Spellbook visibility, runtime Granted Effects, Ignore Resistance, Conditional Advantage, and reconciliation between Actor Item copies. Disabling the module can leave the last reconciled Actor state in place until the module is enabled again.

## Installation

Install through Foundry using the manifest URL after the GitHub Release is published:

`https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/latest/download/module.json`

For manual installation, extract the contents of `item-creator.zip` into `Data/modules/dnd5e-item-creator`, then enable **Item Creator (DnD 5e)** in the world.

## Release packaging

The canonical packaging rules are documented in [`RELEASE.md`](RELEASE.md). The installable archive is always named `item-creator.zip`, with module files directly at the ZIP root.

## GitHub Releases

- Manifest: `https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/latest/download/module.json`
- v0.1.8d Beta package: `https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/download/v0.1.8d/item-creator.zip`
