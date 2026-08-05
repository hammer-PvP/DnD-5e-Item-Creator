# Item Creator (DnD 5e)

**Version:** 0.5.0 Beta Candidate
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
5. Spells & Resources;
6. Description;
7. Review.

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
- fixed or Actor Proficiency Bonus modes for Saving Throw bonuses;
- Initiative, Proficiency Bonus, and Maximum Hit Points;
- resistances, immunities, vulnerabilities, and condition immunities;
- movement, senses, passive scores, and critical thresholds;
- Conditional Advantage and Ignore Resistance.

Granted Spellcasting and structural resource changes are configured in the separate **Spells & Resources** step.

### Triggered Effects

Granted Effects also contains a repeatable **Triggered Effects** builder for temporary combat effects. A row combines:

1. an event such as an attack roll, successful hit, threshold-aware Critical Hit, exact Natural 20, spell use, feature use, resource or Spell Slot consumption, damage/healing application, or combat boundary;
2. activation counting such as once per Activity, attack roll, successful attack roll, damaged target, turn, or round;
3. stacks and a duration/decay model;
4. one or more generic effects applied to the Item wielder.

`Critical Hit` and `Natural 20` are separate events. Critical Hit uses the attack's configured critical threshold, while Natural 20 requires the active d20 result to equal 20. Multi-roll Spell Attacks can grant one activation per successful roll; save-based spell events default to once per spell Activity rather than once per target.

Stack behavior may refresh a single effect, share one duration across stacks, track independent stack durations, decay continuously, or begin decaying only after a configured number of inactive turns. Tracking supports Owner Turns, Combat Turns, and Rounds. Ending or deleting the Combat immediately removes every temporary Item Creator effect and its ledger state.

Applied effects include Spell Attack, Spell Save DC, weapon and spell attack/damage bonuses, AC, Saving Throws, Concentration, Initiative, maximum HP, movement, resistances, immunities, and Actor critical threshold. Values may be flat, based on Proficiency Bonus or an ability modifier, use the Actor's spellcasting modifier, roll dice, or use a custom D&D5e formula. Each effect can be fixed while active or multiplied per stack.

This first beta applies Active Effect-compatible bonuses to the Item wielder. It does not summon creatures, execute Activities automatically, apply target debuffs, persist stacks after combat, or temporarily rewrite structural Resource Modification pools.

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

## Spells & Resources

The dedicated **Spells & Resources** step contains two independent systems.

### Granted Spellcasting

Items can grant existing Spells with independent uses, recovery, slot consumption, cast level, spellcasting calculation, Spellbook visibility, availability, and level requirements.

Adding the first granted Spell marks the Item as magical. It does not automatically add a `+1`, `+2`, or `+3` enchantment and does not require Attunement unless the GM chooses those options separately.

### Resource Modifications

An Item can contain any number of resource rows. Each row has its own availability and optional **Unlock on Character Level**, which always reads the Actor's total level. The GM controls balance; Item Creator focuses on applying and removing the configuration safely.

Supported categories include:

- existing class and subclass feature pools such as Rage, Bardic Inspiration, Channel Divinity, Wild Shape, Second Wind, Action Surge, Indomitable, Focus Points, Lay on Hands, Sorcery Points, Superiority Dice, and Psionic Energy Dice;
- resource-die size changes through die steps, minimum dice, or exact dice;
- additional normal Spell Slots selected from a closed 1st–9th-level list;
- additional Pact Magic slots.

Class and subclass resources are never created on an Actor who does not own the matching feature. Global Spell Slot rows can add a slot maximum directly but do not grant known or prepared Spells. Lay on Hands treats each configured +1 as +5 points. Multiple rows and multiple active Items stack.

The runtime changes only maximum capacity. It preserves spent uses and does not refill a feature or Spell Slot when an Item is equipped, unequipped, attuned, or removed. Spending and recovery remain controlled by the original D&D5e feature.

Resource reconciliation is idempotent. Item Creator records the unmodified baseline, aggregates the currently active rows once, restores that baseline when bonuses become inactive, and preserves it across reloads. Repeated equip/unequip cycles therefore never turn a previous Item bonus into the new permanent maximum.

