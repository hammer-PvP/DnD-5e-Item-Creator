import { MODULE_ID } from "../constants.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const GUIDE_SECTIONS = Object.freeze([
  {
    id: "workflow",
    title: "Spell Factory Workflow",
    icon: "fa-diagram-project",
    intro: "Spell Factory manages a safe authoring workflow. The native D&D5e Spell sheet remains the mechanical editor.",
    entries: [
      {
        title: "Blank Spell vs. Blueprint",
        where: "Spell Factory → New Spell",
        body: "Blank Spell starts from a minimal native Spell5e document. Blueprint clones an existing Spell into an independent protected draft. The source Spell is never modified.",
        examples: [
          { code: "Fireball → Blueprint → rename → change fire to cold → Publish", note: "Creates a new homebrew Spell without touching Fireball." }
        ]
      },
      {
        title: "Draft vs. Published Spell",
        where: "Spell Factory → Draft Workspace / Published Spells",
        body: "A draft is temporary work-in-progress stored in the internal draft compendium. Published Spells is the canonical homebrew library. Editing a published Spell creates a protected draft first; the canonical Spell changes only after Update Published."
      }
    ]
  },
  {
    id: "basics",
    title: "Spell Basics",
    icon: "fa-book-open",
    intro: "The Spell document owns level, school, casting method, preparation, description, and other top-level data.",
    entries: [
      {
        title: "Spell Level",
        where: "Edit Spell → Spell details → Level",
        body: "This is the base level of the Spell. A 2nd-level Spell has a base spell level of 2. Higher-level casting is configured through the Activity scaling/consumption controls, not by changing the base level."
      },
      {
        title: "School",
        where: "Edit Spell → Spell details → School",
        body: "Choose the native D&D5e school (Abjuration, Conjuration, Divination, Enchantment, Evocation, Illusion, Necromancy, or Transmutation). Published Spells are organized by this value."
      },
      {
        title: "Spellcasting Ability",
        where: "Edit Spell → Spell details / Activity ability controls",
        body: "When an Activity uses the Spell's casting ability, D&D5e resolves the caster's configured ability automatically. In Activity roll formulas that resolved ability modifier is exposed as @mod."
      }
    ]
  },
  {
    id: "activities",
    title: "Activities",
    icon: "fa-bolt",
    intro: "Activities are the executable parts of a Spell. A Spell can contain one or more native Activities such as Damage, Heal, Save, Attack, Utility, Summon, Teleport, Transform, or Enchant.",
    entries: [
      {
        title: "Activity Name",
        where: "Edit Spell → Activities → open the Activity → Identity",
        body: "The Activity name is independent from the Spell name. Rename it when a Spell has multiple actions or when a cloned blueprint still carries the original Activity name."
      },
      {
        title: "Activation",
        where: "Edit Spell → Activity → Activation",
        body: "Configure how the Activity is used: Action, Bonus Action, Reaction, and other native activation types. Keep this on the Activity because different Activities on the same Spell may use different activations."
      },
      {
        title: "Multiple Activities",
        where: "Edit Spell → Activities",
        body: "Use multiple Activities when the Spell genuinely has multiple executable actions. Do not force unrelated mechanics into one formula when native Activities represent them more clearly."
      }
    ]
  },
  {
    id: "damage-healing",
    title: "Damage & Healing",
    icon: "fa-heart-pulse",
    intro: "Damage and Heal Activities use native D&D5e dice/formula fields and can scale when cast at higher levels.",
    entries: [
      {
        title: "Add the Activity Ability Modifier",
        where: "Edit Spell → Damage/Heal Activity → Bonus or formula field",
        body: "Use @mod. D&D5e replaces @mod with the ability modifier used by that Activity. You do not type the numeric modifier yourself.",
        examples: [
          { code: "4d8 + @mod", note: "If the resolved ability is Intelligence 18, @mod is 4, so the roll is 4d8 + 4." },
          { code: "@mod + 1", note: "With the same +4 modifier, this resolves to 5." },
          { code: "2 * @mod", note: "With +4, this resolves to 8." }
        ]
      },
      {
        title: "Damage Type",
        where: "Edit Spell → Damage Activity → Damage part",
        body: "Choose the native damage type on the damage part. When cloning a blueprint, changing Fire to Cold here changes the mechanical damage type rather than only changing the description."
      },
      {
        title: "Healing Type",
        where: "Edit Spell → Heal Activity → Healing",
        body: "Use the native healing configuration for normal healing, temporary hit points, or other healing modes exposed by D&D5e. Keep the formula in the native Heal Activity so scaling and roll data remain system-owned."
      }
    ]
  },
  {
    id: "scaling",
    title: "Scaling & Upcasting",
    icon: "fa-arrow-up-right-dots",
    intro: "D&D5e exposes scaling data to Activities. @scaling starts at 1 for the first scaling stage and @scaling.increase is the number of scaling steps above baseline.",
    entries: [
      {
        title: "Higher-Level Dice Scaling",
        where: "Edit Spell → Damage/Heal Activity → Scaling",
        body: "For a Spell that gains one extra die per higher spell level, configure the base dice on the Activity and add one die for each scaling step. The Spell's top-level Level remains its base level.",
        examples: [
          { code: "Base Spell Level: 2 | Base Healing: 4d8 + @mod | Dice Scaling: +1d8 per level", note: "2nd: 4d8 + @mod; 3rd: 5d8 + @mod; 4th: 6d8 + @mod." }
        ]
      },
      {
        title: "@scaling",
        where: "Formula fields evaluated with Activity roll data",
        body: "@scaling is the scaling value beginning at 1. Use it only when a formula should depend on the scaling stage itself.",
        examples: [
          { code: "2 * @scaling", note: "At the first scaling stage this is 2; at the second it is 4." }
        ]
      },
      {
        title: "@scaling.increase",
        where: "Formula fields evaluated with Activity roll data",
        body: "@scaling.increase is the number of scaling steps above the baseline. It is 0 at baseline, 1 at the first increase, 2 at the second increase, and so on.",
        examples: [
          { code: "5 * @scaling.increase", note: "Adds 0 at baseline, 5 after one scaling step, 10 after two steps." }
        ]
      },
      {
        title: "Effective Spell Level",
        where: "Activity roll data",
        body: "@item.level represents the effective Spell level available to the Activity roll data. For a scaled Spell use, D&D5e raises this value from the base level to the level used for that activation.",
        examples: [
          { code: "@item.level * 2", note: "A 4th-level use resolves this portion to 8." }
        ]
      }
    ]
  },
  {
    id: "attack-save",
    title: "Attack Rolls & Saving Throws",
    icon: "fa-bullseye",
    intro: "Use native Attack and Save Activities rather than manually reproducing attack/save math in a generic formula.",
    entries: [
      {
        title: "Spell Attack",
        where: "Edit Spell → Attack Activity",
        body: "Use the Activity's native ability and attack configuration. D&D5e derives the caster modifier and proficiency through the Activity instead of requiring a hard-coded attack bonus."
      },
      {
        title: "Saving Throw",
        where: "Edit Spell → Save Activity → Save",
        body: "Choose the save ability and DC calculation in the native Save Activity. Configure what happens on a successful save (for example half damage) in the Activity rather than only describing it in text."
      },
      {
        title: "Caster Spell Save DC",
        where: "Formula contexts that expose Actor roll data",
        body: "@attributes.spell.dc resolves to the caster's prepared spell save DC when that path is available in the Activity roll data. Prefer the native Save Activity DC calculation when possible."
      }
    ]
  },
  {
    id: "targeting-time",
    title: "Targeting, Range, Duration & Concentration",
    icon: "fa-clock",
    intro: "These values remain native D&D5e data. Spell Factory does not create a parallel timing engine for Spell Activities.",
    entries: [
      {
        title: "Range & Target",
        where: "Edit Spell → Activity → Targeting",
        body: "Configure range, target type, number of targets, and prompt behavior on the Activity. This controls the actual targeting workflow used by D&D5e."
      },
      {
        title: "Duration",
        where: "Edit Spell → Activity → Activation / Duration",
        body: "Use the native duration units and expiry options. Spell duration belongs to D&D5e's native Activity/Spell lifecycle, not Item Creator Timing Model effects."
      },
      {
        title: "Concentration",
        where: "Edit Spell → Activity → Duration → Concentration",
        body: "Enable native Concentration when the Activity requires it. Concentration is not Combat Only; D&D5e owns the concentration lifecycle."
      }
    ]
  },
  {
    id: "uses-recovery",
    title: "Uses, Consumption & Recovery",
    icon: "fa-rotate",
    intro: "Activities can own uses and consumption rules. Spell slot consumption and Activity-specific uses are different concepts.",
    entries: [
      {
        title: "Spell Slot Consumption",
        where: "Edit Spell → Activity → Consumption / Scaling",
        body: "For normal leveled Spells, keep slot consumption and higher-level casting under native D&D5e controls. Do not emulate spell slots with a custom Item Creator cooldown."
      },
      {
        title: "Activity Uses",
        where: "Edit Spell → Activity → Uses / Recovery",
        body: "Use Activity Uses for powers that have their own use pool. Recovery options such as Short Rest, Long Rest, Dawn, or other system-supported periods remain native D&D5e configuration."
      }
    ]
  },
  {
    id: "formulas",
    title: "Formula Reference",
    icon: "fa-square-root-variable",
    intro: "These are useful native roll-data paths. Availability can depend on the Activity context, so prefer fields and presets exposed by the native editor whenever possible.",
    entries: [
      {
        title: "@mod — Activity Ability Modifier",
        where: "Activity formula fields",
        body: "Automatically resolved from the ability used by the Activity. If the Activity uses Intelligence and the caster has INT 18, @mod resolves to 4.",
        examples: [
          { code: "4d8 + @mod", note: "Four d8 plus the resolved Activity ability modifier." }
        ]
      },
      {
        title: "@details.level — Character Level",
        where: "Formula contexts containing Actor roll data",
        body: "Total character level. Use this when a homebrew formula should scale from the character rather than from the Spell level.",
        examples: [
          { code: "@details.level * 5", note: "A level 7 character produces 35." }
        ]
      },
      {
        title: "@attributes.prof — Proficiency Bonus",
        where: "Formula contexts containing Actor roll data",
        body: "The caster's current proficiency bonus.",
        examples: [
          { code: "@attributes.prof + @mod", note: "PB plus the Activity ability modifier." }
        ]
      },
      {
        title: "Ability Paths",
        where: "Formula contexts containing Actor roll data",
        body: "Use an explicit ability path when you intentionally want a fixed ability rather than the Activity's resolved @mod.",
        examples: [
          { code: "@abilities.int.mod", note: "Intelligence modifier." },
          { code: "@abilities.wis.mod", note: "Wisdom modifier." },
          { code: "@abilities.cha.mod", note: "Charisma modifier." }
        ]
      }
    ]
  },
  {
    id: "summon",
    title: "Summoning",
    icon: "fa-paw",
    intro: "Summon is one native Activity type among many. Spell Factory preserves the D&D5e Summon Activity instead of implementing a separate summon engine.",
    entries: [
      {
        title: "Summon Profiles",
        where: "Edit Spell → Summon Activity → Summoning → Profiles",
        body: "Each profile points to an Actor or configures a summon candidate. Remove profiles you do not want and keep the profile(s) that belong to the homebrew Spell. Actor templates can live in an Actor Compendium."
      },
      {
        title: "Summon Ability & Matching",
        where: "Edit Spell → Summon Activity → Summoning",
        body: "The native Summon Activity can match proficiency, attacks, saves, disposition, and other values. Its resolved Activity ability is available as @mod and is used by native matching behavior."
      },
      {
        title: "Summon Bonus Formulas",
        where: "Edit Spell → Summon Activity → Summoning → Changes / Bonuses",
        body: "Native Summon bonus fields such as AC, Hit Dice, HP, Temporary HP, Attack Damage, Save Damage, and Healing are evaluated from summon roll data. Character-level formulas can use Actor roll-data paths such as @details.level when available.",
        examples: [
          { code: "@details.level * 5", note: "Example HP bonus based on total character level." },
          { code: "@attributes.prof", note: "Example bonus based on the summoner's proficiency bonus." }
        ]
      },
      {
        title: "@summon.* — Summoned Actor Data",
        where: "Native Summon change evaluation",
        body: "When D&D5e prepares summon changes it adds the summoned Actor's roll data under @summon. Use this only in Summon change contexts that are evaluated by the native Summon Activity.",
        examples: [
          { code: "@summon.attributes.hp.max", note: "Reads the template Actor's maximum HP in native summon-change roll data." }
        ]
      }
    ]
  },
  {
    id: "effects",
    title: "Effects",
    icon: "fa-sparkles",
    intro: "Use embedded Active Effects when the Spell applies a persistent mechanical state. Use Activities for executable rolls/actions.",
    entries: [
      {
        title: "Activity vs. Effect",
        where: "Edit Spell → Activities / Effects",
        body: "Damage, healing, attacks, saves, and summons normally belong to Activities. Persistent bonuses, penalties, conditions, or other ongoing modifications normally belong to embedded Active Effects connected to the appropriate Activity."
      },
      {
        title: "Do Not Encode Mechanics Only in Description",
        where: "Edit Spell",
        body: "A description explains the rule to players, but native Activities/Effects should carry the mechanical behavior whenever D&D5e supports it."
      }
    ]
  }
]);

