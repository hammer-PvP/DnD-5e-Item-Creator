import { MODULE_ID, MODULE_STAGE, MODULE_VERSION } from "../constants.mjs";
import { PublishedSpellLibraryService } from "../services/published-spell-library-service.mjs";
import { ProtectedTransactionDialogService } from "../services/protected-transaction-dialog-service.mjs";
import { SpellConfigurationGuideApp } from "./spell-configuration-guide-app.mjs";

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
    this.nativeEditActive = false;
    this.nativeEditDirty = false;
    this.status = draftSpell
      ? `Editing draft: ${draftSpell.name}`
      : publishedSpell
        ? `Preparing an editable draft for ${publishedSpell.name}…`
        : "Create a blank Spell or clone an existing Spell as a blueprint.";

    this.#updateHook = Hooks.on("updateItem", (item, _changes, hookOptions) => {
      if (item?.id !== this.draftId || !PublishedSpellLibraryService.isDraft(item)) return;
      if (hookOptions?.itemCreatorSpellFactoryInternal) return;
      if (this.nativeEditActive) {
        this.nativeEditDirty = true;
        return;
      }
      if (!this.busy) this.render({ force: true });
    });
  }

  #updateHook;
  #nativeCloseHookV2 = null;
  #nativeCloseHookV1 = null;
  #nativeSheet = null;
  #guideApp = null;

  static DEFAULT_OPTIONS = {
    id: "dnd5e-item-creator-spell-factory",
    classes: ["item-creator", "ic-spell-factory", "standard-form"],
    tag: "section",
    position: { width: 1040, height: 800 },
    window: { title: "Item Creator — Spell Factory", resizable: true }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/spell-factory.hbs` }
  };

  async close(options = {}) {
    if (this.#updateHook !== undefined) Hooks.off("updateItem", this.#updateHook);
    this.#updateHook = undefined;
    this.#stopWatchingNativeSheet();
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
    this.status = `Editing a protected draft of ${published.name}. Update Published changes the canonical publication only after review.`;
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
      nativeEditActive: this.nativeEditActive,
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
    root?.querySelectorAll('[data-action="edit-saved-spell-draft"]').forEach(button => button.addEventListener("click", event => this.#editSavedDraft(event)));
    root?.querySelectorAll('[data-action="summary-spell-draft"]').forEach(button => button.addEventListener("click", event => this.#toggleDraftSummary(event)));
    root?.querySelectorAll('[data-action="discard-saved-spell-draft"]').forEach(button => button.addEventListener("click", event => this.#discardSavedDraft(event)));
    root?.querySelector('[data-action="edit-native-spell"]')?.addEventListener("click", event => this.#editNative(event));
    root?.querySelectorAll('[data-action="open-spell-guide"]').forEach(button => button.addEventListener("click", event => this.#openGuide(event)));
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
      this.status = `${draft.name} created as a protected Spell Factory draft. Use Edit Spell when you are ready to work on it.`;
      ui.notifications.info("Blank Spell created in Draft Workspace.");
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
      this.status = `${draft.name} was cloned into Draft Workspace. ${spell.name} remains untouched.`;
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

  async #editSavedDraft(event) {
    event.preventDefault();
    if (this.busy || this.draftId) return;
    const draft = await PublishedSpellLibraryService.getDraft(event.currentTarget.dataset.draftId);
    if (!draft) return ui.notifications.warn("That Spell Factory draft is no longer available.");
    this.draftId = draft.id;
    this.status = `Editing draft: ${draft.name}.`;
    await this.render({ force: true });
    await this.#openNativeEditor(draft);
  }

  #toggleDraftSummary(event) {
    event.preventDefault();
    const article = event.currentTarget.closest("[data-spell-draft-card]");
    const summary = article?.querySelector("[data-draft-summary]");
    if (!summary) return;
    summary.hidden = !summary.hidden;
    event.currentTarget.setAttribute("aria-expanded", String(!summary.hidden));
  }

  async #discardSavedDraft(event) {
    event.preventDefault();
    if (this.busy || this.draftId) return;
    const draft = await PublishedSpellLibraryService.getDraft(event.currentTarget.dataset.draftId);
    if (!draft) return ui.notifications.warn("That Spell Factory draft is no longer available.");
    if (!(await this.#confirmDiscard(draft))) return;
    this.busy = true;
    try {
      await PublishedSpellLibraryService.discardDraft(draft);
      this.status = `${draft.name} draft discarded. Its blueprint/publication was not modified.`;
      ui.notifications.info(`${draft.name} draft discarded.`);
    } catch (error) {
      console.error(`${MODULE_ID} | Unable to discard Spell draft.`, error);
      ui.notifications.error(`Discard failed: ${error?.message ?? "Unknown error"}`);
    } finally {
      this.busy = false;
      this.render({ force: true });
    }
  }

  async #editNative(event) {
    event.preventDefault();
    const draft = await this.#draft();
    if (!draft) return;
    await this.#openNativeEditor(draft);
  }

  async #openNativeEditor(draft) {
    if (this.nativeEditActive) return;
    await PublishedSpellLibraryService.ensureDraftPack({ unlock: true });
    const sheet = draft.sheet;
    if (!sheet?.render) return ui.notifications.error("D&D5e did not provide a native Spell sheet for this draft.");

    this.nativeEditActive = true;
    this.nativeEditDirty = false;
    this.status = `Editing ${draft.name} in the native D&D5e Spell editor. Spell Factory refresh is suspended until the sheet closes.`;
    try { await this.minimize?.(); } catch (_error) { /* the native sheet still opens */ }
    try {
      await sheet.render({ force: true });
      this.#watchNativeSheet(sheet);
    } catch (error) {
      this.nativeEditActive = false;
      try { await this.maximize?.(); } catch (_error) { /* no-op */ }
      console.error(`${MODULE_ID} | Unable to open the native Spell editor.`, error);
      ui.notifications.error(`Could not open Edit Spell: ${error?.message ?? "Unknown error"}`);
    }
  }

  #watchNativeSheet(sheet) {
    this.#stopWatchingNativeSheet();
    this.#nativeSheet = sheet;
    const onClose = application => {
      if (application !== this.#nativeSheet) return;
      void this.#finishNativeEdit();
    };
    this.#nativeCloseHookV2 = Hooks.on("closeApplicationV2", onClose);
    // Keep a V1 fallback for custom/legacy Spell sheets while D&D5e itself uses V2.
    this.#nativeCloseHookV1 = Hooks.on("closeApplicationV1", onClose);
  }

  #stopWatchingNativeSheet() {
    if (this.#nativeCloseHookV2 !== null) Hooks.off("closeApplicationV2", this.#nativeCloseHookV2);
    if (this.#nativeCloseHookV1 !== null) Hooks.off("closeApplicationV1", this.#nativeCloseHookV1);
    this.#nativeCloseHookV2 = null;
    this.#nativeCloseHookV1 = null;
    this.#nativeSheet = null;
  }

  async #finishNativeEdit() {
    if (!this.nativeEditActive) return;
    const changed = this.nativeEditDirty;
    this.#stopWatchingNativeSheet();
    this.nativeEditActive = false;
    this.nativeEditDirty = false;
    this.status = changed
      ? "Edit Spell closed. Draft summary refreshed from the native D&D5e document."
      : "Edit Spell closed. Draft remains ready for review or publication.";
    if (!this.element?.isConnected) return;
    try { await this.maximize?.(); } catch (_error) { /* no-op */ }
    await this.render({ force: true });
    this.bringToFront?.();
  }

  async #openGuide(event) {
    event.preventDefault();
    if (this.#guideApp?.element?.isConnected) {
      this.#guideApp.bringToFront?.();
      return;
    }
    this.#guideApp = new SpellConfigurationGuideApp();
    this.#guideApp.render({ force: true });
  }

  async #updateClassLists(event) {
    const draft = await this.#draft();
    if (!draft) return;
    const selected = [...this.element.querySelectorAll("[data-spell-class]:checked")].map(input => input.value);
    try {
      await PublishedSpellLibraryService.setClassLists(draft, selected);
      this.status = selected.length ? `${selected.length} class spell list(s) selected.` : "Choose at least one class spell list before publishing.";
      const count = this.element?.querySelector("[data-class-count]");
      if (count) count.textContent = `${selected.length} class list(s) selected`;
    } catch (error) {
      console.error(`${MODULE_ID} | Unable to update Spell class lists.`, error);
      ui.notifications.error("Spell Factory could not save the class-list selection.");
    }
  }

  async #publish(event) {
    event.preventDefault();
    if (this.busy || this.nativeEditActive) return;
    const draft = await this.#draft();
    if (!draft) return;
    const lists = PublishedSpellLibraryService.classLists(draft);
    if (!lists.length) return ui.notifications.warn("Choose at least one class spell list before publishing.");
    if (!String(draft.name ?? "").trim()) return ui.notifications.warn("The Spell needs a name before publishing.");
    if (!String(draft.system?.school ?? "").trim()) return ui.notifications.warn("Choose a Spell school in Edit Spell before publishing.");

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
    } catch (error) {
      console.error(`${MODULE_ID} | Spell publication failed.`, error);
      ui.notifications.error(`Spell publication failed: ${error?.message ?? "Unknown error"}`);
    } finally {
      this.busy = false;
      this.render({ force: true });
    }
  }

  async #confirmDiscard(draft) {
    return ProtectedTransactionDialogService.confirm({
      key: `spell-factory-discard-${draft.id}`,
      matchClass: "ic-confirm-spell-discard",
      dialogOptions: {
        classes: ["ic-confirm-spell-discard"],
        window: { title: "Discard Spell Draft", modal: true },
        content: `<div class="ic-confirm-item-content"><i class="fa-solid fa-triangle-exclamation"></i><div><h2>Discard ${foundry.utils.escapeHTML(draft.name)}?</h2><p>This permanently deletes only the unpublished Spell Factory working draft. The blueprint and any existing Published Spell remain untouched.</p></div></div>`,
        yes: { label: "Discard Draft", icon: "fa-solid fa-trash" },
        no: { label: "Cancel", icon: "fa-solid fa-xmark" }
      }
    });
  }

  async #discard(event) {
    event.preventDefault();
    if (this.busy || this.nativeEditActive) return;
    const draft = await this.#draft();
    if (!draft) return;
    if (!(await this.#confirmDiscard(draft))) return;
    this.busy = true;
    try {
      await PublishedSpellLibraryService.discardDraft(draft);
      this.draftId = null;
      this.status = "Draft discarded. The source Spell was not modified.";
    } catch (error) {
      console.error(`${MODULE_ID} | Unable to discard Spell draft.`, error);
      ui.notifications.error(`Discard failed: ${error?.message ?? "Unknown error"}`);
    } finally {
      this.busy = false;
      this.render({ force: true });
    }
  }

  async #openPublished(event) {
    event.preventDefault();
    if (this.draftId) return ui.notifications.warn("Publish or discard the current Spell draft before opening Published Spells.");
    await this.close();
    game.itemCreator?.openPublishedSpells?.();
  }
}
