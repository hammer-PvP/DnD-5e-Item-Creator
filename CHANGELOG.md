# Changelog

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