Runtime diagnostics are available through `game.itemCreator.auditResources(actor)`, `game.itemCreator.syncResources(actor)`, `game.itemCreator.auditTriggeredEffects(actor)`, and `game.itemCreator.syncTriggeredEffects(actor)`.

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

When enabled, the Item Directory receives a separate GM-only **Supplier** button with an epic-purple tint. Inside the Supplier window, the gear beside **Supplier Profiles** opens the profile and **Level, Quality & Price** configuration directly.
Selections and partial rerenders inside Supplier preserve the current scroll position and focused control. Scroll resets only when the GM actually changes to another screen or section.

Supplier separates two independent controls:

- **Level, Quality & Price** determines party-level rarity access, enchantment distribution, Spell limits, and prices. The protected presets are **Supplier — Official D&D 2024** and **Supplier — HAMMER Homebrew**. Duplicate a preset to create a fully editable custom copy.
- **Supplier Profiles** determine vendor identity, Access I–IV, thematic catalogs, guarantees, weighted magical pools, exclusions, repetition limits, and source compendiums.

### Content Source refresh and Supplier snapshots

Item Creator rebuilds its live Base Item/template registry when Content Sources are saved, whenever a fresh Item Creator window opens, and after a world reload when the installed-pack signature changes. This prevents checked PHB 2024 sources from remaining visually enabled while their templates or icons are absent from the runtime catalog.

A Supplier Profile copies the Content Sources enabled at the moment it is created or imported. Source changes are intentionally not applied retroactively. Enable every desired PHB, DMG, system, or module pack before creating the profile; a richer enabled catalog produces a richer preset.

### Mundane catalog, magical slots, and technical targets

HAMMER vendor profiles build stock in two layers:

1. **Mundane Catalog** — every eligible mundane Item for that vendor is always included, with quantity equal to the current party size. A party of ten therefore finds ten copies of each eligible mundane weapon, armor, kit, focus, container, or supply.
2. **Magical Stock** — a separate number of slots is calculated from party size, Vendor Access, vendor type, and the selected Level, Quality & Price profile. These slots produce +1/+2/+3 enhancements, named Items, resolved blueprints, concrete variants, and restricted relics.

The Materialization Core prefers the vendor's mundane catalog as its target source. For a recipe-backed curiosity whose vendor intentionally does not display the required mundane base, the Core may use a separate technical target catalog built from that Supplier Profile's source snapshot. Vendor affinity controls how often a family is selected; it does not make the same official recipe succeed in one vendor and fail in another. The base document is cloned and never consumes the mundane stock.

Every stock therefore continues to depend on the current **party level** and **party size**. Party level controls the power ceiling, Spell level, enchantment quality, and weighted rarity distribution; party size controls available quantities and stock scaling; Vendor Access controls commercial reach and special-item frequency. HAMMER progression is cumulative: reaching a higher band adds stronger rarities without removing Adamantine, Mithral, Uncommon, Rare, or other useful merchandise from earlier bands.

HAMMER Access uses gradual probabilities for ordinary magical merchandise:

- **Access I:** primarily mundane, with a minimal exceptional chance;
- **Access II:** a small but visible selection of special Items;
- **Access III:** moderate and consistent special variety;
- **Access IV:** broad magical variety, major relics, and highly restricted merchandise when party progression permits it.

Only explicit restrictions, artifacts, and major relics are normally hard-gated. Ordinary rare merchandise is weighted rather than completely prohibited below its preferred Access.

### HAMMER vendor presets

- **Blacksmith** always carries the complete mundane weapon, armor, shield, ammunition, and relevant physical-equipment catalog. Separate magical slots cover enhanced gear, named weapons and armor, and physical wondrous equipment. Thirty percent of its random magical budget is reserved for armor rules, with an Access-scaled minimum, so the broader physical catalog cannot dilute armor below Magic Assortment curiosities. Enchanted ammunition is checked independently once per stock: when party progression permits it, there is a 50% chance to add exactly one +1/+2/+3 ammunition family while retaining every mundane stack.
- **Alchemist / Herbalist** always carries thematic mundane kits, remedies, reagents, vessels, and field supplies; guarantees one level-appropriate healing-potion slot per party member; and adds thematic consumables, poisons, oils, powders, and preparations.
- **Magic Assortment** always carries mundane arcane foci, component supplies, scribing tools, cases, ink, and related accessories; adds Spell Scrolls from the profile's source snapshot; and rolls magical implements, accessories, wondrous Items, Access-weighted relics, and at most one armory curiosity. That single armor rule uses an Access-scaled chance of 5%, 15%, 30%, or 50% for Access I–IV.
- **Gunsmith**, **General Trade**, and **Stable & Livestock** also use deterministic party-sized mundane catalogs appropriate to their themes.


