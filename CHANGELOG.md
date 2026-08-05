# Changelog

## 0.5.0d — Recipient Turn Duration Clarity

### Duration reference

- Renamed the stacked duration selector to **Duration Follows** and made its choices explicit: **Source Actor Turns (Item Owner)**, **Effect Recipient Turns**, **Every Combat Turn**, and **Combat Rounds**.
- Target-bound effects now default to **Effect Recipient Turns** when no duration reference was explicitly chosen. Existing owner-only Triggered Effects keep their prior owner-turn behavior.
- Duration references chosen in v0.5.0d are marked as explicit and are never overwritten by later normalization or recipient changes.
- Single Activation target effects likewise default to the matching recipient-turn expiration unless the GM explicitly chooses a source-Actor boundary.
- Added a contextual warning whenever target effects are intentionally timed by the source Actor, plus dynamic duration guidance that states exactly whose turns advance the effect.

### Runtime and compatibility

- Each target continues to use its own ledger entry and therefore loses copied Spell effects or other payloads according to that target's individual Combat turns.
- Increased the Item Creator document schema to 9. v0.5.0c target rows still carrying the owner-turn default migrate to recipient turns. Other duration units are preserved, and choices made from v0.5.0d onward are recorded explicitly.

## 0.5.0c — Target Recipients and Selected Spell Effects

### Target-aware Applied Effects

- Added **Effect Recipient** to every Triggered Effect payload without changing the existing creation flow or removing any current effect type.
- **Item Owner** preserves all prior behavior. **Trigger Target(s)** applies the payload to the Actor targets recorded by the D&D5e Activity or attack.
- Resource and Feature triggers can therefore deliver effects to their selected targets, while attack-hit triggers can deliver effects to the creature hit. Damage and healing events use the Actor that actually received the change.
- Target payloads never silently fall back to the Item owner. When an event has no valid target, only the target-bound payload is skipped.
- Added one ledger entry per recipient and one shared activation-control entry per Trigger, preserving per-Activity, per-target, per-turn, per-round, and duplicate-event limits across multiple recipients.

### Effects from a selected Spell

- Added **Apply Effects from Selected Spell** to Applied Effects, using the native D&D5e Spell browser.
- The selected Spell's enabled, transferable Active Effects and conditions are snapshotted into the Item so the result remains deterministic and does not depend on a live cast.
- The runtime copies those effects directly to the chosen recipient. It does not cast the Spell, consume a slot or action, execute the Spell's targeting, damage, healing, saving throw, template, or other Activities, retain its original duration, or create concentration.
- Spells with no transferable Active Effects are rejected during selection instead of creating an inert configuration.
- Multiple embedded effects from one Spell are tracked and cleaned independently, while still belonging to one Trigger application.

### Recipient-based lifetimes

- Added Single Activation expiration at the end of the recipient's current turn, the start of the recipient's next turn, or the end of the recipient's next turn.
- Added **Effect Recipient Turns** to the existing stacked duration units. Owner Turns, Combat Turns, Rounds, Single Attack, and every existing stack behavior remain unchanged.
- Remote effects are removed when their Trigger expires, the source Item is unequipped or deleted, its Attunement/level requirement is lost, the Active Effect is reconciled, or the Combat ends.

### Description and compatibility

- Generated summaries now identify the recipient of every payload and explain selected-Spell effects as effect copying rather than spellcasting.
- Renamed per-target activation counting to **Once per Trigger Target** for general attack, Feature, resource, damage, and healing use.
- Increased the Item Creator document schema to 8 and the Triggered Effect runtime ledger to version 2. Existing payloads default to **Item Owner**, and version-1 ledger entries migrate to owner-recipient entries without changing their behavior.

## 0.5.0b — Trigger Clarity and Single-Activation Lifetimes

### Clear Spell trigger intent

- Renamed the broad Spell event to **Any Spell Matching Filters** and added inline guidance explaining that no specific Spell is required; every Spell matching the selected level and school can trigger it.
- **Specific Spell Cast** now remains visibly editable while a Spell is being chosen and validates only after a Spell is selected. Level and school remain optional additional filters.
- Legacy v0.5.0a rows saved as Specific Spell Cast without a selected Spell automatically normalize to Any Spell Matching Filters, preserving their level/school filters and repairing a configuration that previously matched nothing.

### General Single Activation mode

- Added **Application Mode** above the existing stack controls without removing or changing any prior Stack Behavior.
- Added **Single Activation** for every trigger category. It creates one non-stacking effect and can expire at the end of the owner's current turn, the start of the owner's next turn, or the end of the owner's next turn.
- Added retrigger control: **Refresh Duration** or **Ignore While Active**.
- Kept **Single Attack — Remove After Damage Roll** and all prior refresh, shared, independent, continuous-decay, and delayed-decay behavior intact.

### Generated description refinement

- Triggered Effect summaries now describe the actual trigger and filters, every applied effect, activation counting and per-turn/per-round limits, application mode, stack behavior, duration, expiration boundary, and retrigger rule.
- Movement effects now identify the movement type and exact bonus, so rules such as casting any Enchantment Spell to gain +15 ft Walking speed are understandable directly from the generated Item description.

### Compatibility

- Increased the Item Creator document schema to 7. Existing Triggered Effects default to the original **Stacks & Duration** application mode and retain their previous runtime behavior.

## 0.5.0a — Triggered Effects Interface and Cleanup Hotfix

### Stable editing controls

- Fixed Triggered Effect text, numeric, and formula inputs rerendering after every keystroke. Names such as `Poder da Melodia`, stack limits, durations, formulas, and payload values now retain focus and cursor position while typing.
- Text and numeric controls update the draft live without rebuilding the screen, then normalize on change/blur. Temporarily empty numeric fields are no longer forced to zero mid-entry.

### Idempotent Active Effect cleanup

- Added one shared safe Active Effect deletion service for both passive runtime effects and Triggered Effects.
- Concurrent expiration, unequip, Attunement loss, combat cleanup, and reconciliation now share the same deletion operation.
- A server response that an Active Effect no longer exists is treated as an already-completed cleanup instead of producing an unhandled promise rejection.

### Clear generated descriptions

- Generated Triggered Effect summaries now print the selected resource, Spell, feature, slot level, and attack filter where applicable.
- `Specific Resource Spent` now resolves to labels such as `Bardic Inspiration Spent`.
- Simplified the visible event labels to `Critical Hit` and `Natural 20`, while preserving their separate runtime meanings.

### Single-attack lifetime

- Added **Single Attack — Remove After Damage Roll** for Attack Hit, Critical Hit, and Natural 20 triggers.
- This mode creates one temporary effect after the successful attack roll, keeps it through the next damage roll from that same Activity, and removes it immediately afterward.
- If no damage roll is made, the effect is removed at the end of the wielder's current turn. This is intended for same-attack damage additions such as adding the spellcasting modifier to a critical Spell Attack's damage.
- Attack bonuses cannot retroactively modify the attack roll that already triggered the effect.

### Duration clarification

- Confirmed and documented that `1 Owner Turn` with `End of Owner Turn` expires when the owner's current turn ends, including the turn in which the trigger occurred.

## 0.5.0 — Triggered Effects Beta Candidate

### Generic event-driven Item effects

- Added a repeatable **Triggered Effects** section inside Granted Effects for Weapon, Equipment, and Tool Items.
- Each configuration defines availability, optional total-character-level unlock, trigger, activation cardinality, per-turn/per-round limits, stacks, duration or decay, and one or more temporary Actor effects.
- No named gameplay presets are included. GMs build their own mechanics from functional effects such as Spell Attack Bonus, Spell Save DC Bonus, Weapon Damage Bonus, Armor Class, Saving Throws, movement, resistances, immunities, and critical threshold.
- Added flat, Proficiency Bonus, ability-modifier, default/highest spellcasting modifier, dice, and custom-formula calculations, with fixed or per-stack scaling.

### Attack and spell event tracking

- Added separate attack events for **Attack Rolled**, **Attack Hit**, **Critical Hit**, **Natural 20**, and **Damage from an Attack Applied**.
- `Critical Hit` follows the attack roll's actual critical threshold; `Natural 20` requires the active d20 result to be exactly 20. A natural 19 can therefore trigger Critical Hit when the threshold is 19 without triggering Natural 20.
- Spell Attack hits are counted per successful attack roll, allowing multi-attack spells to grant one activation for each successful ray or strike.
- Save-based spells can be configured through one-per-Activity spell-cast events, preventing area spells from multiplying activations by target count unless the GM deliberately chooses damage-per-target counting.
- Added events for spell use, selected spell or feature use, resource and slot consumption, damage/healing application, and combat turn/round boundaries.

