const actorActiveEffectDeleteQueues = new Map();
const pendingActiveEffectDeletes = new Map();
const recentlyDeletedActiveEffects = new Map();
const ACTIVE_EFFECT_TOMBSTONE_MS = 12000;

function nestedErrorValues(error) {
  if (!error || (typeof error !== "object" && typeof error !== "function")) return [];
  const values = [
    error.cause,
    error.error,
    error.reason,
    error.response?.error,
    error.response?.data?.error,
    error.data?.error,
    error.data?.message,
    error.body?.error,
    error.body?.message
  ];
  if (Array.isArray(error.errors)) values.push(...error.errors);
  if (Array.isArray(error.details)) values.push(...error.details);
  return values.filter(Boolean);
}

function missingActiveEffectError(error, seen = new Set()) {
  if (!error || seen.has(error)) return false;
  if (typeof error === "object" || typeof error === "function") seen.add(error);
  const message = String(error?.message ?? error ?? "");
  if (/ActiveEffect\s+"[^"]+"\s+does not exist/i.test(message)
    || (/ActiveEffect/i.test(message) && /does not exist|not found|missing|unknown document|invalid document id/i.test(message))) return true;
  return nestedErrorValues(error).some(value => missingActiveEffectError(value, seen));
}

function actorOperationKey(actor) {
  return String(actor?.uuid ?? actor?.id ?? "actor");
}

function operationKey(actor, id) {
  return `${actorOperationKey(actor)}:${id}`;
}

function pruneTombstones(now = Date.now()) {
  for (const [key, expiresAt] of recentlyDeletedActiveEffects) {
    if (expiresAt <= now) recentlyDeletedActiveEffects.delete(key);
  }
}

function hasTombstone(actor, id, now = Date.now()) {
  pruneTombstones(now);
  return Number(recentlyDeletedActiveEffects.get(operationKey(actor, id)) ?? 0) > now;
}

function markTombstone(actor, id, now = Date.now()) {
  if (!id) return;
  recentlyDeletedActiveEffects.set(operationKey(actor, id), now + ACTIVE_EFFECT_TOMBSTONE_MS);
}

function enqueueActorActiveEffectDelete(actor, operation) {
  const key = actorOperationKey(actor);
  const previous = actorActiveEffectDeleteQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  actorActiveEffectDeleteQueues.set(key, current);
  return current.finally(() => {
    if (actorActiveEffectDeleteQueues.get(key) === current) actorActiveEffectDeleteQueues.delete(key);
  });
}

async function waitForActorActiveEffectDeletes(actor) {
  const pending = actorActiveEffectDeleteQueues.get(actorOperationKey(actor));
  if (!pending) return;
  try { await pending; } catch (_error) { /* The initiating caller receives the original error. */ }
}

/**
 * Delete Actor Active Effects idempotently and in one serialized batch per Actor.
 *
 * All Item Creator cleanup paths share the same Actor queue. IDs are revalidated
 * only after earlier removals finish, marked as pending before the batch request,
 * and tombstoned after completion. This prevents marker/payload cleanup,
 * expiration, reconciliation, and Combat teardown from racing each other with
 * separate deleteEmbeddedDocuments calls for the same application.
 */
export async function safeDeleteActiveEffects(actor, ids, options = {}) {
  if (!actor?.deleteEmbeddedDocuments) return [];
  const requested = [...new Set((ids ?? []).map(String).filter(Boolean))];
  if (!requested.length) return [];

  return enqueueActorActiveEffectDelete(actor, async () => {
    const candidates = requested.filter(id => {
      if (hasTombstone(actor, id)) return false;
      if (pendingActiveEffectDeletes.has(operationKey(actor, id))) return false;
      return Boolean(actor.effects?.get?.(id));
    });
    if (!candidates.length) return [];

    for (const id of candidates) pendingActiveEffectDeletes.set(operationKey(actor, id), true);
    try {
      // Revalidate once more after reserving every id. All Item Creator removals
      // for this Actor are now blocked behind this operation.
      const existing = candidates.filter(id => actor.effects?.get?.(id) && !hasTombstone(actor, id));
      if (!existing.length) return [];
      const deleted = await actor.deleteEmbeddedDocuments("ActiveEffect", existing, options);
      for (const id of existing) markTombstone(actor, id);
      return deleted ?? [];
    } catch (error) {
      if (!missingActiveEffectError(error)) throw error;

      // A non-Item-Creator deletion may have landed between the local
      // revalidation and the server operation. Treat already-absent documents
      // as reconciled, then retry only documents that are still present.
      const remaining = candidates.filter(id => actor.effects?.get?.(id) && !hasTombstone(actor, id));
      const results = [];
      for (const id of remaining) {
        try {
          const deleted = await actor.deleteEmbeddedDocuments("ActiveEffect", [id], options);
          results.push(...(deleted ?? []));
        } catch (nested) {
          if (!missingActiveEffectError(nested)) throw nested;
        } finally {
          markTombstone(actor, id);
        }
      }
      for (const id of candidates) if (!actor.effects?.get?.(id)) markTombstone(actor, id);
      console.debug("Item Creator | Active Effect cleanup reconciled an already-removed document.", {
        actor: actorOperationKey(actor),
        effectIds: candidates
      });
      return results;
    } finally {
      for (const id of candidates) pendingActiveEffectDeletes.delete(operationKey(actor, id));
    }
  });
}

/**
 * Update only Active Effects that still exist and are not scheduled for
 * removal. Updates wait for the Actor's deletion queue, so a final-use removal
 * cannot race a marker/payload refresh. A server-side stale-id response is
 * treated as completed cleanup.
 */
export async function safeUpdateActiveEffects(actor, updates, options = {}) {
  if (!actor?.updateEmbeddedDocuments) return [];
  await waitForActorActiveEffectDeletes(actor);
  const rows = (updates ?? []).filter(update => {
    const id = update?._id ?? update?.id;
    return id
      && !hasTombstone(actor, id)
      && !pendingActiveEffectDeletes.has(operationKey(actor, id))
      && actor.effects?.get?.(id);
  });
  if (!rows.length) return [];
  try {
    return await actor.updateEmbeddedDocuments("ActiveEffect", rows, options);
  } catch (error) {
    if (!missingActiveEffectError(error)) throw error;
    const results = [];
    for (const row of rows) {
      const id = row?._id ?? row?.id;
      if (!id || hasTombstone(actor, id) || pendingActiveEffectDeletes.has(operationKey(actor, id))
        || !actor.effects?.get?.(id)) continue;
      try {
        const updated = await actor.updateEmbeddedDocuments("ActiveEffect", [row], options);
        results.push(...(updated ?? []));
      } catch (nested) {
        if (!missingActiveEffectError(nested)) throw nested;
        markTombstone(actor, id);
      }
    }
    return results;
  }
}

export const __documentOperationTest = Object.freeze({
  missingActiveEffectError,
  actorOperationKey,
  operationKey,
  hasTombstone,
  markTombstone,
  ACTIVE_EFFECT_TOMBSTONE_MS
});
