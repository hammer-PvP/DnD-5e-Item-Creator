import { MODULE_ID, MODULE_STAGE, MODULE_VERSION } from "../constants.mjs";
import { PublishedSpellLibraryService } from "../services/published-spell-library-service.mjs";
import { ProtectedTransactionDialogService } from "../services/protected-transaction-dialog-service.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class PublishedSpellLibraryApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ onEdit = null, ...options } = {}) {
    super(options);
    this.onEdit = onEdit;
    this.search = "";
    this.schoolFilter = "all";
    this.includeArchived = false;
    this.busy = false;
  }

  static DEFAULT_OPTIONS = {
    id: "dnd5e-item-creator-published-spells",
    classes: ["item-creator", "ic-published-library", "ic-published-spells", "standard-form"],
    tag: "section",
    position: { width: 980, height: 760 },
    window: { title: "Item Creator — Published Spells", resizable: true }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/published-spell-library.hbs` }
  };

  async _prepareContext() {
    const pack = await PublishedSpellLibraryService.ensurePack();
    const rows = await PublishedSpellLibraryService.list({
      includeArchived: this.includeArchived,
      search: this.search,
      school: this.schoolFilter
    });
    return {
      version: MODULE_VERSION,
      stage: MODULE_STAGE,
      packLabel: pack.title ?? pack.metadata?.label ?? "Item Creator — Published Spells",
      search: this.search,
      includeArchived: this.includeArchived,
      schoolFilter: this.schoolFilter,
      schools: [{ key: "all", label: "All Schools", selected: this.schoolFilter === "all" }, ...PublishedSpellLibraryService.schools.map(school => ({
        ...school,
        selected: this.schoolFilter === school.key
      }))],
      groups: PublishedSpellLibraryService.displayTree(rows),
      spellCount: rows.length,
      empty: rows.length === 0,
      busy: this.busy
    };
  }

  _onRender() {
    const root = this.element;
    root?.querySelector("[data-spell-search]")?.addEventListener("input", event => {
      this.search = String(event.currentTarget.value ?? "");
      this.#applySearchFilter();
    });
    root?.querySelector("[data-spell-school]")?.addEventListener("change", event => {
      this.schoolFilter = String(event.currentTarget.value ?? "all");
      this.render({ force: true });
    });
    root?.querySelector("[data-spell-archived]")?.addEventListener("change", event => {
      this.includeArchived = Boolean(event.currentTarget.checked);
      this.render({ force: true });
    });
    root?.querySelector('[data-action="new-spell"]')?.addEventListener("click", event => this.#newSpell(event));
    root?.querySelector('[data-action="open-native-spell-pack"]')?.addEventListener("click", event => this.#openNativePack(event));
    root?.querySelectorAll('[data-action="edit-published-spell"]').forEach(button => button.addEventListener("click", event => this.#edit(event)));
    root?.querySelectorAll('[data-action="archive-published-spell"]').forEach(button => button.addEventListener("click", event => this.#archive(event)));
    root?.querySelectorAll('[data-action="delete-published-spell"]').forEach(button => button.addEventListener("click", event => this.#delete(event)));
    root?.querySelectorAll("[data-published-spell]").forEach(row => {
      row.draggable = true;
      row.addEventListener("dragstart", event => this.#drag(event));
    });
    this.#applySearchFilter();
  }

  async #spell(id) {
    const pack = await PublishedSpellLibraryService.ensurePack();
    return pack.getDocument(id);
  }

  async #newSpell(event) {
    event.preventDefault();
    await this.close();
    game.itemCreator?.openSpellFactory?.();
  }

  async #edit(event) {
    event.preventDefault();
    if (this.busy) return;
    const spell = await this.#spell(event.currentTarget.dataset.spellId);
    if (!PublishedSpellLibraryService.isPublished(spell)) return ui.notifications.warn("That Published Spell is no longer available.");
    if (this.onEdit) await this.onEdit(spell);
  }

  async #archive(event) {
    event.preventDefault();
    if (this.busy) return;
    const spell = await this.#spell(event.currentTarget.dataset.spellId);
    if (!spell) return;
    const archived = spell.flags?.[MODULE_ID]?.publication?.status !== "archived";
    this.busy = true;
    try {
      await PublishedSpellLibraryService.setArchived(spell, archived);
      ui.notifications.info(`${spell.name} ${archived ? "archived" : "restored"}.`);
    } catch (error) {
      console.error(`${MODULE_ID} | Unable to change Published Spell archive state.`, error);
      ui.notifications.error(`Archive action failed: ${error?.message ?? "Unknown error"}`);
    } finally {
      this.busy = false;
      this.render({ force: true });
    }
  }

  async #delete(event) {
    event.preventDefault();
    if (this.busy) return;
    const spell = await this.#spell(event.currentTarget.dataset.spellId);
    if (!spell) return;
    const confirmed = await ProtectedTransactionDialogService.confirm({
      key: `delete-published-spell-${spell.id}`,
      matchClass: "ic-confirm-published-spell-delete",
      dialogOptions: {
        classes: ["ic-confirm-published-spell-delete"],
        window: { title: "Delete Published Spell", modal: true },
        content: `<div class="ic-confirm-item-content"><i class="fa-solid fa-triangle-exclamation"></i><div><h2>Delete Published Spell?</h2><p>This permanently deletes <strong>${foundry.utils.escapeHTML(spell.name)}</strong> from Item Creator — Published Spells. Actor copies are not affected.</p></div></div>`,
        yes: { label: "Delete", icon: "fa-solid fa-trash" },
        no: { label: "Cancel", icon: "fa-solid fa-xmark" }
      }
    });
    if (!confirmed) return;
    this.busy = true;
    try {
      await PublishedSpellLibraryService.deletePublished(spell);
      ui.notifications.info(`${spell.name} deleted from Published Spells.`);
    } catch (error) {
      console.error(`${MODULE_ID} | Unable to delete Published Spell.`, error);
      ui.notifications.error(`Delete failed: ${error?.message ?? "Unknown error"}`);
    } finally {
      this.busy = false;
      this.render({ force: true });
    }
  }

  #drag(event) {
    const uuid = event.currentTarget.dataset.uuid;
    if (!uuid) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
  }

  #applySearchFilter() {
    const query = this.search.trim().toLowerCase();
    for (const card of this.element?.querySelectorAll("[data-published-spell]") ?? []) {
      card.hidden = Boolean(query) && !String(card.dataset.search ?? "").includes(query);
    }
    for (const group of this.element?.querySelectorAll(".ic-published-group") ?? []) {
      group.hidden = ![...group.querySelectorAll("[data-published-spell]")].some(card => !card.hidden);
    }
  }

  async #openNativePack(event) {
    event.preventDefault();
    const pack = await PublishedSpellLibraryService.ensurePack();
    pack.render?.(true);
  }
}
