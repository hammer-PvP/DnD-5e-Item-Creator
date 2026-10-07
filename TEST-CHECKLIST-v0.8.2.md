# Item Creator v0.8.2 — Supplier Test Checklist

This is a candidate build. The checklist is focused on the Supplier patch only.

## Crafting Core integration

- [ ] Start with `dnd5e-crafting-core` disabled. Supplier still opens and ordinary profiles generate normally.
- [ ] Enable Crafting Core v0.5.10 and confirm the Profile Builder reports Products, Materials, and Learn Sources as detected.
- [ ] Blacksmith Homebrew profile exposes curated smithing/equipment content and only Equipment Blueprints as Crafting Core knowledge.
- [ ] Alchemist Homebrew profile exposes curated alchemy stock and only Alchemy Recipes as Crafting Core knowledge.
- [ ] Herbalist Homebrew profile exposes botanical Materials and does not generate Recipes by default.
- [ ] Tavern Homebrew profiles expose culinary Products/Materials and only Culinary Recipes.

## Recipe / Blueprint availability

- [ ] Homebrew default is 50% chance, 1–2 Recipes on success, 50% Product price.
- [ ] A failed availability roll produces 0 Recipes.
- [ ] A successful roll produces 1 or 2 distinct Recipes, never duplicate copies of the same Recipe in one vendor.
- [ ] Low-level parties cannot receive Recipes whose Product rarity is outside the active progression band.
- [ ] Repeat at representative party levels (for example 3, 7, 12, 17) and verify the candidate rarity pool follows Level, Quality & Price.
- [ ] Recipe price equals 50% of the matching curated Product price (or the configured percentage).
- [ ] Changing Recipe chance/min/max/price percentage in the Profile changes generation without modifying Crafting Core documents.

## Guaranteed consumable budget

- [ ] Homebrew Alchemist, Party Size 8: Healing Potions by Level total exactly 8 units when at least one potion is eligible.
- [ ] The eight units may be distributed across multiple eligible potion tiers; repeated tiers consolidate into stacks.
- [ ] Party Size 4 totals exactly 4 eligible healing potions.
- [ ] Level gating occurs before distribution, so an ineligible potion tier never receives units.
- [ ] A custom Guaranteed rule left on `Per Eligible Item (Legacy)` keeps the prior behavior.
- [ ] A custom Guaranteed rule changed to `Party Total Budget` uses Party Size as the total budget.

## World Item organization

- [ ] First Supplier generation creates/reuses root Item folder `Suprimentos`.
- [ ] `Suprimentos` uses `#9b9ee8`.
- [ ] Generated vendor folders are children of `Suprimentos` and use the same purple color.
- [ ] Generation cleanup after an error removes only the failed vendor folder, not the shared `Suprimentos` root.

## Regression

- [ ] Supplier Preview and real generation agree on item counts.
- [ ] Scroll stock still generates normally.
- [ ] Existing Materialized Stock rules still work.
- [ ] Firearm normalization behavior is unchanged.
- [ ] Profiles with Crafting Core integration disabled do not receive Crafting Core packs implicitly.