### Stacks, duration, and cleanup

- Added No Stacking/Refresh, Shared Duration, Independent Duration, Continuous Decay, and Delayed Decay after Inactivity.
- Duration tracking supports Owner Turns, Combat Turns, and Rounds, with start/end tick selection. A 1 Owner Turn effect set to End of Owner Turn expires when the owner's current turn ends.
- Triggered state is stored in a versioned Actor ledger and reconciled idempotently after reloads, Item state changes, Actor updates, manual effect deletion, and level changes.
- Ending or deleting a Combat immediately removes all Item Creator temporary effects, stacks, durations, counters, deduplication state, and ledger entries. Effects are never preserved between combats.
- The runtime is GM-authoritative through the module socket and deduplicates events by combat, Activity, message, roll, and target identity.

### Scope boundaries

- Triggered Effects in this candidate apply temporary Active Effect-compatible Actor bonuses to the Item wielder.
- Automatic summoning, executing another Activity, direct target debuffs, and persistent post-combat effects are intentionally excluded.
- Structural Resource Modifications remain configured in **Spells & Resources** and are not temporary Triggered Effect payloads in this first candidate, preserving the v0.4.0b baseline/restoration guarantees while the event engine is validated.

### Diagnostics and validation

- Added `game.itemCreator.auditTriggeredEffects(actor)` and `game.itemCreator.syncTriggeredEffects(actor)`.
- Added deterministic tests for threshold critical versus Natural 20, multi-roll stacking, all stack lifecycles, delayed inactivity decay, custom formulas, per-stack Spell Attack/Spell Save DC changes, and combat-end cleanup.

## 0.4.0b — Resource Baseline Ledger Repair

### Global original-value snapshots

- Replaced the feature-resource runtime flag with a versioned array ledger whose entries store an explicit `path`, original `base`, last `applied` value, active bonus, and contributing Item rows.
- Every directly modified resource maximum is now reconciled as `original base + active modifications`; the runtime never adopts its own applied value as a new baseline.
- Removing one source recalculates from the preserved original and remaining sources. Removing all sources restores the exact original formula or numeric value.
- Current/spent uses remain separate from maximum values and are never used as baseline snapshots or refilled by equip/unequip.
- Legitimate external edits and level-up writes can replace the stored base only when they differ from both the recorded original and the last runtime-applied value.

### v0.4.0/v0.4.0a migration

- Fixed Foundry expanding dotted flag keys such as `system.uses.max` into nested objects, which prevented inactive Items from restoring the original resource maximum.
- Added automatic extraction of valid legacy leaf paths while ignoring malformed whole-system snapshots.
- Migrates feature pools to `resourceRuntimeLedger`, deletes the malformed `resourceRuntimeBases` flag, and repairs affected Actors during `ready` synchronization or `game.itemCreator.syncResources(actor)`.
- The migration restores affected Bardic Inspiration formulas without overwriting unrelated feature data such as Font of Inspiration recovery changes.

### Spell Slots, Pact Magic, and resource dice

- Migrated normal and Pact Magic slot tracking to an explicit-path `resourceSlotLedger` with original override, natural maximum, last applied override, bonus, and sources.
- Slot reconciliation temporarily restores the original override before reading the native class-derived maximum, allowing level progression underneath an equipped Item without cumulative drift or slot refills.
- Resource Die changes remain non-destructive Active Effects; their untouched source-scale values are now recorded as explicit base snapshots for audit and migration.

### Validation

- Added deterministic regression coverage for the exact nested v0.4.0a Bardic Inspiration state exported from Eryka, repeated equip/unequip, F5-style repeated syncs, multiple Items, formula and numeric pools, Lay on Hands, legacy Spell Slot migration, original override restoration, and preservation of spent slots.

## 0.4.0a — Resource Runtime Hotfix

### Idempotent resource reconciliation

- Fixed class and subclass resource maxima accumulating permanently when a managed Item was equipped, unequipped, re-equipped, or synchronized repeatedly.
- Replaced strict JSON type comparison with formula-aware comparison so D&D5e normalization between numeric strings and numbers cannot turn an already-applied bonus into a new baseline.
- Resource feature baselines now remain recorded while a modifier is inactive, allowing the runtime to restore exactly the original maximum and reapply only the currently desired total.
- Added one-time recovery for source-backed features already affected by v0.4.0 cumulative drift, using the official compendium value when the stored/current value matches repeated managed additions.
- Aggregated bonuses from multiple Items remain additive, while removal of one Item removes only its own contribution.
- External edits and level-up writes to a managed resource maximum are captured as a new baseline before the Item bonus is reconciled.

### Spell-slot hardening

- Applied the same formula-aware, persistent-baseline reconciliation to normal and Pact Magic slot overrides.
- Equipping, unequipping, reloading, or repeatedly synchronizing a slot-granting Item no longer increases the override cumulatively or refills spent slots.

### Validation

- Added deterministic regression coverage for repeated Bardic Inspiration equip/unequip cycles, v0.4.0 legacy drift repair, multiple stacking Items, Lay on Hands' +5 multiplier, formula-backed feature pools, blank-source safety, and 9th-level Spell Slot reconciliation.

## 0.4.0 — Beta Candidate

### Spells & Resources workflow

- Added a dedicated **Spells & Resources** step between Granted Effects and Description for Weapon, Equipment, and Tool creation.
- Moved Granted Spellcasting into the new step without duplicating its configuration in Enhancements.
- Added repeatable Resource Modification cards with independent availability and total-character-level unlocks.
- Added draft restoration, Review summaries, generated Item Properties, and Level Progression text for resource modifications.

### Resource Modification runtime

- Added a canonical registry for class and subclass resources including Rage, Bardic Inspiration, Channel Divinity, Wild Shape, Second Wind, Action Surge, Indomitable, Focus Points, Lay on Hands, Sorcery Points, Superiority Dice, Psionic Energy Dice, and other compatible feature pools.
- Resource bonuses modify an existing feature only; missing class or subclass features are never created.
- Lay on Hands uses the approved multiplier: each configured +1 adds 5 points.
- Multiple Items and multiple rows aggregate into one managed maximum while preserving spent uses and the original recovery rules. Equipping or removing an Item never refills the pool.
- Added Resource Die operations for increasing die steps, setting a minimum die, or setting an exact die when a compatible D&D5e scale can be located.
- Added normal Spell Slot modifications with a closed 1st–9th-level selector and separate Pact Magic slot modifications. Slot bonuses preserve spent slots and follow native recovery.
- Added GM diagnostics through `game.itemCreator.auditResources(actor)` and manual reconciliation through `game.itemCreator.syncResources(actor)`.

## 0.3.2 — Beta

### Elven Chain target integrity

- Added a deterministic `Elven Chain` recipe and removed the family from unrestricted automatic armor conversion.
- Restricted valid targets to `Chain Shirt` and `Chain Mail`; Hide Armor, Plate Armor, Scale Mail, Breastplate, Half Plate, Splint, Shields, and all unrelated equipment are rejected before materialization.
- Added final recipe validation so an Elven result cannot receive a resolved badge unless its concrete base is one of the two approved chain armors.

### Global recipe price finalization

- Added a final recipe-aware price pass after every Supplier stock path, including copy, pass-through, concrete source variants, blueprint materialization, and rerolls.
- Made recipe price rules independent of vendor type and source path: the same Item/base under the same `Level, Quality & Price` profile now receives the same price in Blacksmith, Magic Assortment, or any other eligible vendor.
- Applied the HAMMER Adamantine formula globally as base armor price + 1,500 GP and retained base + rarity pricing for Mithral Armor.
- Added concrete-family recognition for ready-made Adamantine, Mithral, and Elven armor documents whose source identifiers do not retain the generic template name.
- Rejects a base-plus-rarity result when its mundane base cannot be resolved instead of silently preserving an inconsistent source price.

### Saving Throw Bonus value mode

- Added `Fixed Modifier` and `Proficiency Bonus` modes to `Granted Effects → Saving Throw Bonus` for Weapon, Equipment, and Tool Items.
- `Proficiency Bonus` writes the D&D5e `@prof` formula so the bonus follows the current Actor proficiency bonus automatically without level tiers.
- Supports one selected Saving Throw or the global `All Saving Throws` bonus field.
- Added import/edit recognition for Item Creator effects that already use `@prof`, preserving the selected mode when reopening a World Item.

## 0.3.1 — Beta

### Material pricing and Alchemist reliability

