import { MODULE_ID, MODULE_STAGE, MODULE_VERSION } from "../constants.mjs";
import { PublishedSpellLibraryService } from "../services/published-spell-library-service.mjs";
import { ProtectedTransactionDialogService } from "../services/protected-transaction-dialog-service.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const FALLBACK_CLASSES = Object.freeze([
  ["bard", "Bard"], ["cleric", "Cleric"], ["druid", "Druid"], ["paladin", "Paladin"],
  ["ranger", "Ranger"], ["sorcerer", "Sorcerer"], ["warlock", "Warlock"], ["wizard", "Wizard"]
]);

function nativeCompendiumBrowserClass() {
  return game.dnd5e?.applications?.CompendiumBrowser
    ?? globalThis.dnd5e?.applications?.CompendiumBrowser
    ?? null;
}

function isSpell(document) {
  const documentName = document?.documentName ?? document?.constructor?.documentName;
  return documentName === "Item" && document?.type === "spell";
}

function valuesOf(value) {
  if (value instanceof Map) return [...value.values()];
  if (value instanceof Set) return [...value];
  if (Array.isArray(value)) return value;
  if (value?.values instanceof Function) {
    try { return [...value.values()]; } catch (_error) { /* fall through */ }
  }
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function localizedLabel(entry, fallback = "") {
  const label = typeof entry === "string" ? entry : entry?.label;
  return label ? game.i18n.localize(label) : fallback;
}

function classOptions(selected = []) {
  const chosen = new Set(selected.map(String));
  const discovered = [];
  for (const entry of globalThis.dnd5e?.registry?.spellLists?.options ?? game.dnd5e?.registry?.spellLists?.options ?? []) {
    if (entry?.type !== "class" && !String(entry?.value ?? "").startsWith("class:")) continue;
    const id = String(entry.value ?? "").split(":")[1];
    if (!id || discovered.some(row => row.id === id)) continue;
    discovered.push({ id, label: game.i18n.localize(entry.label ?? id), selected: chosen.has(id) });
  }
  const rows = discovered.length ? discovered : FALLBACK_CLASSES.map(([id, label]) => ({ id, label, selected: chosen.has(id) }));
  return rows.sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
}

function spellSummary(spell) {
  const level = Number(spell?.system?.level) || 0;
  const school = String(spell?.system?.school ?? "");
  const activation = spell?.system?.activation ?? {};
  const duration = spell?.system?.duration ?? {};
  const range = spell?.system?.range ?? {};
  const activities = valuesOf(spell?.system?.activities);
  const effects = valuesOf(spell?.effects);
  const properties = spell?.system?.properties instanceof Set
    ? [...spell.system.properties]
    : Array.isArray(spell?.system?.properties) ? spell.system.properties : [];
  const activationLabel = localizedLabel(CONFIG.DND5E.activityActivationTypes?.[activation.type], activation.type || "—");
  const schoolLabel = localizedLabel(CONFIG.DND5E.spellSchools?.[school], school || "Unclassified");
  const durationLabel = duration.units
    ? `${duration.value ?? ""} ${localizedLabel(CONFIG.DND5E.durationUnits?.[duration.units], duration.units)}`.trim()
    : "—";
  const rangeLabel = range.units === "self" ? "Self"
    : range.units === "touch" ? "Touch"
      : range.value ? `${range.value} ${range.units || "ft"}` : localizedLabel(CONFIG.DND5E.rangeTypes?.[range.units], range.units || "—");
  return {
    id: spell.id,
    uuid: spell.uuid,
    name: spell.name,
    img: spell.img,
    identifier: spell.system?.identifier ?? "",
    level,
    levelLabel: level === 0 ? "Cantrip" : `Level ${level}`,
    school,
    schoolLabel,
    activationLabel,
    durationLabel,
    rangeLabel,
    concentration: properties.includes("concentration") || Boolean(duration.concentration),
    ritual: properties.includes("ritual"),
    activities: activities.map(activity => ({
      id: activity.id ?? activity._id ?? "",
      name: activity.name || "Activity",
      type: activity.type || "activity",
      typeLabel: activity.constructor?.metadata?.title ? game.i18n.localize(activity.constructor.metadata.title) : String(activity.type || "Activity")
    })),
    activityCount: activities.length,
    effectCount: effects.length
  };
}

export class SpellFactoryApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ draftSpell = null, publishedSpell = null, ...options } = {}) {
    super(options);
    this.draftId = draftSpell?.id ?? null;
    this.pendingPublishedId = publishedSpell?.id ?? null;
    this.busy = false;
    this.browserOpen = false;
    this.status = draftSpell ? `Editing draft: ${draftSpell.name}` : publishedSpell ? `Preparing an editable draft for ${publishedSpell.name}…` : "Create a blank Spell or clone an existing Spell as a blueprint.";
    this.#updateHook = Hooks.on("updateItem", item => {
      if (item?.id === this.draftId && PublishedSpellLibraryService.isDraft(item)) this.render({ force: true });
    });
    this.#deleteHook = Hooks.on("deleteItem", item => {
      if (item?.id !== this.draftId) return;
      this.draftId = null;
      this.render({ force: true });
    });
  }

  #updateHook;
  #deleteHook;

  static DEFAULT_OPTIONS = {
    id: "dnd5e-item-creator-spell-factory",
    classes: ["item-creator", "ic-spell-factory", "standard-form"],
    tag: "section",
    position: { width: 980, height: 780 },
    window: { title: "Item Creator — Spell Factory", resizable: true }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/spell-factory.hbs` }
  };

  async close(options = {}) {
    if (this.#updateHook !== undefined) Hooks.off("updateItem", this.#updateHook);
    if (this.#deleteHook !== undefined) Hooks.off("deleteItem", this.#deleteHook);
    this.#updateHook = undefined;
    this.#deleteHook = undefined;
    return super.close(options);
  }

  async #resolvePendingPublished() {
    if (this.draftId || !this.pendingPublishedId || this.busy) return;
    const pack = await PublishedSpellLibraryService.ensurePack({ unlock: true, organize: false });
    const published = await pack.getDocument(this.pendingPublishedId);
    this.pendingPublishedId = null;
    if (!PublishedSpellLibraryService.isPublished(published)) throw new Error("That Published Spell is no longer available.");
    const draft = await PublishedSpellLibraryService.createDraftFromSpell(published, { editPublished: true });
    this.draftId = draft.id;
    this.status = `Editing a protected draft of ${published.name}. Update Published will replace the canonical publication only after review.`;
  }

  async #draft() {
    if (!this.draftId) return null;
    const pack = await PublishedSpellLibraryService.ensureDraftPack({ unlock: true });
    const draft = await pack.getDocument(this.draftId);
    if (!PublishedSpellLibraryService.isDraft(draft)) {
      this.draftId = null;
      return null;
    }
    return draft;
  }

  async _prepareContext() {
    await this.#resolvePendingPublished();
    const draft = await this.#draft();
    const drafts = draft ? [] : await PublishedSpellLibraryService.listDrafts();
    const factory = draft?.flags?.[MODULE_ID]?.spellFactory ?? {};
    const selectedLists = draft ? PublishedSpellLibraryService.classLists(draft) : [];
    const summary = draft ? spellSummary(draft) : null;
    return {
      version: MODULE_VERSION,
      stage: MODULE_STAGE,
      busy: this.busy,
      status: this.status,
      hasDraft: Boolean(draft),
      draft: summary,
      sourceName: factory.sourceName ?? (draft ? "Blank Spell" : ""),
      sourceUuid: factory.sourceUuid ?? "",
      editingPublished: Boolean(factory.editingPublication),
      classOptions: classOptions(selectedLists),
      classCount: selectedLists.length,
      drafts,
      hasSavedDrafts: drafts.length > 0
    };
  }

  _onRender() {
    const root = this.element;
    root?.querySelector('[data-action="new-blank-spell"]')?.addEventListener("click", event => this.#newBlank(event));
    root?.querySelector('[data-action="browse-spell-blueprint"]')?.addEventListener("click", event => this.#browseBlueprint(event));
    root?.querySelector('[data-action="open-published-spells"]')?.addEventListener("click", event => this.#openPublished(event));
    root?.querySelectorAll('[data-action="resume-spell-draft"]').forEach(button => button.addEventListener("click", event => this.#resumeDraft(event)));
    root?.querySelector('[data-action="edit-native-spell"]')?.addEventListener("click", event => this.#editNative(event));
    root?.querySelector('[data-action="publish-spell"]')?.addEventListener("click", event => this.#publish(event));
    root?.querySelector('[data-action="discard-spell-draft"]')?.addEventListener("click", event => this.#discard(event));
    root?.querySelectorAll("[data-spell-class]").forEach(input => input.addEventListener("change", event => this.#updateClassLists(event)));
    const dropZone = root?.querySelector("[data-spell-blueprint-drop]");
    dropZone?.addEventListener("dragover", event => this.#dragOver(event));
    dropZone?.addEventListener("dragleave", event => event.currentTarget.classList.remove("drag-over"));
    dropZone?.addEventListener("drop", event => this.#dropBlueprint(event));
  }

  async #newBlank(event) {
    event.preventDefault();
    if (this.busy || this.draftId) return;
    this.busy = true;
    this.render({ force: true });
    try {
      const draft = await PublishedSpellLibraryService.createBlankDraft();
      this.draftId = draft.id;
      this.status = "Blank Spell draft created in the Item Creator internal draft workspace. Use the native Spell editor to author its mechanics.";
    } catch (error) {
      console.error(`${MODULE_ID} | Unable to create blank Spell draft.`, error);
      ui.notifications.error(`Spell Factory could not create a blank draft: ${error?.message ?? "Unknown error"}`);
    } finally {
      this.busy = false;
      this.render({ force: true });
    }
  }

  async #browseBlueprint(event) {
    event.preventDefault();
    if (this.busy || this.browserOpen || this.draftId) return;
    const Browser = nativeCompendiumBrowserClass();
    if (!Browser?.selectOne) return ui.notifications.error("The native D&D5e Compendium Browser is unavailable.");
    this.browserOpen = true;
    try {
      const uuid = await Browser.selectOne({
        mode: Browser.MODES?.ADVANCED ?? 2,
        tab: "spells",
        hint: "Choose a Spell to clone into a new Item Creator Spell Factory draft. The source document is never modified.",
        filters: { locked: { documentClass: "Item", types: new Set(["spell"]) } },
        window: { modal: true }
      });
      if (!uuid) return;
      const spell = await fromUuid(uuid);
      if (!isSpell(spell)) return ui.notifications.warn("Choose a Spell Item as the blueprint.");
      await this.#createFromBlueprint(spell);
    } catch (error) {
      console.error(`${MODULE_ID} | Spell blueprint browser failed.`, error);
      ui.notifications.error(`Spell Factory could not load that blueprint: ${error?.message ?? "Unknown error"}`);
    } finally {
      this.browserOpen = false;
    }
  }

  async #createFromBlueprint(spell) {
    if (this.busy || this.draftId) return;
    this.busy = true;
    this.render({ force: true });
    try {
      const draft = await PublishedSpellLibraryService.createDraftFromSpell(spell);
      this.draftId = draft.id;
      this.status = `${spell.name} was cloned into an independent Spell Factory draft. The source Spell remains untouched.`;
      ui.notifications.info(`${spell.name} cloned as a new Spell Factory draft.`);
    } finally {
      this.busy = false;
      this.render({ force: true });
    }
  }

  #dragOver(event) {
    if (this.busy || this.draftId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    event.currentTarget.classList.add("drag-over");
  }

  async #dropBlueprint(event) {
    event.preventDefault();
    event.currentTarget.classList.remove("drag-over");
    if (this.busy || this.draftId) return;
    try {
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
      if (data?.type !== "Item") return ui.notifications.warn("Drop a Spell Item into Spell Factory.");
      const item = await Item.implementation.fromDropData(data);
      if (!isSpell(item)) return ui.notifications.warn("Only Spell Items can be used as Spell Factory blueprints.");
      await this.#createFromBlueprint(item);
    } catch (error) {
      console.error(`${MODULE_ID} | Unable to process Spell blueprint drop.`, error);
      ui.notifications.error("Spell Factory could not read the dropped Spell.");
    }
  }

  async #resumeDraft(event) {
    event.preventDefault();
    if (this.busy || this.draftId) return;
    const draft = await PublishedSpellLibraryService.getDraft(event.currentTarget.dataset.draftId);
    if (!draft) return ui.notifications.warn("That Spell Factory draft is no longer available.");
    this.draftId = draft.id;
    this.status = `Resumed draft: ${draft.name}.`;
    this.render({ force: true });
  }

  async #editNative(event) {
    event.preventDefault();
    const draft = await this.#draft();
    if (!draft) return;
    await PublishedSpellLibraryService.ensureDraftPack({ unlock: true });
    draft.sheet?.render?.({ force: true });
  }

  async #updateClassLists(event) {
    const draft = await this.#draft();
    if (!draft) return;
    const selected = [...this.element.querySelectorAll("[data-spell-class]:checked")].map(input => input.value);
    try {
      await PublishedSpellLibraryService.setClassLists(draft, selected);
      this.status = selected.length ? `${selected.length} class spell list(s) selected.` : "Choose at least one class spell list before publishing.";
    } catch (error) {
      console.error(`${MODULE_ID} | Unable to update Spell class lists.`, error);
      ui.notifications.error("Spell Factory could not save the class-list selection.");
    }
  }

  async #publish(event) {
    event.preventDefault();
    if (this.busy) return;
    const draft = await this.#draft();
    if (!draft) return;
    const lists = PublishedSpellLibraryService.classLists(draft);
    if (!lists.length) return ui.notifications.warn("Choose at least one class spell list before publishing.");
    if (!String(draft.name ?? "").trim()) return ui.notifications.warn("The Spell needs a name before publishing.");
    if (!String(draft.system?.school ?? "").trim()) return ui.notifications.warn("Choose a Spell school in the native Spell editor before publishing.");

    const editing = Boolean(draft.flags?.[MODULE_ID]?.spellFactory?.editingPublication);
    const confirmed = await ProtectedTransactionDialogService.confirm({
      key: `spell-factory-publish-${draft.id}`,
      matchClass: "ic-confirm-spell-publish",
      dialogOptions: {
        classes: ["ic-confirm-spell-publish"],
        window: { title: editing ? "Update Published Spell" : "Publish Spell", modal: true },
        content: `<div class="ic-confirm-item-content"><i class="fa-solid fa-wand-magic-sparkles"></i><div><h2>${editing ? "Update" : "Publish"} ${foundry.utils.escapeHTML(draft.name)}?</h2><p>${editing ? "The canonical Published Spell will be replaced by this reviewed draft while preserving its publication identity." : "This draft will become the canonical Published Spell in the Item Creator compendium."}</p><p><strong>Class lists:</strong> ${foundry.utils.escapeHTML(lists.join(", "))}</p></div></div>`,
        yes: { label: editing ? "Update Published" : "Publish", icon: "fa-solid fa-check" },
        no: { label: "Cancel", icon: "fa-solid fa-xmark" }
      }
    });
    if (!confirmed) return;

    this.busy = true;
    this.render({ force: true });
    try {
      const published = await PublishedSpellLibraryService.publishDraft(draft);
      this.draftId = null;
      this.status = `${published.name} ${editing ? "updated" : "published"} in Item Creator — Published Spells.`;
      ui.notifications.info(`${published.name} ${editing ? "updated" : "published"} in Item Creator — Published Spells.`);
      this.render({ force: true });
    } catch (error) {
      console.error(`${MODULE_ID} | Spell publication failed.`, error);
      ui.notifications.error(`Spell publication failed: ${error?.message ?? "Unknown error"}`);
    } finally {
      this.busy = false;
      this.render({ force: true });
    }
  }

  async #discard(event) {
    event.preventDefault();
    if (this.busy) return;
    const draft = await this.#draft();
    if (!draft) return;
    const confirmed = await ProtectedTransactionDialogService.confirm({
      key: `spell-factory-discard-${draft.id}`,
      matchClass: "ic-confirm-spell-discard",
      dialogOptions: {
        classes: ["ic-confirm-spell-discard"],
        window: { title: "Discard Spell Draft", modal: true },
        content: `<div class="ic-confirm-item-content"><i class="fa-solid fa-triangle-exclamation"></i><div><h2>Discard ${foundry.utils.escapeHTML(draft.name)}?</h2><p>This deletes only the Spell Factory working draft. The blueprint or existing Published Spell is not modified.</p></div></div>`,
        yes: { label: "Discard Draft", icon: "fa-solid fa-trash" },
        no: { label: "Cancel", icon: "fa-solid fa-xmark" }
      }
    });
    if (!confirmed) return;
    await PublishedSpellLibraryService.discardDraft(draft);
    this.draftId = null;
    this.status = "Draft discarded. The source Spell was not modified.";
    this.render({ force: true });
  }

  async #openPublished(event) {
    event.preventDefault();
    if (this.draftId) return ui.notifications.warn("Publish or discard the current Spell draft before opening Published Spells.");
    await this.close();
    game.itemCreator?.openPublishedSpells?.();
  }
}
