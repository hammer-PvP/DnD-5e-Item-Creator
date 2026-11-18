/**
 * Verify player-authored depletion rolls against actual ChatMessage Roll data.
 * This is intentionally independent of the client-supplied total, risk and
 * critical result. A socket payload is a request, not an authoritative roll.
 */
export function activeD20Value(roll) {
  const dice = Array.isArray(roll?.dice) ? roll.dice : [];
  const d20 = dice.find(die => Number(die?.faces) === 20);
  if (!d20) return null;
  const active = (d20.results ?? []).find(result => result?.active !== false && result?.discarded !== true);
  const value = Number(active?.result);
  return Number.isInteger(value) && value >= 1 && value <= 20 ? value : null;
}

export function verifyDepletionRoll({ nativeMessage, record, userId, actorId, claim }) {
  if (!nativeMessage || !record || !claim) return null;
  if (!["normal", "advantage", "disadvantage"].includes(claim.mode)) return null;
  if (String(nativeMessage.id ?? "") !== String(claim.rollMessageId ?? "")) return null;
  if (String(nativeMessage.user?.id ?? nativeMessage.user ?? "") !== String(userId ?? "")) return null;
  if (String(nativeMessage.speaker?.actor ?? "") !== String(actorId ?? "")) return null;
  if (Number(nativeMessage.timestamp ?? 0) < Number(record.createdAt ?? 0) - 1000) return null;
  const rolls = Array.isArray(nativeMessage.rolls) ? nativeMessage.rolls : [];
  // The native ChatMessage, not the client payload, determines the result.
  for (const roll of rolls) {
    const total = Number(roll?.total);
    const natural = activeD20Value(roll);
    if (!Number.isFinite(total) || natural === null) continue;
    // Multiple rolls can be contained in a single ChatMessage. Match the roll
    // the player's client actually selected without accepting invented values.
    if (total !== Number(claim.total) || natural !== Number(claim.natural)) continue;
    const policy = record.policy ?? {};
    const threshold = Number(policy.test === "d20" ? policy.target : policy.dc);
    if (!Number.isFinite(threshold)) return null;
    const risk = policy.test === "d20" ? natural === threshold : total < threshold;
    return { total, natural, risk, mode: claim.mode, rollMessageId: nativeMessage.id, verified: true };
  }
  return null;
}