function searchText(section, entry) {
  return [section.title, section.intro, entry.title, entry.where, entry.body,
    ...(entry.examples ?? []).flatMap(example => [example.code, example.note])]
    .filter(Boolean).join(" ").toLowerCase();
}

export class SpellConfigurationGuideApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.search = "";
  }

  static DEFAULT_OPTIONS = {
    id: "dnd5e-item-creator-spell-configuration-guide",
    classes: ["item-creator", "ic-spell-guide", "standard-form"],
    tag: "section",
    position: { width: 900, height: 780 },
    window: { title: "Item Creator — Spell Configuration Guide", resizable: true }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/spell-configuration-guide.hbs` }
  };

  async _prepareContext() {
    return {
      search: this.search,
      sections: GUIDE_SECTIONS.map(section => ({
        ...section,
        entries: section.entries.map(entry => ({ ...entry, searchText: searchText(section, entry) }))
      }))
    };
  }

  _onRender() {
    const input = this.element?.querySelector("[data-spell-guide-search]");
    input?.addEventListener("input", event => {
      this.search = String(event.currentTarget.value ?? "");
      this.#applyFilter();
    });
    this.element?.querySelectorAll('[data-action="copy-guide-formula"]').forEach(button => {
      button.addEventListener("click", event => this.#copyFormula(event));
    });
    this.#applyFilter();
  }

  async #copyFormula(event) {
    event.preventDefault();
    const code = event.currentTarget.dataset.formula ?? "";
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      ui.notifications.info(`Copied: ${code}`);
    } catch (_error) {
      ui.notifications.warn("Could not copy the formula automatically. Select it from the guide instead.");
    }
  }

  #applyFilter() {
    const query = this.search.trim().toLowerCase();
    for (const entry of this.element?.querySelectorAll("[data-guide-entry]") ?? []) {
      entry.hidden = Boolean(query) && !String(entry.dataset.search ?? "").includes(query);
    }
    for (const section of this.element?.querySelectorAll("[data-guide-section]") ?? []) {
      section.hidden = ![...section.querySelectorAll("[data-guide-entry]")].some(entry => !entry.hidden);
    }
  }
}
