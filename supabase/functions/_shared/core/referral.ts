// Referral codes: short, unambiguous, uppercase (no 0/O/1/I).
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newReferralCode(length = 8): string {
  const b = new Uint8Array(length);
  crypto.getRandomValues(b);
  return [...b].map((x) => ALPHABET[x % ALPHABET.length]).join("");
}

export function normaliseReferralCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const c = v.trim().toUpperCase();
  return /^[A-Z0-9]{6,12}$/.test(c) ? c : null;
}

/** Progress towards the next reward, e.g. 5 qualified -> {inCycle: 2, perReward: 3}. */
export function referralProgress(qualified: number, rewards: number, perReward: number, maxRewards: number) {
  const capped = rewards >= maxRewards;
  return {
    qualified,
    rewards,
    maxRewards,
    perReward,
    inCycle: capped ? perReward : qualified - rewards * perReward,
    capped,
  };
}
