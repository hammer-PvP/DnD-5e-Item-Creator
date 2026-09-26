import { MODULE_ID, MODULE_STAGE, MODULE_VERSION } from "../constants.mjs";
import { PublishedItemLibraryService } from "../services/published-item-library-service.mjs";
import { ProtectedTransactionDialogService } from "../services/protected-transaction-dialog-service.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class PublishedItemLibraryApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ onEdit = null, ...options } = {}) {
    super(options);
    this.onEdit = onEdit;
    this.search = "";
    this.typeFilter = "all";
    this.includeArchived = false;
    this.busy = false;
  }

  static DEFAULT_OPTIONS = {
    id: "dnd5e-item-creator-published-library",
    classes: ["item-creator", "ic-published-library", "standard-form"],
    tag: "section",
    position: { width: 980, height: 760 },
    window: { title: "Item Creator — Published Items", resizable: true }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/published-item-library.hbs` }
  };

  async _prepareContext() {
    const pack = await PublishedItemLibraryService.ensurePack();
    const rows = await PublishedItemLibraryService.list({
      includeArchived: this.includeArchived,
      search: this.search,
      type: this.typeFilter
    });
    const categoryOrder = PublishedItemLibraryService.categories;
    const groups = PublishedItemLibraryService.displayTree(rows);

    return {
      version: MODULE_VERSION,
      stage: MODULE_STAGE,
      packLabel: pack.title ?? pack.metadata?.label ?? "Item Creator — Published Items",
      packCollection: pack.collection,
      search: this.search,
      includeArchived: this.includeArchived,
      typeFilter: this.typeFilter,
      categories: [{ id: "all", label: "All Types", selected: this.typeFilter === "all" }, ...categoryOrder.map(category => ({
        ...category,
        selected: this.typeFilter === category.id
      }))],
      groups,
      itemCount: rows.length,
      empty: rows.length === 0,
      busy: this.busy
    };
  }

  _onRender() {
    const root = this.element;
    root?.querySelector("[data-published-search]")?.addEventListener("input", event => {
      this.search = String(event.currentTarget.value ?? "");
      this.#applySearchFilter();
    });
    root?.querySelector("[data-published-type]")?.addEventListener("change", event => {
      this.typeFilter = String(event.currentTarget.value ?? "all");
      this.render({ force: true });
    });
    root?.querySelector("[data-published-archived]")?.addEventListener("change", event => {
      this.includeArchived = Boolean(event.currentTarget.checked);
      this.render({ force: true });
    });
    root?.querySelector('[data-action="open-native-pack"]')?.addEventListener("click", event => this.#openNativePack(event));
    root?.querySelectorAll('[data-action="edit-published"]').forEach(button => button.addEventListener("click", event => this.#edit(event)));
    root?.querySelectorAll('[data-action="world-copy"]').forEach(button => button.addEventListener("click", event => this.#worldCopy(event)));
    root?.querySelectorAll('[data-action="archive-published"]').forEach(button => button.addEventListener("click", event => this.#archive(event)));
    root?.querySelectorAll('[data-action="delete-published"]').forEach(button => button.addEventListener("click", event => this.#delete(event)));
    root?.querySelectorAll("[data-published-item]").forEach(row => {
      row.draggable = true;
      row.addEventListener("dragstart", event => this.#drag(event));
    });
    this.#applySearchFilter();
  }

  async #item(id) {
    const pack = await PublishedItemLibraryService.ensurePack();
    return pack.getDocument(id);
  }

  async #edit(event) {
    event.preventDefault();
    if (this.busy) return;
    const item = await this.#item(event.currentTarget.dataset.itemId);
    if (!item) return ui.notifications.warn("That published Item is no longer available.");
    if (this.onEdit) await this.onEdit(item);
  }

  async #worldCopy(event) {
    event.preventDefault();
    if (this.busy) return;
    const item = await this.#item(event.currentTarget.dataset.itemId);
    if (!item) return;
    this.busy = true;
    this.render({ force: true });
    try {
      const created = await PublishedItemLibraryService.createWorldCopy(item);
      ui.notifications.info(`${created.name} created in World Items for testing/use.`);
      ui.items?.render?.();
    } catch (error) {
      console.error(`${MODULE_ID} | Unable to create World copy from Published Library.`, error);
      ui.notifications.error(`World copy failed: ${error?.message ?? "Unknown error"}`);
    } finally {
      this.busy = false;
      this.render({ force: true });
    }
  }

  async #archive(event) {
    event.preventDefault();
    if (this.busy) return;
    const item = await this.#item(event.currentTarget.dataset.itemId);
    if (!item) return;
    const archived = item.flags?.[MODULE_ID]?.publication?.status !== "archived";
    this.busy = true;
    try {
      await PublishedItemLibraryService.setArchived(item, archived);
      ui.notifications.info(`${item.name} ${archived ? "archived" : "restored"}.`);
    } catch (error) {
      console.error(`${MODULE_ID} | Unable to change Published Item archive state.`, error);
      ui.notifications.error(`Archive action failed: ${error?.message ?? "Unknown error"}`);
    } finally {
      this.busy = false;
      this.render({ force: true });
    }
  }

  async #delete(event) {
    event.preventDefault();
    if (this.busy) return;
    const item = await this.#item(event.currentTarget.dataset.itemId);
    if (!item) return;
    const confirmed = await ProtectedTransactionDialogService.confirm({
      key: `delete-published-${item.id}`,
      matchClass: "ic-confirm-published-delete",
      dialogOptions: {
        classes: ["ic-confirm-published-delete"],
        window: { title: "Delete Published Item", modal: true },
        content: `<div class="ic-confirm-item-content"><i class="fa-solid fa-triangle-exclamation"></i><div><h2>Delete Published Item?</h2><p>This permanently deletes <strong>${foundry.utils.escapeHTML(item.name)}</strong> from the Item Creator Published Library. Existing Actor or World copies are not affected.</p></div></div>`,
        yes: { label: "Delete", icon: "fa-solid fa-trash" },
        no: { label: "Cancel", icon: "fa-solid fa-xmark" }
      }
    });
    if (!confirmed) return;
    this.busy = true;
    try {
      await PublishedItemLibraryService.deletePublished(item);
      ui.notifications.info(`${item.name} deleted from Published Items.`);
    } catch (error) {
      console.error(`${MODULE_ID} | Unable to delete Published Item.`, error);
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
    for (const card of this.element?.querySelectorAll("[data-published-item]") ?? []) {
      card.hidden = Boolean(query) && !String(card.dataset.search ?? "").includes(query);
    }
    for (const subgroup of this.element?.querySelectorAll(".ic-published-subgroup") ?? []) {
      const visible = [...subgroup.querySelectorAll("[data-published-item]")].some(card => !card.hidden);
      subgroup.hidden = !visible;
    }
    for (const group of this.element?.querySelectorAll(".ic-published-group") ?? []) {
      const visible = [...group.querySelectorAll("[data-published-item]")].some(card => !card.hidden);
      group.hidden = !visible;
    }
  }

  async #openNativePack(event) {
    event.preventDefault();
    const pack = await PublishedItemLibraryService.ensurePack();
    pack.render?.(true);
  }
}
