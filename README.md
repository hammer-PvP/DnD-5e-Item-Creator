# Item Creator (DnD 5e)

**Version:** 0.1.8a Beta
**Compatibility:** Foundry VTT 14 / D&D5e 5.3.3

Item Creator is a GM-facing assisted creation interface for custom D&D5e items. Installed compendiums are treated as source references for document structure, template values, icons, and linked spells.

## v0.1.8a Beta

This Beta adds the complete **Tool** creation and editing flow. Tools use the same six stages as Weapon and Equipment while preserving the native D&D5e Tool document structure. A GM can select a Tool from configured compendiums, use the native D&D5e Compendium Browser, or start from a Custom Tool shell.

The Base Item stage supports Tool Category, Base Tool, Default Ability, Proficiency Handling, Tool Check Bonus, quantity, weight, price, and Tool-valid properties. Tool Check Bonus modifies checks made with that Tool only. A native Check Activity is created when the selected Tool has none.

Tool Enhancements are intentionally type-safe. A Tool can be magical, have rarity, require Attunement, and grant existing Spells, but it cannot gain weapon damage, an Attack Activity, Weapon Enhancement, Mastery, range, weapon properties, Armor Enhancement, or native armor calculation fields.

Tools have access to the complete Actor-facing Granted Effects library. This includes Armor Class, Weapon Attack Roll Bonus, Weapon Damage Roll Bonus, Spell Attack, Spell Save DC, ability scores, saves, checks, skills, resistances, movement, senses, Critical Hit Threshold, and Granted Spellcasting. Availability remains `Owned`, `Equipped`, or `Equipped and Attuned`. `Equipped` may be used as a simple manual on/off switch for narrative conditions. Item Creator does not inspect the currently used weapon, Bardic Inspiration, or individual Activities.

World Tool Items can be reopened through **Edit with Item Creator**, then updated in place or saved as a copy. Tool icons use the same complete type-agnostic catalog as Weapon and Equipment.

## v0.1.8 Beta

This patch fixes two regressions discovered during Equipment validation. The reusable Icon Selection browser now exposes the same complete, type-agnostic icon catalog for Equipment that was already available to Weapon. A GM may choose any indexed Item icon from active compendiums while retaining source-name search and compendium filters.

Granted Spellcasting now automatically marks its parent Weapon or Equipment as magical when the first Spell is added. This automatic state does not grant a numeric `+1`, `+2`, or `+3` enhancement and does not require Attunement. Rarity and Attunement remain editable GM choices. If every granted Spell is removed, the automatic magical state is removed only when it was not subsequently made a manual GM choice.

Generated Cast Activities no longer use D&D5e's separate `requireMagic` visibility gate. Spellbook visibility is controlled only by Item Creator's `Owned`, `Equipped`, and `Equipped and Attuned` availability rules. On world load, the runtime repairs managed pre-v0.1.8 world Items and Actor copies by adding the magical property where Granted Spellcasting exists and removing the obsolete gate.

## v0.1.7 Beta

This Beta adds the first complete **Equipment** creation and editing flow while preserving the existing Weapon workflow.

Equipment uses the same assisted stages as Weapon: Item Type, Base Item, Enhancements, Granted Effects, Description, and Review. A GM can select an Equipment document from configured compendiums or start from a custom equipment shell.

Supported Equipment forms include Armor, Shield, Torso / Robe, Cloak / Mantle, Headwear, Neck / Amulet, Hands / Gloves, Finger / Ring, Feet / Boots, Waist / Belt, Focus / Catalyst, Accessory, and Other Equipment. Robes and other caster clothing remain non-armor Equipment and do not require Light Armor or other Armor Training.

Equipment-specific Enhancements include Magical Equipment, native Armor Enhancement, Base Armor Class override, removal of Strength requirements, and removal of Stealth Disadvantage. Weapon-only attack construction, damage, range, Mastery, and weapon properties remain filtered out of the Equipment flow.

Equipment has access to the complete Granted Effects library, including Armor Class, ability scores, saving throws, checks, skills, resistances and immunities, movement, senses, initiative, Hit Points, spell attack and save bonuses, passive scores, and Actor-level weapon or spell Critical Hit Threshold. Granted Spellcasting continues to select existing Spell documents; Item Creator does not create new Spells.

The GM-only **Edit with Item Creator** action now supports world Equipment Items as well as world Weapon Items. Managed Items restore their complete Item Creator draft, while native or earlier homebrew Equipment imports supported D&D5e fields and preserves unrecognized data. Review continues to offer **Update Item** and **Save as Copy**.

The Item Type screen is now limited to the definitive module scope: Weapon, Equipment, Consumable, and Tool. Consumable and Tool remain Coming Later. Container, Loot, Spell, and Feature creation are not part of Item Creator.

## v0.1.6 Beta

This Beta fixes native and earlier homebrew Weapon import so D&D5e's prepared base-damage part is never misclassified as Item Creator Additional Damage. A normal Longsword now imports as 1d8 Slashing with 1d10 Versatile damage and no extra damage row.

Primary Attack damage is now rebuilt deterministically when an imported world Item is updated. Disabled Additional Damage values are removed from the saved draft, existing managed damage parts are replaced instead of appended, and repeated edits no longer increase the attack damage.

The correction also repairs the v0.1.5 self-import signature. Opening and updating an affected Item removes the false base-damage copy and accumulated duplicate parts while preserving legitimate unrelated Activities and external data.

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


## Installation

Install through Foundry with this manifest URL after the GitHub Release has been published:

`https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/latest/download/module.json`

For manual installation, extract the contents of `item-creator.zip` into `Data/modules/dnd5e-item-creator`, then enable **Item Creator (DnD 5e)** in the world.

## Release packaging

The canonical GitHub packaging rules are documented in [`RELEASE.md`](RELEASE.md). The installable archive is always named `item-creator.zip`, with the module files directly at the ZIP root.

## Scope discipline

The native Foundry/D&D5e **Create Item** flow remains unchanged. Item Creator is an independent assisted alternative. Version 0.1.8a creates and edits world Weapon, Equipment, and Tool Items only after final Review and a protected confirmation. Advanced runtime behaviors remain Beta features and should be tested in a development world before campaign use.

## Runtime dependency

Items created by Item Creator remain valid D&D5e Item documents if the module is disabled. Native data such as name, image, Description, damage, properties, magical bonus, Attack and Cast Activities, uses, and native recovery remains stored on the Item.

Dynamic mechanics require Item Creator to remain active, including conditional Spellbook visibility based on equipped or attuned state, runtime Granted Effects, Ignore Damage Resistance, Conditional Advantage, and state reconciliation between multiple Actor Item copies. Disabling the module can leave the last applied Actor state in place until Item Creator is enabled again and performs reconciliation.

## GitHub Releases

- Manifest: `https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/latest/download/module.json`
- v0.1.8a Beta package: `https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/download/v0.1.8a/item-creator.zip`
- Every new build must update the versioned download URL to match its exact Git tag.