- Changed Adamantine Armor pricing to preserve the mundane armor price and add the magical component instead of replacing the base value.
- Added the HAMMER Homebrew Adamantine override of base armor price + 1,500 GP.
- Audited Mithral Armor under the same base-plus-rarity pricing rule, using the active Level, Quality & Price profile for the magical component.
- Registered Oil of Sharpness as a self-contained pass-through consumable. It now enters Alchemist / Herbalist stock without requiring a weapon or ammunition target and preserves its native use/enchantment activity.
- Added final price-origin diagnostics for base-plus-rarity material recipes and the HAMMER Adamantine surcharge.
- Kept the v0.3.0 stock generation, vendor balance, recipes, ammunition pass, source refresh, cursed-item defaults, and interface behavior unchanged.

## 0.3.0 — Beta

### HAMMER progression and vendor balance

- Made HAMMER rarity access cumulative: higher party levels add stronger rarity bands without removing Common, Uncommon, Rare, Adamantine, Mithral, or other earlier merchandise.
- Added weighted rarity distributions for party levels 1–4, 5–8, 9–12, 13–16, and 17–20.
- Reserved 30% of Blacksmith random magical stock for armor rules, with Access-scaled minimum armor selections, preventing weapons and broad physical equipment pools from diluting named/materialized armor.
- Replaced the Magic Assortment light/medium/heavy armor rules with one armory-curiosity rule capped at one selection and weighted at 5%, 15%, 30%, or 50% for Access I–IV.
- Kept Alchemist / Herbalist, General Trade, and the remaining Magic Assortment structure unchanged.

### Materialization Recipe Registry

- Expanded the staged Materializer: native D&D5e resolution remains first; incomplete native output falls back to deterministic recipes and must pass post-materialization validation before receiving a resolved badge.
- Added or reinforced recipes for Armor of Resistance, Demon Armor, Dragon Scale Mail, Adamantine Armor, Mithral Armor, Armor of Vulnerability, Armor of Etherealness, Efreeti Chain, Wand of the War Mage, and enchanted ammunition.
- Unified SRD and Player’s Handbook 2024 Wand of the War Mage templates under one canonical family and resolver.
- Added a technical target catalog from each Supplier Profile's source snapshot so an eligible recipe resolves consistently even when the vendor does not visibly sell its mundane base.
- Kept the visible mundane catalog as the preferred target source and preserved its party-sized quantities.
- Added deterministic runtime recipe auditing through `game.itemCreator.auditMaterialization({ profileId, level, families })`.

### Ammunition

- Moved enchanted ammunition to an independent final Blacksmith pass instead of normal random-stock competition.
- Added one 50% availability check per stock, at most one enchanted ammunition family, and one +1/+2/+3 result chosen from the active Level, Quality & Price profile.
- Consolidated Arrow/Arrows, Crossbow Bolt/Bolts, Blowgun Needle/Needles, Sling Bullet/Bullets, and equivalent multi-source documents by canonical family.
- Kept every mundane ammunition stack in stock and rejected Spells or name-only false positives before ammunition heuristics.
- Added explicit ammunition diagnostics for roll result, eligible families, selected family, bonus, success, and failure.

### Pricing, fallbacks, and cursed Items

- Added a mandatory final price pass for materialized magic Items using resolved rarity and the active Level, Quality & Price profile.
- Prevented magical blueprints from retaining 1 GP, 5 SP, or other mundane/template fallback prices.
- Added a base-price floor for nonmagical material variants.
- Restricted rerolls to the same rule intent/category so a failed named armor blueprint does not become unrelated generic equipment.
- Disabled cursed merchandise in protected Official and HAMMER vendor presets by default.
- Added safe unidentified names based on the resolved mundane target for recipe-backed cursed Items.
- Completed Armor of Vulnerability resolution with one physical resistance, the other two physical vulnerabilities, effects, final description, and unidentified base name.

### Sources and interface

- Added runtime Content Source signature validation and forced registry rebuilds on save, Item Creator open, and world reload when pack state changes.
- Preserved Supplier source snapshots: existing Supplier Profiles still use the sources available when they were created or imported.
- Preserved scroll position and focus during same-screen Supplier rerenders; scroll resets remain limited to actual section changes.
- Rebuilt protected HAMMER profiles once to preset schema version 7 while preserving source snapshots, progression selection, bans, and local overrides where applicable.

## 0.2.0e

### Staged Materialization Recipes

- Added a versioned internal **Materialization Recipe Registry** for stable official Item families whose SRD, PHB 2024, DMG, or legacy documents encode equivalent templates differently.
- Kept native D&D5e materialization as the first stage. A deterministic recipe is used only when the native activity/profile flow cannot produce a complete validated result.
- Added source-agnostic recipes for Armor of Resistance, Demon Armor, Armor of Etherealness, Efreeti Chain, Wand of the War Mage, and enchanted ammunition.
- Unified SRD and Player's Handbook Wand of the War Mage templates under one canonical resolver, including concrete +1/+2/+3 name, rarity, spell-attack bonus, description, and Supplier rarity price.
- Made recipe recognition use canonical family aliases and source metadata rather than one exact display name.
- Added recipe target contracts and output validation so unresolved template titles, template instructions, fallback 1 GP prices, missing resistance effects, and invalid ammunition results cannot receive a resolved badge.

### Armor and ammunition reliability

- Recovered Armor of Resistance through a deterministic fallback that selects one concrete damage type, clones a compatible mundane armor target, applies the resistance Effect, removes generic RollTable/template instructions, and prices the final Rare Item correctly.
- Added recipe fallback for Demon Armor using the official source template and its own target restrictions; source restrictions remain authoritative when present.
- Added deterministic target recipes for Armor of Etherealness and Efreeti Chain while preserving the native Materializer as the preferred path.
- Allowed low-weight Magic Assortment armory curiosities to use recipe-backed physical targets from the profile's source snapshot, so a cursed or unusual armor can be sold there without requiring armor in its visible mundane catalog.
- Rebuilt enchanted ammunition as an explicit recipe over one canonical mundane ammunition family. The existing mundane stack remains, one 50% check is made, and at most one Arrow, Bolt, Needle, Bullet, or other valid family receives one +1/+2/+3 result.
- Kept Spell documents excluded before all ammunition name heuristics.

### Supplier integration

- Rebuilt protected HAMMER profile snapshots once for the v6 recipe-registry architecture while preserving profile names, sources, progression selection, bans, and overrides.
- Extended diagnostics with recipe IDs, native failures, selected bases, resolved bonuses, and recipe-fallback strategies.

## 0.2.0d

- Forced every materialized blueprint to use the active Supplier rarity price after the final rarity is resolved, preventing Very Rare results such as Frost Brand from retaining a mundane silver price.
- Added a dedicated Blacksmith Materialized Magic Armor pool with mundane Blacksmith armor as its target catalog.
- Kept only finished, sellable magic armor in Magic Assortment armory curiosities so Armor of Resistance and Efreeti Chain are no longer attempted without valid armor bases.
- Excluded Improvised Weapon placeholders from Blacksmith mundane and enhanced merchandise.
- Consolidated legacy and modern Arrow/Arrows, Bolt/Bolts, Needle/Needles, and Sling Bullet documents by canonical ammunition family.
- Rebuilt Item Creator Content Sources on world ready, on first opening each fresh Item Creator window, and immediately after saving source settings.
- Preserved scroll position when selecting Supplier templates, Access Levels, existing Supplier Profiles, and Level, Quality & Price profiles within the same screen.

## 0.2.0c

- Changed HAMMER Homebrew Blacksmith enchanted ammunition to a single independent 50% availability check per generated stock.
- When the check succeeds and party progression unlocks a positive quality, exactly one ammunition family is selected and receives one +1, +2, or +3 variant.
- The mundane ammunition stack always remains in stock; enchanted ammunition is additional and never replaces it.
- Canonicalized Arrow, Crossbow Bolt, Blowgun Needle, and Sling Bullet families so duplicate source documents do not gain extra lottery tickets.
- Removed enchanted ammunition from the general magical-slot competition to make its behavior deterministic and testable.
- Hardened ammunition detection to reject Spell documents such as Cordon of Arrows, Melf's Acid Arrow, and Lightning Arrow.
- Rebuilt protected HAMMER Homebrew profile snapshots once for the v4 ammunition architecture while preserving names, sources, progression selection, bans, and overrides.

## 0.2.0b — Beta

### Deterministic vendor catalogs and separate magical stock

