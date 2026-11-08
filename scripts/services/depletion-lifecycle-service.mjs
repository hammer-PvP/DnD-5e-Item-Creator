import { MODULE_ID } from "../constants.mjs";
import { normalizeDepletionPolicy } from "./charge-resource-service.mjs";

const CHANNEL = `module.${MODULE_ID}`;
const RECORD = "depletionRecord";
const pendingOperations = new Set();
const perItemOperations = new Set();
const escape = value => foundry.utils.escapeHTML(String(value ?? ""));
const copy = value => foundry.utils.deepClone(value);
const activeGM = () => [...game.users].filter(user => user.active && user.isGM).sort((a, b) => String(a.id).localeCompare(String(b.id)))[0] ?? null;
const isAuthority = () => game.user?.isGM && activeGM()?.id === game.user.id;
const currentRecord = message => message?.flags?.[MODULE_ID]?.[RECORD] ?? null;
const isPending = record => ["pending-roll", "awaiting-gm", "archiving"].includes(record?.state);
const owner = (actor, user) => Boolean(user?.isGM || actor?.testUserPermission?.(user, "OWNER"));
const ownedActor = item => item?.parent?.documentName === "Actor" ? item.parent : null;
const itemByRecord = record => game.actors?.get(record.actorId)?.items?.get(record.itemId) ?? null;

function testText(policy) {
  if (policy.mode === "destroy") return "The final charge has been expended. The GM must confirm whether to archive this item.";
  if (policy.test === "d20") return `Roll a d20. The item risks destruction on ${escape(policy.target)}.`;
  const dc = escape(policy.dc);
  if (policy.test === "ability") return `${escape(policy.ability.toUpperCase())} check (DC ${dc}). A failed check risks destruction.`;
  if (policy.test === "skill") return `${escape(CONFIG.DND5E.skills?.[policy.skill]?.label ?? policy.skill)} check (DC ${dc}). A failed check risks destruction.`;
  return `${escape(policy.tool || "Tool")} check (DC ${dc}). A failed check risks destruction.`;
}

function cardHtml(record) {
  const status = {
    "pending-roll": "Awaiting Player Roll",
    "awaiting-gm": "Awaiting GM Decision",
    archiving: "Archiving…",
    archived: "Archived — Item Destroyed",
    preserved: "Item Preserved",
    cancelled: "Cancelled",
    error: "Archive Error — GM Review"
  }[record.state] ?? "Pending";
  const policy = normalizeDepletionPolicy(record.policy);
  const rollText = record.roll ? `<div class="ic-depletion-result"><strong>Test result:</strong> ${escape(record.roll.total)}${record.roll.natural ? ` (d20: ${escape(record.roll.natural)})` : ""} · ${record.roll.risk ? "At risk of destruction" : "Survived the test"}${record.roll.mode ? ` · ${escape(record.roll.mode)}` : ""}${record.roll.verified === false ? " · Confirm against native roll message" : ""}</div>` : "";
  const errorText = record.error ? `<p class="ic-depletion-error">${escape(record.error)}</p>` : "";
  return `<article class="ic-depletion-card"><header><strong><i class="fa-solid fa-triangle-exclamation"></i> Item at Risk of Breaking</strong><small>${escape(record.itemName)} · ${escape(record.actorName)}</small></header><section class="ic-depletion-rule"><strong>Last charge expended — ${escape(record.label)}</strong><p>${testText(policy)}</p><p><strong>Charges remaining:</strong> 0 · <strong>Status:</strong> ${escape(status)}</p>${rollText}${errorText}</section><div class="ic-depletion-actions" data-ic-depletion-actions></div></article>`;
}

async function updateCard(message, patch) {
  const state = currentRecord(message);
  if (!state) return;
  const next = { ...copy(state), ...copy(patch), revision: (Number(state.revision) || 0) + 1 };
  await message.update({ [`flags.${MODULE_ID}.${RECORD}`]: next, content: cardHtml(next) });
}

