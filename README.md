# Item Creator v0.8.5 — Release Candidate

## Installation

The release archive `item-creator-v0.8.5.zip` contains the installable `item-creator.zip` and a standalone `module.json`. Publish these two files as GitHub Release assets for tag `v0.8.5`; use the manifest URL in `module.json` for installation. Do not extract the outer release ZIP as a Foundry module.

## What changed

- A shared Item Uses pool can now be configured in Item Creator: maximum charges and formula-based recovery including Dawn.
- Each Granted Spell or supported composed Activity can select **No Charge**, **Shared Item Charges**, or **Separate Charges**, with individual consumption cost; separated Activities have their own maximum and recharge.
- Depletion behavior can be set on the global Item pool and on separated Activities: **Nothing**, **Destroy**, or **Conditional Test** (raw d20 target, ability/skill/tool check with DC). The trigger fires only when an owned Actor Item transitions from positive remaining uses to zero.
- Source priority now selects one canonical representation of an equivalent document before classifying it as an enchantment template or finished Item. Lower-priority documents do not supply mechanics to the winning version.
- Materialization recognizes explicit native `@UUID` references to eligible bases in an enchantment item's initial classification and preserves effects referenced transitively by Rider Activities, with safe rejection of incompatible bases.

## Status and limitations

This is a **release candidate**, validated with static checks and isolated mock tests, not yet confirmed by live Foundry QA. The sample Oathbow template from DMG was materialized in a headless test with a Longbow and preserved its Swear Oath activity and dependent Sworn Enemy effect. The test does not prove the entire oath mechanics run automatically in a live world.

Depletion applies to Actor-owned Items with valid ownership and confirmed consumption. GM review is needed where no actor/permissions exist or an unsupported check cannot be rolled. Tool check modifiers should be tested against the actual system Actor schemas.

This release does **not** redesign the large Compendium Sources screen. The separately tracked Published Item Edit/Save data-integrity issue is also not resolved by this patch. The v0.8.4 global firearms policy and Supplier knowledge rotation are preserved.