- Rebuilt HAMMER vendor presets around a deterministic **Mundane Catalog**. Every eligible mundane Item for the vendor is included with quantity equal to party size instead of being selected by random stock rolls.
- Separated mundane availability from magical stock slots. Mundane gear remains available regardless of Vendor Access, while party level, party size, Access, vendor type, and the selected Level, Quality & Price profile control magical additions.
- Made the resolved mundane catalog the preferred target source for generators and blueprints. Materialization now clones a compatible vendor base rather than searching all enabled source Items independently.
- Rebuilt legacy HAMMER profile snapshots once for the v3 stock architecture while preserving profile IDs, names, selected sources, progression choice, bans, and mechanical-document overrides.
- Made newly duplicated Supplier Profiles fully editable custom copies detached from later preset rebuilds.

### HAMMER profiles and Vendor Access

- Rebuilt Blacksmith with complete party-sized mundane weapons, armor, shields, relevant physical gear, and ammunition, plus separate weighted magical pools for enhancements, named armory Items, and physical wondrous gear.
- Rebuilt Alchemist / Herbalist with party-sized Healer's Kits, Herbalism and Alchemist tools, remedies, reagents, vessels, containers, and field supplies, while preserving one healing-potion slot per party member and thematic magical consumables.
- Rebuilt Magic Assortment with mundane arcane foci and supplies, Spell Scrolls, magical implements, wondrous equipment, low-weight armory curiosities, and Access-weighted relics.
- Applied deterministic party-sized mundane catalogs to Gunsmith, General Trade, and Stable & Livestock.
- Rebalanced Access I–IV as gradual commercial weights: Access I is primarily mundane, Access II has a small special selection, Access III has moderate consistent variety, and Access IV has broad magical and relic access.
- Kept hard Access gates for explicit restrictions, artifacts, and major relics while allowing ordinary rare merchandise to appear below its preferred tier at reduced probability.

### Materialization reliability

- Expanded ammunition recognition across Arrow, Crossbow Bolt, Blowgun Needle, Sling Bullet, and alternate native `loot`, `equipment`, or `consumable` representations.
- Required enhanced ammunition and other synthetic +1/+2/+3 results to retain their concrete name, magical bonus, rarity, magical property, price, and original quantity before being accepted.
- Resolved Armor of Resistance through direct equal-percentage damage-type selection, concrete naming, a single specific resistance Effect, and a cleaned description without the generic RollTable instructions.
- Restricted Armor of Etherealness to Half Plate Armor and Plate Armor targets, rejecting shields and unrelated armor bases.
- Added final target-contract validation and same-rule rerolls for failed generator, blueprint, and synthetic-enhancement slots.
- Normalized selection weights by adaptable family so variant-heavy families do not receive an artificial ticket for every installed concrete document.
- Expanded headless diagnostics with pool stages, generated kinds, rule and Item frequencies, materializer attempts, failures, and rerolls.

### Profiles, sources, and interface

- Preserved intentional source snapshots: Supplier Profiles use the Content Sources enabled when they are created or imported and do not synchronize retroactively.
- Added a source-snapshot notice to the Homebrew Supplier creation flow.
- Added a gear shortcut beside **Supplier Profiles** that opens the selected profile and Level, Quality & Price configuration directly.
- Added **Enhanced item** and **Variant resolved** preview badges alongside the existing generator and blueprint badges.
- Corrected Supplier window icon declarations and strengthened ApplicationV2 header-control icon styling to address missing title and window-control glyphs.
- Kept Foundry VTT `compatibility.verified` at `14.365` and D&D5e compatibility at the tested `5.3.3` baseline.

## 0.2.0a — Beta

### Supplier profile rebuild

- Rebuilt the integrated HAMMER Homebrew vendor presets around two independent layers: Supplier Profile / Vendor Type and Level, Quality & Price progression.
- Added protected built-in `Supplier — Official D&D 2024` and `Supplier — HAMMER Homebrew` progression presets. Either preset can be duplicated into a fully editable custom profile.
- Converted the manual Blacksmith, Herbalist / Alchemist, and Magic Assortment table flows into direct percentages, weighted pools, guarantees, and party-scaled quantities without simulated dice or RollTables.
- Rebuilt Blacksmith stock with guaranteed simple and martial weapon coverage, ranged and two-handed guarantees, light/medium/heavy armor, optional shields, named magic equipment, and enchanted ammunition.
- Rebuilt Alchemist stock with one level-appropriate healing potion per party member, thematic consumable-only random pools, rarity weights by party level, generic-placeholder exclusion, and family repetition limits.
- Rebuilt Magic Assortment with level-band stock totals, party-scaled Scroll and magic Item slots, non-cantrip Scroll limits, and separate restricted-relic weighting.
- Added one-time rebuilding of legacy HAMMER vendor presets while preserving profile IDs, names, source choices, bans, and mechanical-document overrides. Current duplicates remain editable and are not overwritten.

### Access, quantity, and curation

- Added Access IV with a gold visual identity for exceptional vendors and broader access to major relics, artifacts, and tightly restricted merchandise.
- Made Vendor Access a standard editable property of every Supplier Profile, separate from rarity and party-level progression.
- Added per-Item and per-rule minimum/maximum Vendor Access checks. Simpler relics may remain available below Access IV while major relics require higher access.
- Added party-scaled quantities and editable level stock bands. Party level determines power and quality, party size determines quantity, Vendor Access determines commercial reach, and Vendor Type determines thematic stock.
- Added rule-level appearance chance, maximum-per-family limits, and weighted rarity/selection distributions.
- Strengthened family grouping for Feather Tokens, Bags of Tricks, Elemental Gems, resistance families, and other variant families to prevent one family from dominating a stock.
- Added dedicated Alchemist curation that excludes unrelated generic consumables and placeholder documents such as Basic Potion.

### Materialization and generation reliability

- Added strict post-materialization validation so an Item cannot keep generated metadata unless its expected +1/+2/+3 mutation is actually present.
- Corrected ammunition generation so mundane ammunition copies are not marked as generated models and +1/+2/+3 ammunition must retain name, magical bonus, rarity, magical property, and price.
- Resolved Armor of Resistance descriptions at the actual `system.description` Effect change, removing the generic selection table after a damage type is chosen and retaining only the concrete resistance text.
- Preserved the earlier Helm of Brilliance sellable classification, Wand of the War Mage concrete-variant handling, Efreeti Chain base compatibility, canonical names, placeholder cleanup, and duplicate-suffix protection.
- Expanded fallback generation to reroll any failed stock slot from the same eligible rule, including ordinary base Items whose synthetic enhancement fails strict validation.
- Added detailed generation diagnostics and the headless development API `game.itemCreator.auditSupplier({ profileId, level, players, runs })` for repeated previews without creating World Items.

### Interface and compatibility

- Restored a separate GM-only Supplier button to the World Items Directory when Supplier Tools are enabled, using an epic-purple tint.
- Kept Scroll Factory inside the Item Creator start screen because it creates an individual Scroll loot Item rather than a vendor stock.
- Updated the module to `0.2.0a` and Foundry VTT `compatibility.verified` to `14.365` while keeping the existing minimum requirement.

## 0.2.0 — Beta

### Unified module

- Incorporated Supplier as an optional internal Item Creator feature for controlled vendor-stock generation.
- Added a world setting named **Enable Supplier Tools**, disabled by default.
- Hid the Supplier start-screen card and skipped Supplier catalog initialization while the feature is disabled.
- Added **Configure Supplier** inside Item Creator Configuration when Supplier is enabled.
- Kept Scroll Factory inside the Item Creator start screen and initially exposed Supplier through the integrated configuration flow.
- Moved all integrated Supplier settings and flags into the `dnd5e-item-creator` namespace.
- Assigned unique integrated Supplier Application IDs so the development standalone module can remain installed without an Application ID collision.

### Materialization Core

- Moved the Materialization Core into Item Creator as the canonical shared internal library.
- Added a headless `materialize` contract that returns validated Item data and diagnostics without directly creating World documents.
- Exposed the Core through `game.itemCreator.materialization` and the module API.
- Added shared canonical naming and rarity-pricing services used by manual Item creation and Supplier materialization.
- Added Materialization Core version/schema information to Item Creator Configuration and created Items.
- Classified documents as sellable Items, generators, blueprints, variant families, or mechanical documents.
- Added concrete Variant Family handling for Wand of the War Mage +1, +2, and +3 rather than treating the family as an armor blueprint.
- Classified Helm of Brilliance as a self-contained sellable Item even though it contains internal Activities/Effects.
- Matched native D&D5e Enchant restrictions for type, category, properties, and magical-base validation.
- Added focused compatibility resolvers for Efreeti Chain, Armor of Vulnerability, Vorpal weapons, Flame Tongue, Life Stealing, Adamantine Armor, Mithral Armor, and Armor of Resistance.
- Added RollTable selection normalization for damage types and other blueprint choices.
- Added idempotent final-name composition, placeholder rejection, repeated suffix cleanup, and duplicate enhancement cleanup.
- Resolved Item identity changes into concrete Item data before final validation so names, rarity, price, type, and magical bonuses are not applied twice by retained Effects.
- Added ammunition materialization for `consumable`, `loot`, and `equipment` source representations while preserving quantity and ammunition subtype.
- Added readable Supplier price-origin labels for materialized blueprints, concrete variants, and Priceless artifacts.