function currentZero(item, record) {
  if (!item) return false;
  const uses = record.activityId
    ? item.system?.activities?.get?.(record.activityId)?.uses
      ?? Object.values(item.toObject()?.system?.activities ?? {}).find(a => a?._id === record.activityId)?.uses
    : item.system?.uses;
  return Number(uses?.max ?? 0) > 0 && Number(uses?.spent ?? 0) >= Number(uses?.max ?? 0);
}

function ensureWorldFolder(name, parent = null) {
  return game.folders.find(folder => folder.type === "Item" && folder.name === name
    && (folder.folder?.id ?? null) === (parent?.id ?? null)) ?? null;
}

export class ItemCreatorDepletionLifecycle {
  static registerHooks() {
    Hooks.on("renderChatMessageHTML", (message, html) => this.enhanceCard(message, html));
    Hooks.on("renderChatMessage", (message, html) => this.enhanceCard(message, html));
    Hooks.on("renderItemSheetV2", (app, html) => this.enhanceArchiveItemSheet(app, html));
    Hooks.on("renderItemSheet", (app, html) => this.enhanceArchiveItemSheet(app, html));
    Hooks.on("updateItem", item => {
      if (!isAuthority() || !ownedActor(item)) return;
      this.cancelInvalidPending(item).catch(error => console.warn(`${MODULE_ID} | Could not reconcile depletion card`, error));
    });
  }

  static registerSocket() {
    game.socket?.on?.(CHANNEL, payload => {
      if (!isAuthority() || !payload || payload.module !== MODULE_ID) return;
      this.#handleSocket(payload).catch(error => console.error(`${MODULE_ID} | Depletion request failed`, error));
    });
  }

  static async cancelInvalidPending(item) {
    for (const message of game.messages ?? []) {
      const record = currentRecord(message);
      if (!record || !["pending-roll", "awaiting-gm"].includes(record.state)) continue;
      if (record.actorId !== item.parent.id || record.itemId !== item.id) continue;
      if (!currentZero(item, record)) {
        await updateCard(message, { state: "cancelled", error: "The item is no longer exhausted. No destruction was performed." });
      }
    }
  }

  /** Recover cards stranded mid-archive after a reload. Never delete an Item
   * merely to finish recovery: the GM can review any ambiguous transaction. */
  static async reconcilePendingOnReady() {
    if (!isAuthority()) return;
    for (const message of game.messages ?? []) {
      const record = currentRecord(message);
      if (!record) continue;
      if (["pending-roll", "awaiting-gm"].includes(record.state)) {
        const item = itemByRecord(record);
        if (!currentZero(item, record)) {
          await updateCard(message, { state: "cancelled", error: "Item is missing or no longer exhausted. No destruction was performed." });
          continue;
        }
      }
      if (record.state === "archiving") {
        const item = itemByRecord(record);
        const archive = game.items.find(world => world.flags?.[MODULE_ID]?.destroyedArchive?.eventId === record.id);
        if (!item && archive) await updateCard(message, { state: "archived", archivedWorldItemId: archive.id });
        else if (item) await updateCard(message, { state: "awaiting-gm", error: "Previous archival was interrupted. Check for any partial archive copy before retrying." });
        else await updateCard(message, { state: "error", error: "Original and archive could not be located; GM review required." });
      } else if (record.state === "pending-roll" && record.policy?.resolution === "automatic") {
        try {
          const result = await this.#rollForRecord(message, "normal");
          if (result) await updateCard(message, { state: "awaiting-gm", roll: result });
        } catch (error) {
          await updateCard(message, { state: "awaiting-gm", error: "Automatic roll could not be resumed. GM review required." });
        }
      }
    }
  }

