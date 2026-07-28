# Changelog

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