### Shared rarity pricing

- Added an **Official 2024 Template** with Common 100 GP, Uncommon 400 GP, Rare 4,000 GP, Very Rare 40,000 GP, Legendary 200,000 GP, and Artifact as Priceless.
- Added a **Custom World Values** profile with editable rarity values and denomination.
- Kept the official profile fixed to GP while allowing a custom denomination for custom world values.
- Added Supplier's **Use Materialization Core rarity prices** toggle; disabling it restores Supplier progression-profile fallback values.
- Preserved source-specific official magic Item prices and manual Item Creator price overrides.
- Stored automatic/manual/native price origin in Item Creator flags and displayed final price plus origin in Review.
- Preserved zero-price Priceless artifacts rather than forcing them to 1 GP.

### Item Creator corrections

- Renamed the Weapon Enhancement field to **Weapon Critical Threshold** and clarified that it affects only attacks made with that Weapon.
- Renamed the Granted Effect to **Actor Critical Threshold** and preserved its Actor-wide `Applies To` scope and availability rules.
- Corrected final Rarity persistence through native `system.rarity` for Weapons, Equipment, and Tools.
- Added Rarity and automatic price output to the final native Item data, Review, generated descriptions, and stored pricing metadata.
- Kept Scroll Factory native pricing and native D&D5e Spell Scroll generation unchanged.

### Supplier preservation and refinement

- Preserved Compendium Sources, Supplier Profiles, Homebrew Suppliers, Access Levels, progression profiles, mundane catalog, guaranteed stock, random stock, weighted pools, local curation, bans, mechanical-document policy, output settings, preview, Folder creation, quantity stacking, and generation diagnostics.
- Preserved the approved Access I, Access II, Access III, and Custom visual tags.
- Preserved Blacksmith, Gunsmith, Alchemist / Herbalist, Magic Assortment, General Trade, and Stable & Livestock Homebrew models.
- Expanded ammunition detection and kept firearm ammunition in Gunsmith-oriented pools.
- Added concrete-variant filtering by party progression, allowed rarity, and maximum enhancement.
- Kept Supplier commercial policy separate from the headless Materialization Core.

### Compatibility

- Updated Foundry VTT `compatibility.verified` to `14.365` without raising the module's minimum requirement or adding a maximum.
- Kept D&D5e compatibility declared separately at the tested 5.3.3 baseline.

## 0.1.8e — Beta

- Fixed native Spell Scroll creation failing with `Activity.dnd5escrollspell.spell.level: must be a number`.
- Removed the disabled native level field plus duplicate hidden `level` input used by v0.1.8d.
- Kept the native D&D5e level control enabled for `FormDataExtended` serialization while restricting it to the source Spell's base level.
- Added defensive numeric normalization at D&D5e's pre-create and final Scroll-data hook boundaries, including the embedded Cast Activity level.
- Kept Scroll Factory base-level only; no upcast option is exposed.
- Removed the separate Scroll Factory button from the World Items Directory.
- Added Scroll Factory as an available option beside Weapon, Equipment, and Tool on Item Creator's initial Choose Item Type screen.
- Selecting Scroll Factory exits the standard six-stage draft and opens the dedicated native Scroll flow.
- Preserved `game.itemCreator.openScrollFactory()` for internal integration and supported API access.
- Updated the manifest, documentation, interface version, and release URL for tag `v0.1.8e`.

## 0.1.8d — Beta

- Added a separate GM-only Scroll Factory button to the World Items Directory.
- Added Spell drag-and-drop from compendiums, World Items, and Actor inventories into the Scroll Factory.
- Added native D&D5e Compendium Browser selection restricted to Spell Items.
- Reused D&D5e 5.3.3's native `Item.implementation.createScrollFromSpell` routine rather than recreating Spell Scroll rules or document structure.
- Added the native D&D5e Scroll creation dialog for description detail, Save DC, and Spell Attack Bonus configuration.
- Fixed Scroll creation to the selected Spell's base level; Scroll Factory does not apply upcasting.
- Created confirmed Scrolls directly as World Items instead of owned Actor Items.
- Added protected modal handling around the native Scroll dialog and protected processing during World Item creation.
- Added duplicate-submit protection, invalid-drop validation, cancellation handling, success status, and a shortcut to open the last created Scroll.
- Exposed `game.itemCreator.openScrollFactory()` for the module's own supported UI integration.
- Updated the manifest, documentation, interface version, and release URL for tag `v0.1.8d`.

## 0.1.8c — Beta

- Added complete normalization of Active Effects and Activities when selecting a compendium Base Item or editing an unmanaged World Item. Original embedded mechanics are interpreted as source data rather than copied invisibly into the final Item.
- Added broad Active Effect translation for every compatible Granted Effect currently supported by the Creator, including Armor Class, saving throws, ability checks, skills, ability scores, weapon and spell attacks, weapon damage, Spell Save DC, initiative, proficiency bonus, maximum Hit Points, damage traits, condition immunity, movement, senses, critical threshold, and passive scores.
- Split combined native Effects into independent editable Creator properties. The Cloak of Protection test case now becomes separate `Armor Class Bonus: +1` and `All Saving Throws Bonus: +1` fields instead of retaining one hidden combined Effect.
- Added translation for native string and numeric Active Effect modes and support for paired melee/ranged bonuses, multi-value damage traits, and Fly plus Hover data.
- Added Activity normalization: the primary Weapon Attack is rebuilt as the normalized primary Attack, Cast Activities become Granted Spellcasting entries, and other Activities become Custom Imported Activities.
- Added Custom Imported Effects for unrecognized changes and mixed Effects. Recognized changes are converted while the remaining technical changes are rebuilt in a separate custom Effect so no unknown behavior is lost.
- Added Custom Imported Activity handling with keep, exclude, remove, and technical-data review controls. Activity-to-Effect references are remapped to newly generated normalized Effect IDs.
- Added keep, native-disabled, remove, and technical-data controls for Custom Imported Effects.
- Discarded original source Effects and Activities during the final build and generated fresh normalized embedded documents, preventing silent accumulation between native mechanics and new Creator properties.
- Added conflict protection while editing managed Items: external scalar Effects targeting a Creator property already in use remain explicit custom Effects instead of being silently merged or discarded.
- Added Imported Mechanics summaries to Base Item identity panels and expanded Review to distinguish converted properties, custom imported Effects, custom imported Activities, and newly configured Creator mechanics.
- Added imported recognized and custom mechanics to the generated Item Properties description block. Converted properties can use Unlock on Level and Progression Tiers normally.
- Increased the managed Item draft schema to version 3 and updated the manifest, documentation, interface version label, and release URL for tag `v0.1.8c`.

## 0.1.8b — Beta

- Added character-level Item progression to Weapon, Equipment, and Tool. Every compatible Enhancement, Granted Effect, Additional Damage row, and Granted Spell can now remain fixed or use `Unlock on Level`.
- Uses the Actor's total character level, including multiclass totals. Class-specific levels are never used for Item progression.
- Added replacement progression tiers for Weapon Enhancement, Armor Enhancement, Additional Damage, Spell Attack Bonus, Spell Save DC Bonus, Armor Class Bonus, Weapon Attack Roll Bonus, Weapon Damage Roll Bonus, Initiative Bonus, Proficiency Bonus Modifier, and Maximum Hit Points Bonus.
- Kept progression groups non-stacking: the highest eligible tier replaces earlier tiers in the same group. Independent effects and independent Additional Damage rows continue to stack normally.
- Added dynamic upward and downward reconciliation when Actor level, class levels, Item state, equipment state, Attunement, Actor import, or world load changes the active requirements. No restart or re-equip is required.
- Added structural progression for Weapon magical bonus, attack bonus, damage bonus, critical threshold, extra critical damage, Additional Damage parts, Equipment magical bonus and armor fields, and magical rarity/Attunement state.
- Added level-aware runtime Active Effect mirroring, Granted Spellbook visibility, spell-use validation, Ignore Resistance, and Conditional Advantage.
- Added persistent automatic description sections below the GM's flavor text: fixed mechanics appear under `Item Properties`, and evolving mechanics appear under `Level Progression` using entries such as `[Level 3 — +1 to attack rolls]`.
- Generated description sections are replaced on edit instead of duplicated, and disabled properties are removed from the generated text.
- Added Level Progression counts to the draft sidebar and Review summary.
- Removed generic Consumable creation from the Item Creator scope. The supported creator types are Weapon, Equipment, and Tool; the planned Scroll Factory remains a separate future tool.
- Increased the managed Item draft schema to version 2 and updated the manifest, documentation, interface version label, and release URL for tag `v0.1.8b`.