### Cumulative HAMMER rarity distribution

The protected HAMMER preset keeps all unlocked lower rarities eligible and weights magical slots as follows:

| Party level | Common | Uncommon | Rare | Very Rare | Legendary |
|---|---:|---:|---:|---:|---:|
| 1–4 | 70% | 25% | 5% | 0% | 0% |
| 5–8 | 35% | 45% | 18% | 2% | 0% |
| 9–12 | 15% | 35% | 35% | 14% | 1% |
| 13–16 | 5% | 25% | 35% | 30% | 5% |
| 17–20 | 5% | 20% | 30% | 35% | 10% |

These percentages weight magical selections; they do not remove the deterministic mundane catalog.

### Cursed merchandise

Protected Official and HAMMER vendor presets exclude cursed Items by default. The recipe layer can still resolve cursed families for manual Item creation or explicitly customized vendor profiles. When a cursed Item is allowed, the Core writes a safe unidentified name based on the mundane target, such as `Plate Armor` instead of revealing `Plate Armor of Vulnerability`.

Adaptable families compete as families rather than receiving one lottery ticket for every installed concrete variant. Per-family caps and weighted selection reduce repeated Vicious weapons, shields, giant-strength belts, Feather Tokens, and similar variant-heavy groups.

Supplier diagnostics are printed for every generation. Developers can run repeated headless previews through `game.itemCreator.auditSupplier({ profileId, level, players, runs })` without creating World Items. Known recipe families and every enabled source variant can be forced without random stock generation through `game.itemCreator.auditMaterialization({ profileId, level, families })`.

## Materialization Core

The internal Core is headless: it receives a source, a compatible Base Item when required, resolved choices, and progression constraints, then returns validated Item data and diagnostics without directly creating a World document.

It distinguishes:

- sellable Items;
- enhancement generators;
- Base Item blueprints;
- concrete variant families;
- mechanical documents that should not normally enter merchant stock.

The v0.4.0 Core uses a staged resolver. Native D&D5e Enchantment activities and profiles remain authoritative for ordinary templates. If that native path cannot produce a complete validated result, the Core consults a versioned internal **Materialization Recipe Registry** for known stable official families. Recipes declare canonical source aliases, compatible targets, variant choices, naming, rarity, pricing, mechanics, description cleanup, and final validation.

Current focused recipes cover Armor of Resistance, Demon Armor, Dragon Scale Mail, Adamantine Armor, Mithral Armor, Elven Chain, Armor of Vulnerability, Armor of Etherealness, Efreeti Chain, Wand of the War Mage, enchanted ammunition, and Oil of Sharpness. Adamantine and Mithral preserve the mundane armor price and add the active magical price component through a global recipe price finalizer that runs across every vendor and source path; the HAMMER Homebrew Adamantine recipe uses a fixed +1,500 GP magical surcharge. Elven Chain is restricted to Chain Shirt or Chain Mail targets. Oil of Sharpness is treated as a complete consumable and keeps its native use activity without requiring a concrete target during stock generation. Equivalent SRD and PHB 2024 documents converge on the same canonical family. The vendor's mundane catalog remains the preferred target source; recipe-backed Magic Assortment curiosities may use compatible mundane targets from that profile's source snapshot when the visible vendor catalog intentionally does not sell those bases. Unknown incomplete templates are rejected and rerolled rather than guessed.

The Supplier preview identifies Core output with **Enhanced item**, **Generated model**, **Blueprint resolved**, and **Variant resolved** badges. Ready-made source Items remain unbadged.

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

The v0.4.0 package URL is:

`https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/download/v0.4.0/item-creator.zip`
