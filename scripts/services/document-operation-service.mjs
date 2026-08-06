const pendingActiveEffectDeletes = new Map();
const recentlyDeletedActiveEffects = new Map();
const ACTIVE_EFFECT_TOMBSTONE_MS = 8000;

function nestedErrorValues(error) {
  if (!error || (typeof error !== "object" && typeof error !== "function")) return [];
  const values = [error.cause, error.error, error.reason, error.response?.error, error.data?.error];
  if (Array.isArray(error.errors)) values.push(...error.errors);
  if (Array.isArray(error.details)) values.push(...error.details);
  return values.filter(Boolean);
}

function missingActiveEffectError(error, seen = new Set()) {
  if (!error || seen.has(error)) return false;
  if (typeof error === "object" || typeof error === "function") seen.add(error);
  const message = String(error?.message ?? error ?? "");
  if (/ActiveEffect\s+"[^"]+"\s+does not exist/i.test(message)
    || (/ActiveEffect/i.test(message) && /does not exist|not found|missing|unknown document/i.test(message))) return true;
  return nestedErrorValues(error).some(value => missingActiveEffectError(value, seen));
}

function operationKey(actor, id) {
  return `${actor?.uuid ?? actor?.id ?? "actor"}:${id}`;
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

async function deleteOneActiveEffect(actor, id, options) {
  if (!actor?.deleteEmbeddedDocuments || !id) return false;
  const key = operationKey(actor, id);
  if (hasTombstone(actor, id)) return false;
  const pending = pendingActiveEffectDeletes.get(key);
  if (pending) return pending;

  const operation = (async () => {
    try {
      if (hasTombstone(actor, id) || !actor.effects?.get?.(id)) {
        markTombstone(actor, id);
        return false;
      }
      await actor.deleteEmbeddedDocuments("ActiveEffect", [id], options);
      markTombstone(actor, id);
      return true;
    } catch (error) {
      if (!missingActiveEffectError(error)) throw error;
      markTombstone(actor, id);
      console.debug("Item Creator | Temporary effect already removed; cleanup reconciled.", {
        actor: actor?.uuid ?? actor?.id,
        effectId: id
      });
      return false;
    } finally {
      pendingActiveEffectDeletes.delete(key);
    }
  })();

  pendingActiveEffectDeletes.set(key, operation);
  return operation;
}

/**
 * Delete Actor Active Effects idempotently. Concurrent callers share the same
 * per-document operation. Recently completed removals are tombstoned briefly so
 * a near-consecutive reconciliation cannot retry the same stale document id.
 */
export async function safeDeleteActiveEffects(actor, ids, options = {}) {
  const unique = [...new Set((ids ?? []).filter(Boolean))];
  if (!unique.length) return [];
  return Promise.all(unique.map(id => deleteOneActiveEffect(actor, id, options)));
}

/**
 * Update only Active Effects that still exist and are not already scheduled for
 * removal. A server-side stale-id race is treated as a completed cleanup.
 */
export async function safeUpdateActiveEffects(actor, updates, options = {}) {
  if (!actor?.updateEmbeddedDocuments) return [];
  const rows = (updates ?? []).filter(update => {
    const id = update?._id ?? update?.id;
    return id && !hasTombstone(actor, id) && actor.effects?.get?.(id);
  });
  if (!rows.length) return [];
  try {
    return await actor.updateEmbeddedDocuments("ActiveEffect", rows, options);
  } catch (error) {
    if (!missingActiveEffectError(error)) throw error;
    const results = [];
    for (const row of rows) {
      const id = row?._id ?? row?.id;
      if (!id || hasTombstone(actor, id) || !actor.effects?.get?.(id)) continue;
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
  operationKey,
  hasTombstone,
  markTombstone,
  ACTIVE_EFFECT_TOMBSTONE_MS
});