## 0.1.8a — Beta

- Added the complete Tool creation and editing flow using the shared Item Type → Base Item → Enhancements → Granted Effects → Description → Review workflow.
- Added native Tool base fields for category, base tool, default ability, proficiency handling, Tool Check Bonus formula, quantity, weight, price, and Tool-valid properties.
- Added selection from configured Tool compendiums, native D&D5e Compendium Browser support, and a Custom Tool shell.
- Added automatic native Check Activity creation when a Tool template has no Tool Check Activity.
- Kept Tools type-safe: no Attack Activity, weapon damage, Weapon Enhancement, Mastery, weapon properties, range, Armor Enhancement, or armor calculation fields are exposed.
- Added Magical Tool with rarity and optional Attunement. It never grants a weapon or armor enhancement bonus.
- Added Granted Spellcasting to Tools, including automatic magical status without automatic Attunement or numeric enchantment.
- Added the full Actor-facing Granted Effects library to Tools with Owned, Equipped, and Equipped and Attuned availability.
- Added global Weapon Attack Roll Bonus and Weapon Damage Roll Bonus Granted Effects for any supported Item type. These affect the Actor's melee and ranged weapon rolls while active, not the Tool's own check.
- Added Tool support to runtime effect reconciliation, granted spellbook visibility, Ignore Resistance, Conditional Advantage, world-item editing, Update Item, and Save as Copy.
- Added Tool support to the shared type-agnostic Icon Selection catalog.
- Preserved the intentionally simple runtime model: narrative conditions are controlled manually through Item availability; no context-specific weapon, Bardic Inspiration, or per-Activity automation is added.
- Updated manifest, documentation, interface version label, and versioned download URL for tag `v0.1.8a`.

## 0.1.8 — Beta

- Fixed the Equipment Icon Selection browser returning an empty `0 / 0` catalog.
- Reused the same type-agnostic icon catalog already available to Weapon so Weapon and Equipment can select any indexed Item icon from active compendiums.
- Preserved icon search by source Item name, compendium filtering, selected-icon preview, modal interaction protection, and custom icons already assigned to the Item.
- Automatically marks a Weapon or Equipment as magical when its first Granted Spellcasting entry is added.
- Kept numeric Weapon or Armor Enhancement bonuses independent; automatic magical status does not apply `+1`, `+2`, or `+3`.
- Kept Attunement independent; automatic magical status leaves Attunement as `None` unless the GM explicitly changes it.
- Prevented Magical Weapon or Magical Equipment from being disabled while Granted Spellcasting still contains Spells.
- Removed an automatically applied magical state when the last granted Spell is removed, while preserving magical status when the GM selected or edited it manually.
- Set generated Cast Activities to `visibility.requireMagic: false` so native D&D5e visibility does not conflict with Item Creator's `Owned`, `Equipped`, and `Equipped and Attuned` rules.
- Added runtime migration for managed world Items and Actor Item copies created before v0.1.8, restoring the magical property and removing the obsolete native magic-visibility gate.
- Updated manifest, documentation, interface version label, and versioned download URL for tag `v0.1.8`.

## 0.1.7 — Beta

- Added the complete assisted Equipment creation flow using the existing Item Type, Base Item, Enhancements, Granted Effects, Description, and Review stages.
- Enabled Equipment selection through the native D&D5e Compendium Browser, configured manual source lists, and a custom Equipment shell.
- Added Equipment forms for Armor, Shield, Torso / Robe, Cloak / Mantle, Headwear, Neck / Amulet, Hands / Gloves, Finger / Ring, Feet / Boots, Waist / Belt, Focus / Catalyst, Accessory, and Other Equipment.
- Kept robes and caster clothing as non-armor Equipment without Light Armor or other Armor Training requirements.
- Added native Equipment fields for D&D5e equipment classification, quantity, weight, price, armor values, Dexterity contribution, Strength requirement, proficiency, focus, and supported Equipment properties.
- Added Equipment-specific Enhancements for Magical Equipment, Armor Enhancement, Base Armor Class override, removing Strength requirements, and removing Stealth Disadvantage.
- Filtered Weapon-only attack, damage, range, Mastery, and weapon-property Enhancements out of the Equipment flow.
- Reused the complete Granted Effects library for Equipment and added Actor-level Critical Hit Threshold for weapon attacks, spell attacks, or all attacks.
- Enabled Granted Spellcasting for Equipment using existing Spell documents with independent uses, recovery, slot consumption, cast level, spellcasting calculation, Spellbook visibility, and availability.
- Extended runtime spellbook reconciliation, Active Effect mirroring, Ignore Resistance, and Conditional Advantage to managed Equipment Items.
- Added `Edit with Item Creator`, `Update Item`, and `Save as Copy` support for world Equipment Items while preserving unrecognized Activities, Effects, system data, and third-party flags.
- Reduced the Item Type screen to the definitive scope: Weapon, Equipment, Consumable, and Tool. Removed Container, Loot, Spell, and Feature creation from the module scope.
- Preserved all v0.1.6 native Weapon-import and deterministic Attack-damage corrections.
- Updated manifest, documentation, interface version label, and versioned download URL for tag `v0.1.7`.

## 0.1.6 — Beta

- Fixed native D&D5e and earlier homebrew Weapon import incorrectly treating the prepared base-damage part as Item Creator Additional Damage.
- Read Attack Activity damage from the unprepared source data so `includeBase` no longer produces a false extra damage row.
- Rebuilt imported primary Attack damage deterministically instead of preserving old managed parts and appending them again on each update.
- Removed disabled Additional Damage overrides from the saved draft and from future Item builds.
- Added backward repair for the v0.1.5 self-import signature, including false base-damage copies and accumulated duplicate damage parts.
- Preserved legitimate additional Attack Activities, Cast Activities, Active Effects, and unrelated external Item data during repair.
- Added an imported-Item marker to keep future edits on the safe interpreted-edit path.
- Updated manifest, documentation, interface version label, and versioned download URL for tag `v0.1.6`.

## 0.1.5 — Beta

- Added the GM-only `Edit with Item Creator` context-menu action for Weapon Items in the world Items Directory.
- Reused the existing Item Creator creation workflow for editing; no separate import or edit screen was introduced.
- Restored full saved drafts for Items originally created by Item Creator, including Template, Base Weapon, overrides, Enhancements, Granted Spellcasting, Granted Effects, availability, icon, name, and custom Description.
- Added interpreted import for native D&D5e and earlier homebrew Weapon Items using their current world-document data.
- Imported supported core weapon fields, additional Attack Activity damage parts, magical bonus, rarity, attunement, attack bonus, critical threshold, extra critical damage, linked Cast Activities, and recognized Active Effects.
- Preserved unrecognized Activities, Active Effects, system data, and third-party module flags when editing imported Items.
- Preserved additional Attack Activities on imported Items while rebuilding only the primary weapon Attack Activity managed by the editor.
- Added protected `Update Item` and `Save as Copy` actions to Review.
- `Update Item` keeps the original world Item ID, folder, ownership, and sort position; existing Actor copies are not automatically replaced.
- `Save as Copy` creates a new world Item in the original folder while leaving the source Item unchanged.
- Added explicit Activity and Active Effect replacement during updates so removed or changed configuration does not leave stale embedded data.
- Added best-effort transactional rollback if updating the Item or rebuilding its embedded Activities or Active Effects fails.
- Documented which native Item mechanics remain usable without the module and which conditional runtime mechanics require Item Creator to stay active.
- Updated manifest, documentation, interface version label, and versioned download URL for tag `v0.1.5`.

## 0.1.4 — Beta

- Added runtime reconciliation for granted Spellbook entries so `Owned`, `Equipped`, and `Equipped and Attuned` availability is enforced in the Actor spellbook.
- Conditional granted Spells now remain hidden while their source weapon is inactive and become visible automatically when that exact Actor Item copy is equipped or equipped and attuned.
- Preserved native D&D5e cached linked Spells and Cast Activity use counters, preventing equip/unequip cycles from resetting limited uses.
- Added per-Activity `showInSpellbook` intent flags so visibility state is separate from the GM's permanent configuration choice.
- Added backward reconciliation for v0.1.3 and older Item Creator weapons by recovering spellbook intent from stored granted-Spell configuration.
- Kept duplicate weapon copies independent through D&D5e's native `cachedFor` Activity linkage; changing one copy does not activate or hide another copy's granted Spells.
- New conditional Cast Activities start hidden in world Items and are activated only by runtime availability on an Actor.
- Retained the v0.1.3 native Description editor and automatic Item Properties / Granted Spellcasting description builders.
- Updated manifest, documentation, interface version label, and versioned download URL for tag `v0.1.4`.