  static async #handleSocket(payload) {
    const sourceUser = game.users.get(payload.userId);
    if (!sourceUser?.active) return;
    if (payload.action === "exhaustion") {
      const actor = game.actors.get(payload.actorId);
      const item = actor?.items.get(payload.itemId);
      if (!item || !owner(actor, sourceUser)) return;
      const activityId = payload.event?.activityId ?? null;
      const activity = activityId ? item.system?.activities?.get?.(activityId) : null;
      const actualPolicy = activityId ? activity?.flags?.[MODULE_ID]?.chargeDepletion
        : item.flags?.[MODULE_ID]?.chargeDepletion;
      if (!actualPolicy || normalizeDepletionPolicy(actualPolicy).mode === "none") return;
      // Item update and module socket packets can be observed in either order.
      // Wait briefly for the authoritative Actor document to reflect zero uses.
      const record = { activityId };
      for (let attempt = 0; attempt < 8 && !currentZero(item, record); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      if (!currentZero(item, record)) return;
      return this.#createCard(item, {
        activityId, label: activity?.name || (activityId ? "Activity" : "shared charges"),
        policy: normalizeDepletionPolicy(actualPolicy)
      });
    }
    if (payload.action === "rollResult") {
      return this.#acceptRoll(payload, sourceUser);
    }
  }

  static async notifyExhaustion(item, event) {
    const actor = ownedActor(item);
    if (!actor || normalizeDepletionPolicy(event.policy).mode === "none") return;
    const payload = {
      module: MODULE_ID, action: "exhaustion", userId: game.user.id,
      actorId: actor.id, itemId: item.id,
      event: { label: String(event.label || "Charges"), activityId: event.activityId ?? null,
        policy: normalizeDepletionPolicy(event.policy) }
    };
    if (isAuthority()) return this.#createCard(item, payload.event);
    if (activeGM()) game.socket.emit(CHANNEL, payload);
    else {
      ui.notifications?.warn?.("Item Creator: depletion detected, but no GM is connected. The item is preserved for GM review.");
      // Keep the record durable even when the GM is offline. The later GM can
      // resolve this player-authored ChatMessage upon joining the session.
      const record = this.#newRecord(item, payload.event);
      if (record) await ChatMessage.create({ content: cardHtml(record), speaker: ChatMessage.getSpeaker({ actor }), flags: { [MODULE_ID]: { [RECORD]: record } } });
    }
  }

  static #newRecord(item, event) {
    const actor = ownedActor(item);
    if (!actor) return null;
    return {
      schema: 1, id: foundry.utils.randomID(), state: event.policy.mode === "destroy" ? "awaiting-gm" : "pending-roll",
      actorId: actor.id, itemId: item.id, actorName: actor.name, itemName: item.name,
      activityId: event.activityId ?? null, label: event.label, policy: normalizeDepletionPolicy(event.policy),
      createdAt: Date.now(), revision: 0, roll: null, archivedWorldItemId: null
    };
  }

  static async #createCard(item, event) {
    if (!isAuthority()) return;
    const actor = ownedActor(item);
    if (!actor) return;
    const signature = `${actor.id}:${item.id}:${event.activityId ?? "shared"}`;
    if (pendingOperations.has(signature)) return;
    pendingOperations.add(signature);
    try {
      if (!currentZero(item, { activityId: event.activityId })) return;
      // Only one outstanding depletion event per item/resource at a time.
      for (const message of game.messages ?? []) {
        const existing = currentRecord(message);
        if (isPending(existing) && existing.actorId === actor.id && existing.itemId === item.id
          && existing.activityId === (event.activityId ?? null)) return;
      }
      const record = this.#newRecord(item, event);
      const message = await ChatMessage.create({
        content: cardHtml(record), speaker: ChatMessage.getSpeaker({ actor }),
        flags: { [MODULE_ID]: { [RECORD]: record } }
      });
      if (record.policy.mode === "test" && record.policy.resolution === "automatic") {
        try {
          const result = await this.#rollForRecord(message, "normal");
          if (result) await updateCard(message, { state: "awaiting-gm", roll: result });
          else await updateCard(message, { state: "awaiting-gm", error: "Automatic roll was cancelled. GM review required." });
        } catch (error) {
          console.error(`${MODULE_ID} | Automatic depletion roll failed`, error);
          await updateCard(message, { state: "awaiting-gm", error: "Native test could not be rolled. GM review required." });
        }
      }
    } finally { pendingOperations.delete(signature); }
  }

  static async #rollForRecord(message, mode) {
    const record = currentRecord(message);
    if (record?.state !== "pending-roll") return;
    const actor = game.actors.get(record.actorId);
    if (!actor) return;
    const policy = normalizeDepletionPolicy(record.policy);
    const config = { advantage: mode === "advantage", disadvantage: mode === "disadvantage" };
    let roll;
    if (policy.test === "skill") roll = (await actor.rollSkill({ skill: policy.skill, ...config }, { configure: false }))?.[0];
    else if (policy.test === "ability") roll = (await actor.rollAbilityCheck({ ability: policy.ability, ...config }, { configure: false }))?.[0];
    else if (policy.test === "tool") {
      const key = Object.hasOwn(CONFIG.DND5E.tools ?? {}, policy.tool) ? policy.tool
        : Object.keys(CONFIG.DND5E.tools ?? {}).find(k => {
          const label = String(CONFIG.DND5E.tools[k]?.label ?? "");
          return [k, label, game.i18n?.localize?.(label) ?? label].some(value =>
            String(value).toLowerCase() === policy.tool.toLowerCase());
        });
      if (!key) throw new Error(`Unknown tool: ${policy.tool}. Configure a valid D&D5e tool ID or name.`);
      roll = (await actor.rollToolCheck({ tool: key, ...config }, { configure: false }))?.[0];
    } else {
      roll = await new Roll(mode === "advantage" ? "2d20kh" : mode === "disadvantage" ? "2d20kl" : "1d20").evaluate();
      await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `${record.itemName}: depletion d20` });
    }
    if (!roll) return;
    const relevantMessages = (game.messages?.contents ?? [...(game.messages ?? [])]).filter(chat =>
      String(chat.user?.id ?? chat.user ?? "") === String(game.user.id)
      && String(chat.speaker?.actor ?? "") === String(actor.id)
      && Number(chat.timestamp ?? 0) >= Number(record.createdAt ?? 0) - 1000);
    const rollMessage = relevantMessages.reverse().find(chat => (chat.rolls ?? []).some(r => Number(r.total) === Number(roll.total)));
    const natural = roll.dice?.find(die => die.faces === 20)?.results?.find(r => r.active !== false)?.result ?? roll.total;
    const risk = policy.test === "d20" ? Number(natural) === Number(policy.target) : Number(roll.total) < Number(policy.dc);
    return { total: Number(roll.total), natural: Number(natural), risk, mode,
      rollMessageId: rollMessage?.id ?? null, verified: Boolean(rollMessage) };
  }

  static async #acceptRoll(payload, user) {
    const message = game.messages.get(payload.messageId);
    const record = currentRecord(message);
    if (!record || record.state !== "pending-roll" || record.policy?.resolution !== "prompt") return;
    const actor = game.actors.get(record.actorId);
    if (!owner(actor, user)) return;
    const item = itemByRecord(record);
    if (!currentZero(item, record)) return;
    const key = `roll:${message.id}`;
    if (pendingOperations.has(key)) return;
    pendingOperations.add(key);
    try {
      // Player rolls a native D&D5e check in their client and posts a separate
      // visible roll message. GM receives its result, then decides the outcome.
      const result = payload.roll;
      if (!result || !Number.isFinite(result.total) || !Number.isFinite(result.natural)
        || !["normal", "advantage", "disadvantage"].includes(result.mode)) return;
      const native = result.rollMessageId ? game.messages.get(result.rollMessageId) : null;
      const verified = Boolean(native && String(native.user?.id ?? native.user ?? "") === String(user.id)
        && String(native.speaker?.actor ?? "") === String(actor.id)
        && Number(native.timestamp ?? 0) >= Number(record.createdAt ?? 0) - 1000
        && (native.rolls ?? []).some(roll => Number(roll.total) === Number(result.total)));
      await updateCard(message, { state: "awaiting-gm", roll: { ...result, verified } });
    } finally { pendingOperations.delete(key); }
  }

  static enhanceCard(message, html) {
    const record = currentRecord(message);
    if (!record) return;
    const root = html instanceof HTMLElement ? html : html?.[0] ?? html?.element ?? null;
    const target = root?.querySelector?.("[data-ic-depletion-actions]");
    if (!target || target.dataset.bound === "true") return;
    target.dataset.bound = "true";
    const actor = game.actors.get(record.actorId);
    const own = owner(actor, game.user);
    const button = (label, action, cls = "") => {
      const el = document.createElement("button");
      el.type = "button";
      el.textContent = label;
      el.className = `ic-depletion-button ${cls}`;
      el.addEventListener("click", async event => {
        event.preventDefault();
        el.disabled = true;
        try {
          if (action.startsWith("roll:")) await this.#playerRoll(message, action.split(":")[1]);
          else await this.#gmDecision(message, action);
        } catch (error) {
          console.error(`${MODULE_ID} | Depletion action failed`, error);
          ui.notifications?.error?.(`Item Creator: ${error.message}`);
        } finally { el.disabled = false; }
      });
      target.append(el);
    };
    if (record.state === "pending-roll" && record.policy?.resolution === "prompt" && own) {
      button("Roll Test", "roll:normal", "ic-primary");
      button("Advantage", "roll:advantage");
      button("Disadvantage", "roll:disadvantage");
    }
    if (isAuthority() && ["pending-roll", "awaiting-gm", "error"].includes(record.state)) {
      button("Preserve Item", "preserve");
      if (record.state === "awaiting-gm") button("Archive Item (Destroy)", "archive", "ic-danger");
    }
  }

  static async #playerRoll(message, mode) {
    const record = currentRecord(message);
    if (!record || record.state !== "pending-roll" || !owner(game.actors.get(record.actorId), game.user)) return;
    const item = itemByRecord(record);
    if (!currentZero(item, record)) return ui.notifications?.warn?.("Item charges are no longer zero. Ask the GM to review the event.");
    const pendingKey = `client-roll:${message.id}`;
    if (perItemOperations.has(pendingKey)) return;
    perItemOperations.add(pendingKey);
    try {
      const roll = await this.#rollForRecord(message, mode);
      if (!roll) return;
      const payload = { module: MODULE_ID, action: "rollResult", messageId: message.id, userId: game.user.id, roll };
      if (isAuthority()) await this.#acceptRoll(payload, game.user);
      else if (activeGM()) game.socket.emit(CHANNEL, payload);
      else if (message.isOwner) await updateCard(message, { state: "awaiting-gm", roll });
      else ui.notifications?.warn?.("Roll posted; a GM must reconnect to confirm the result and resolve the card.");
    } finally { perItemOperations.delete(pendingKey); }
  }

  static async #gmDecision(message, action) {
    if (!game.user?.isGM) return;
    if (!isAuthority()) return ui.notifications?.warn?.("Only the active primary GM may finalize an Item Creator depletion event.");
    const record = currentRecord(message);
    if (!record || !["pending-roll", "awaiting-gm", "error"].includes(record.state)) return;
    if (action === "archive" && record.state !== "awaiting-gm") return;
    const key = `decision:${record.actorId}:${record.itemId}`;
    if (pendingOperations.has(key)) return;
    pendingOperations.add(key);
    try {
      const item = itemByRecord(record);
      if (action === "preserve") {
        await updateCard(message, { state: "preserved", resolvedAt: Date.now(), resolvedBy: game.user.id });
        return;
      }
      if (action !== "archive") return;
      if (!item) return updateCard(message, { state: "error", error: "Item no longer exists" });
      if (!currentZero(item, record)) return updateCard(message, { state: "cancelled", error: "Charges recovered before archival" });
      await updateCard(message, { state: "archiving" });
      try {
        const archived = await this.archiveItem(item, { chatMessageId: message.id, record });
        await updateCard(message, { state: "archived", archivedWorldItemId: archived.id, resolvedAt: Date.now(), resolvedBy: game.user.id });
      } catch (error) {
        await updateCard(message, { state: "error", error: String(error.message || error) });
        throw error;
      }
    } finally { pendingOperations.delete(key); }
  }

  static async ensureArchiveFolder() {
    if (!game.user?.isGM) throw new Error("Only a GM can create the Destroyed Items archive.");
    let root = ensureWorldFolder("Item Creator");
    if (!root) root = await Folder.create({ name: "Item Creator", type: "Item", sorting: "a" });
    let folder = ensureWorldFolder("Destroyed Items", root);
    if (!folder) folder = await Folder.create({ name: "Destroyed Items", type: "Item", folder: root.id, sorting: "a" });
    return folder;
  }

  static async archiveItem(item, { chatMessageId = null, record = null } = {}) {
    if (!game.user?.isGM || !ownedActor(item)) throw new Error("Only a GM can archive an Actor-owned item.");
    const actor = ownedActor(item);
    const key = `${actor.uuid}:${item.id}`;
    if (perItemOperations.has(key)) throw new Error("An archive operation is already running for this item.");
    perItemOperations.add(key);
    let archived = null;
    try {
      const folder = await this.ensureArchiveFolder();
      const snapshot = copy(item.toObject());
      delete snapshot._id;
      delete snapshot._stats;
      delete snapshot.ownership;
      const originalName = item.name;
      snapshot.folder = folder.id;
      snapshot.name = originalName;
      snapshot.flags ??= {};
      snapshot.flags[MODULE_ID] ??= {};
      snapshot.flags[MODULE_ID].destroyedArchive = {
        status: "archiving", originalActorUuid: actor.uuid, originalActorName: actor.name,
        originalItemId: item.id, originalItemName: originalName,
        chatMessageId, eventId: record?.id ?? foundry.utils.randomID(),
        archivedAt: Date.now(), archivedBy: game.user.id, roll: copy(record?.roll ?? null)
      };
      archived = await Item.create(snapshot, { renderSheet: false });
      if (!archived?.id || !game.items.get(archived.id)) throw new Error("Archive record was not persisted; original item preserved.");
      // Validate essential native mechanics before removing the Actor document.
      const expected = item.toObject();
      const actual = archived.toObject();
      const count = value => Array.isArray(value) ? value.length : Object.keys(value ?? {}).length;
      if (count(expected.system?.activities) !== count(actual.system?.activities)
        || count(expected.effects) !== count(actual.effects)) throw new Error("Archived Activity/Effect verification failed; original item preserved.");
      if (String(expected.system?.uses?.max ?? "") !== String(actual.system?.uses?.max ?? "")
        || Number(expected.system?.uses?.spent ?? 0) !== Number(actual.system?.uses?.spent ?? 0)) {
        throw new Error("Archived charge-state verification failed; original item preserved.");
      }
      // Consumes may recharge or the Item may be moved while archival is saving.
      // Never remove a newly recharged or no-longer-embedded Item.
      if (record && (!currentZero(item, record) || !actor.items.get(item.id))) {
        throw new Error("The item changed or recovered before deletion; original item preserved.");
      }
      await actor.deleteEmbeddedDocuments("Item", [item.id]);
      if (actor.items.get(item.id)) throw new Error("Original item still exists in Actor inventory; archive requires GM review.");
      await archived.update({ [`flags.${MODULE_ID}.destroyedArchive.status`]: "archived" });
      return archived;
    } catch (error) {
      if (archived) {
        const archivedStatus = actor.items.get(item.id) ? "failed" : "archived";
        await archived.update({ [`flags.${MODULE_ID}.destroyedArchive.status`]: archivedStatus }).catch(() => {});
      }
      throw error;
    } finally { perItemOperations.delete(key); }
  }

  static async restoreItem(worldItem, targetActor = null) {
    if (!game.user?.isGM) throw new Error("Only a GM can restore Destroyed Items.");
    const archive = worldItem?.flags?.[MODULE_ID]?.destroyedArchive;
    if (!archive || archive.status !== "archived") throw new Error("The selected item is not an available archived Item.");
    const actor = targetActor ?? await fromUuid(archive.originalActorUuid);
    if (!actor || actor.documentName !== "Actor") throw new Error("Original Actor was not found. Select an alternate Actor to restore this item.");
    const key = `restore:${worldItem.uuid}`;
    if (perItemOperations.has(key)) throw new Error("Restoration is already in progress.");
    perItemOperations.add(key);
    try {
      const existing = actor.items.find(item => item.flags?.[MODULE_ID]?.restoredArchiveId === worldItem.id);
      if (existing) throw new Error(`This archive has already been restored to ${actor.name}.`);
      await worldItem.update({ [`flags.${MODULE_ID}.destroyedArchive.status`]: "restoring" });
      const source = copy(worldItem.toObject());
      delete source._id; delete source._stats; delete source.ownership;
      delete source.folder;
      delete source.flags?.[MODULE_ID]?.destroyedArchive;
      source.flags ??= {};
      source.flags[MODULE_ID] ??= {};
      source.flags[MODULE_ID].restoredArchiveId = worldItem.id;
      const [restored] = await actor.createEmbeddedDocuments("Item", [source]);
      if (!restored || !actor.items.get(restored.id)) throw new Error("Failed to verify restored item in the Actor inventory.");
      await worldItem.update({ [`flags.${MODULE_ID}.destroyedArchive.status`]: "restored",
        [`flags.${MODULE_ID}.destroyedArchive.restoredAt`]: Date.now(),
        [`flags.${MODULE_ID}.destroyedArchive.restoredBy`]: game.user.id,
        [`flags.${MODULE_ID}.destroyedArchive.restoredActorUuid`]: actor.uuid,
        [`flags.${MODULE_ID}.destroyedArchive.restoredItemId`]: restored.id });
      ui.notifications?.info?.(`${worldItem.name} restored to ${actor.name}.`);
      return restored;
    } catch (error) {
      // 'restoring' prevents a blind second restoration if the copy succeeded
      // but a subsequent flag update failed. The GM can inspect the archive.
      ui.notifications?.error?.(`Restoration requires GM review: ${error.message}`);
      throw error;
    } finally { perItemOperations.delete(key); }
  }

  static enhanceArchiveItemSheet(app, html) {
    const item = app?.document ?? app?.object;
    if (!game.user?.isGM || !item?.flags?.[MODULE_ID]?.destroyedArchive) return;
    const archive = item.flags[MODULE_ID].destroyedArchive;
    if (archive.status !== "archived") return;
    const root = html instanceof HTMLElement ? html : html?.[0] ?? html?.element ?? app?.element;
    if (!root?.querySelector || root.querySelector("[data-ic-restore-archive]")) return;
    const header = root.querySelector(".window-header .window-controls, .window-header, .sheet-header");
    if (!header) return;
    const button = document.createElement("button");
    button.type = "button"; button.className = "ic-restore-archived-item";
    button.dataset.icRestoreArchive = "true";
    button.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Restore Item';
    button.addEventListener("click", async event => {
      event.preventDefault();
      if (!game.user.isGM) return;
      try {
        const choices = [...game.actors].filter(actor => actor.documentName === "Actor")
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(actor => `<option value="${escape(actor.id)}" ${actor.uuid === archive.originalActorUuid ? "selected" : ""}>${escape(actor.name)}</option>`)
          .join("");
        if (!choices) throw new Error("There are no Actors available for restoration.");
        const actorId = await foundry.applications.api.DialogV2.prompt({
          window: { title: "Restore Archived Item" },
          content: `<p>Choose the Actor to receive <strong>${escape(item.name)}</strong>. Its archived charges are preserved.</p><label>Destination Actor<select name="actor">${choices}</select></label>`,
          ok: { label: "Restore Item", callback: (_event, button) => button.form?.elements?.actor?.value }
        });
        if (actorId) {
          const target = game.actors.get(actorId);
          if (!target) throw new Error("Selected Actor no longer exists.");
          await this.restoreItem(item, target);
        }
      } catch (error) { ui.notifications.error(`Item Creator: ${error.message}`); }
    });
    header.prepend(button);
  }
}
