const pendingActiveEffectDeletes = new Map();

function missingActiveEffectError(error) {
  const message = String(error?.message ?? error ?? "");
  return /ActiveEffect\s+\"[^\"]+\"\s+does not exist/i.test(message)
    || (/ActiveEffect/i.test(message) && /does not exist|not found|missing/i.test(message));
}

function operationKey(actor, id) {
  return `${actor?.uuid ?? actor?.id ?? "actor"}:${id}`;
}

async function deleteOneActiveEffect(actor, id, options) {
  if (!actor?.deleteEmbeddedDocuments || !id) return false;
  const key = operationKey(actor, id);
  const pending = pendingActiveEffectDeletes.get(key);
  if (pending) return pending;

  const operation = (async () => {
    try {
      if (!actor.effects?.get?.(id)) return false;
      await actor.deleteEmbeddedDocuments("ActiveEffect", [id], options);
      return true;
    } catch (error) {
      if (!missingActiveEffectError(error)) throw error;
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
 * per-document operation, and a server-side "does not exist" race is treated as
 * an already-completed cleanup rather than an unhandled runtime error.
 */
export async function safeDeleteActiveEffects(actor, ids, options = {}) {
  const unique = [...new Set((ids ?? []).filter(Boolean))];
  if (!unique.length) return [];
  return Promise.all(unique.map(id => deleteOneActiveEffect(actor, id, options)));
}

export const __documentOperationTest = Object.freeze({ missingActiveEffectError });