## 0.1.3 — Beta

- Rebuilt the customized Description editor through Foundry's native `HTMLProseMirrorElement.create` lifecycle instead of relying on declarative custom-element initialization inside the Item Creator template.
- Removed the invisible interaction mask affecting the rich-text surface and forced the initialized editable body to remain visible, selectable, focusable, scrollable, and above non-interactive editor layers.
- Added reliable handling for the native editor `open` lifecycle, delayed internal DOM creation, and Shadow DOM or light-DOM editing surfaces.
- Preserved the complete original Template HTML as the starting text and retained all native Foundry formatting tools for flavor text.
- Added an automatic English `Item Properties` description builder for enabled Base Item damage additions, Enhancements, advanced combat behaviors, and all Granted Effects.
- Organized generated Item Properties into compact two-column groups by activation condition: Weapon Properties, While Owned, While Equipped, and While Equipped and Attuned.
- Added responsive one-column fallback for narrow Item sheets and chat cards.
- Added a compact Item Properties summary to `system.description.chat`, alongside the existing Granted Spellcasting summary.
- Kept generated sections idempotent so Review and Save rebuilds never duplicate Item Properties or Granted Spellcasting text.
- Updated manifest, documentation, interface version label, and versioned download URL for tag `v0.1.3`.

## 0.1.2 — Beta

- Fixed the native ProseMirror editing surface so Template and custom Description text remains legible against the Item Creator dark background, including a visible caret and inherited Foundry text variables.
- Preserved GM-selected inline text colors while providing a readable default color for unstyled rich-text content.
- Added an automatic English `Granted Spellcasting` rules-text builder based on each Spell's availability, use limit, recovery, Spell Slot consumption, casting eligibility, cast level, spellcasting calculation, and spellbook visibility.
- Added full generated Granted Spellcasting rules to `system.description.value` so the Item sheet and Review explain exactly how every granted Spell works.
- Added a compact generated Granted Spellcasting summary to `system.description.chat` so linked Item cards in chat expose the Spell name, activation availability, uses, recovery, and Spell Slot behavior.
- Added support for multiple granted Spells with independent generated text and idempotent generated sections that do not duplicate across Review or Save rebuilds.
- Added Foundry UUID references for granted Spell names in generated descriptions.
- Normalized the normal Weapon Attack Activity so it never consumes a Spell Slot or retains `spellSlots` consumption targets inherited from a special Template. Cast Activities retain their independently configured Spell Slot behavior.
- Updated manifest, documentation, interface version label, and versioned download URL for tag `v0.1.2`.

## 0.1.1 — Beta

- Fixed the Description editor so enabling `Customize Description` loads the complete original Template HTML into Foundry's native ProseMirror editor.
- Corrected the ProseMirror field path to `system.description.value` and added reliable capture of edited HTML before navigation, Review, and Save.
- Fixed restoration checks so an untouched original Template description is not incorrectly treated as a manual edit.
- Removed the duplicate D&D5e Item preparation that caused `Cannot redefine property: _index` during Review.
- Isolated provisional Cast Activity construction from the final Item source to prevent D&D5e preparation from mutating and reusing Activity arrays.
- Added recursive removal of transient `_index` properties before temporary Item construction, preview serialization, and final creation data.
- Restored native chat-card and inventory Review previews for PHB 2024, Monster Manual 2024, and other Weapon Templates.
- Restored `Save Item`, protected confirmation, and final world Item creation after a successful Review build.
- Updated manifest, documentation, interface version label, and versioned download URL for tag `v0.1.1`.

## 0.1.0 — Beta

- Promoted the module from Alpha draft validation to the first complete Weapon creation Beta.
- Updated `Customize Description` so Foundry's native rich-text editor starts with the complete original Template HTML, while inherited preview mode remains conservatively cleaned.
- Enabled the final `Review` stage after Description.
- Added a native D&D5e item chat-card preview built from a temporary validated Weapon document.
- Added a compact inventory-style preview with icon, final name, rarity, attunement, damage, properties, Activities, and generated effect count.
- Added a final configuration summary for Template, Base Weapon, name, overrides, Enhancements, granted Spells, Granted Effects, and Description source.
- Added final Item assembly using the physical Base Weapon, special Template, GM overrides, Enhancements, granted Spell Cast Activities, Granted Effect blueprints, and source metadata.
- Added native Attack Activity generation with base damage, extra damage parts, attack and damage bonuses, critical threshold, and extra critical damage.
- Added linked native Cast Activities for granted Spells with configured uses, recovery, slot consumption, cast level, spellcasting calculation, spellbook visibility, and availability flags.
- Added Active Effect blueprint generation for the approved Granted Effects.
- Added runtime Actor-effect mirroring for Item Creator weapons according to Owned, Equipped, or Equipped and Attuned availability.
- Added protected `Confirm Item Creation` with OK and Cancel, background interaction blocking, duplicate-submit prevention, and a blocking `Creating Item…` processing overlay.
- Added final creation of the validated Weapon in the world Items Directory.
- Updated interface stage labels, manifest, documentation, and versioned download URL for tag `v0.1.0`.

## 0.0.3 — Alpha

- Marked the visually validated Granted Effects stage as complete for the current draft workflow.
- Grouped the manual Template dropdown by configured content-source priority using native source sections.
- Sorted Template names alphabetically inside each source section while preserving the native D&D5e Compendium Browser as the primary discovery method.
- Grouped the Base Weapon dropdown by configured content-source priority and sorted physical weapons alphabetically inside each source section.
- Expanded the manual Template index to include all Weapon documents from active sources, while the Base Weapon selector remains restricted to valid mundane physical weapons.
- Enabled the `Description` stage after a valid Granted Effects draft.
- Inherited Description content exclusively from the selected special Template; the Base Weapon never contributes description text.
- Added conservative cleanup of recognized leading Template metadata such as generic weapon applicability, rarity, attunement, and template-application instructions.
- Preserved mechanical rules, narrative text, tables, lists, document links, and Foundry-enriched HTML whenever they are not recognized metadata.
- Added checkbox-gated `Customize Description` using Foundry's native ProseMirror editor.
- Added protected restoration of the cleaned Template description when custom text would be discarded.
- Added automatic Description replacement when the Template changes, while Base Weapon changes leave Description untouched.
- Kept Review, final Item creation, Activity generation, Active Effect generation, and runtime execution locked for later builds.
- Updated manifest, documentation, interface scope text, and download URL for tag `v0.0.3`.
- No Item creation or mutation is performed in this Alpha.

## 0.0.2a — Alpha

- Enabled the `Granted Effects` stage after a valid Enhancements draft.
- Added checkbox-gated cards for Armor Class, Saving Throw bonuses and Advantage, Ability Score adjustments, Ability Check bonuses and Advantage, Skill bonuses, Skill Proficiency or Expertise, and passive-score bonuses.
- Added one-click `All Saving Throws`, `All Ability Checks`, and `All Skills` selections while retaining specific ability or skill targeting.
- Added Damage Resistance, Damage Immunity, Damage Vulnerability, and Condition Immunity with dynamic D&D5e type lists.
- Added Initiative bonus and Advantage, Maximum Hit Points bonus, and an explicitly marked advanced global Proficiency Bonus modifier.
- Added Movement bonuses, granted movement types with optional Hover, and granted senses with minimum, additive, or fixed range operations.
- Added global Spell Attack Bonus and Spell Save DC Bonus effects.
- Added manual positive or negative numeric values, multiple independently removable rows, and Owned, Equipped, or Equipped and Attuned availability for every effect family.
- Added validation and red invalid states for enabled but incomplete Granted Effect cards.
- Added cascading cleanup when any Granted Effect checkbox is disabled.
- Added Granted Effect count to Current Draft and protected Template reset cleanup.
- Kept Description, Review, final Item creation, Active Effect generation, and runtime execution locked for later builds.
- Updated manifest, documentation, interface scope text, and download URL for tag `v0.0.2a`.
- No Item creation or mutation is performed in this Alpha.

## 0.0.2 — Alpha

- Added a full-width, checkbox-gated `Granted Spellcasting` Enhancement card.
- Added support for multiple independently configured Spells on the same Weapon draft.
- Added Spell selection through the native D&D5e Compendium Browser locked to Spell Items.
- Added drag-and-drop support for Spell Items from compendiums and the Item directory.
- Added duplicate-spell prevention and removal controls.
- Added Unlimited or Limited use modes, configurable maximum uses, and Short Rest or Long Rest recovery.
- Added optional compatible spell-slot consumption; Cantrips cannot consume slots.
- Added casting eligibility modes for independent item casting, spell-level access, or compatible spell-slot access.
- Added Base Spell Level, Fixed Higher Level, and selected Spell Slot casting-level modes.
- Added Actor Default Spellcasting, Highest Spellcasting, Intelligence/Wisdom/Charisma + Proficiency, and Fixed Item Spellcasting Values.
- Added fixed Spell Attack Bonus and Spell Save DC fields when the linked Spell uses those mechanics.
- Added optional spellbook display and availability while Owned, Equipped, or Equipped and Attuned.
- Added per-Spell validation and visual invalid states.
- Added cascading cleanup when Granted Spellcasting is disabled.
- Updated manifest, documentation, interface scope text, and download URL for tag `v0.0.2`.
- No Item creation or mutation is performed in this Alpha.

## 0.0.1e — Alpha

- Marked the Base Item stage as the approved foundation and enabled the Enhancements stage in the sidebar and navigation flow.
- Added eight checkbox-gated Enhancement cards using the same enable, disable, validation, and cascading-cleanup philosophy as Base Item.
- Added optional Magical Weapon configuration with D&D5e rarity and attunement selections.
- Added Weapon Enhancement +1, +2, and +3, with the draft treated as magical whenever this option is active.
- Added independent Additional Attack Bonus and Additional Damage Bonus controls.
- Added Critical Hit Threshold configuration for 20, 19, 18, or a custom value.
- Added typed Extra Critical Damage with dice count, die denomination, and D&D5e damage type.
- Added Ignore Damage Resistance with multiple selectable D&D5e damage types and an explicit Item Creator Runtime support badge; immunity is not bypassed.
- Added Conditional Advantage with supported runtime conditions or custom descriptive rule text.
- Added validation and red invalid states for incomplete enabled Enhancement cards.
- Added immediate cleanup when any Enhancement checkbox is disabled.
- Added Enhancement count to Current Draft and protected Template replacement cleanup for all Enhancement selections.
- Kept Granted Effects, Description, Review, and final Item creation locked for later Alpha builds.
- Updated manifest and documentation for tag `v0.0.1e`.
- No Item creation or mutation is performed in this Alpha.

## 0.0.1d — Alpha

- Simplified Content Sources from per-compendium selection to one row per complete source, such as SRD 5.1, SRD 5.2 Modern, Player's Handbook 2024, Dungeon Master's Guide, and Monster Manual.
- Automatically includes all compatible internal Item compendiums from an enabled source according to the Item type being created.
- Replaced the duplicated priority and compendium-selection panels with one compact, scrollable source list.
- Kept source activation and Up/Down priority controls in the same row, with search, Select All, Clear, fixed header, and fixed footer.
- Added automatic migration from the previous `enabledPacks` / `packOrder` settings to package-level `enabledSources` / `sourceOrder`.
- Preserved the native D&D5e Compendium Browser as the approved Template selector for Weapon and future Item types.
- Separated the special Template from the physical Base Weapon in the Base Item draft.
- Added a `Customize Base Weapon` checkbox and Base Weapon dropdown in the Core Weapon Configuration header.
- Automatically resolves a valid Template `baseItem` identifier to a mundane Base Weapon from active sources.
- Forces Base Weapon selection and blocks Base Item completion when a Template does not provide a valid Base Item.
- Core inherited fields now come from the selected Base Weapon while the selected Template remains available as the special item model.
- Added protected Base Weapon replacement with confirmation when existing core overrides would be discarded.
- Updated manifest and documentation for tag `v0.0.1d`.
- No Item creation or mutation is performed in this Alpha.

## 0.0.1c — Alpha

- Replaced the custom Weapon Template Browser with the native D&D5e Compendium Browser.
- The native browser opens in single-selection mode and is locked to Item documents of type `weapon`.
- Preserved native D&D5e search, Weapon filters, Mastery, rarity, properties, source filters, result rendering, and compendium behavior.
- Kept the manual Weapon Type and Template dropdowns as the fast-selection alternative.
- Added validation that the browser result is an Item document of type Weapon before loading it into the Base Item draft.
- Allowed native-browser Weapon templates to load even when they are not present in the compact manual template index; only core weapon fields are inherited into Base Item.
- Removed the obsolete custom Template Browser application and template from the distributed module.
- Fixed Content Sources so its center section has an independent vertical scrollbar while the header, controls, summary, and footer remain visible.
- Preserved Content Sources scroll position while enabling sources, changing priority, and expanding or collapsing source groups.
- Updated manifest and documentation for tag `v0.0.1c`.
- No Item creation or mutation is performed in this Alpha.

## 0.0.1b — Alpha

- Replaced the main Template text-search field with a prominent `Browse Weapon Templates` button.
- Added a separate modal Weapon Template Browser with search, Weapon Type filter, Compendium filter, source-priority grouping, preview, Cancel, and `Select Base Item`.
- Preserved the manual Weapon Type and Template dropdowns for fast selection without opening the browser.
- Added confirmation before replacing a template when the current Base Item contains a changed name or enabled overrides.
- Rebuilt icon customization as a reusable modal `Icon Selection` browser filtered to the current Item type.
- Added compact, uniformly framed square icon cells, source filtering, search, preview, Cancel, and `Use Selected Icon`.
- Added optional Additional Damage configuration directly below Base Damage.
- Added support for multiple typed damage parts, each with dice count, die denomination, D&D5e damage type, and optional Attack Ability, Spellcasting Ability, or explicit ability modifier.
- Added cascading cleanup for Additional Damage and per-row ability modifiers.
- Added an Active Source Priority list to Content Sources settings with Up/Down controls.
- Applied configured compendium priority to manual Template options, Template Browser groups, and Icon Selection results.
- Preserved named, collapsible source groups and global Expand All / Collapse All controls.
- Kept Content Sources exclusively in Foundry Module Settings.
- Updated manifest and documentation for tag `v0.0.1b`.
- No Item creation or mutation is performed in this Alpha.

## 0.0.1a — Alpha

- Replaced the Base Item compendium browser with a template-driven creation form.
- Removed all Content Sources controls from the Item Creator main window. Sources are now managed only through Foundry Module Settings.
- Added template search, weapon-type filtering, and a compact weapon template dropdown.
- Added automatic inheritance of template name, icon, category, attack type, attack ability, proficiency handling, base damage, damage type, range, properties, Mastery, weight, price, quantity, versatile damage, and ammunition type.
- Added checkbox-gated customization for every core weapon field.
- Added cascading cleanup: disabling a customization immediately discards its override and restores the source value.
- Added a dedicated `Customize Icon` checkbox before the icon browser can be opened.
- Added physical weapon-property customization while keeping magical configuration out of Base Item.
- Added dependent Versatile Damage and Ammunition Type fields when their properties are present.
- Added scroll-position preservation for template selection, checkbox changes, property changes, and icon selection.
- Grouped Content Sources by named source inside Module Settings, with per-group collapse controls and a global Collapse All / Expand All button.
- Updated the release version and download URL to tag `v0.0.1a`.
- No Item creation or mutation is performed in this Alpha.

## 0.0.1-alpha

- Changed the install package URL to the version-specific GitHub Release tag (`v0.0.1-alpha`).
- Added GM-only Item Creator entry button to the Items Directory.
- Added initial ApplicationV2 shell and Character Builder-aligned visual identity.
- Added Item Type selection with Weapon available and future types locked.
- Added Base Item step with active compendium discovery.
- Added GM Content Sources settings.
- Added weapon source browsing, preview, inherited mastery display, editable draft name, and deduplicated icon browser.
- Corrected the selected icon control to remain an exact square, including its border, regardless of Foundry button and image styles.
- Corrected the base weapon rows so icons, text, selection backgrounds, and adjacent entries remain fully contained without overlap.
- Rebuilt the icon browser as a compact grid of uniformly framed square icons.
- Replaced generic D&D5e package headings with content-source names such as `SRD 5.1`, `SRD 5.2 Modern`, `Player's Handbook 2024`, `Dungeon Master's Guide`, and `Monster Manual`.
- Grouped compendiums beneath their content source and added per-source collapse controls plus a global Collapse All / Expand All control.
- Added the official project repository, manifest, and release download addresses.
- Established `item-creator.zip` as the canonical installable package and added the GitHub release guide and automated release workflow.
- No Item creation or mutation is performed in this Alpha.
