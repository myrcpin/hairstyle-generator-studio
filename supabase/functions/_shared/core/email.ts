// Disposable email detection. Deliberately small, high-confidence list; extend via admin later.
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "sharklasers.com", "10minutemail.com",
  "10minutemail.net", "tempmail.com", "temp-mail.org", "temp-mail.io", "yopmail.com", "yopmail.net",
  "trashmail.com", "getnada.com", "nada.email", "dispostable.com", "maildrop.cc", "fakeinbox.com",
  "throwawaymail.com", "mintemail.com", "mohmal.com", "emailondeck.com", "tempinbox.com", "moakt.com",
  "spamgourmet.com", "mailnesia.com", "mytemp.email", "tempr.email", "discard.email", "burnermail.io",
  "tmpmail.org", "tmpmail.net", "inboxkitten.com", "mailpoof.com", "33mail.com", "spambox.us",
  "grr.la", "guerrillamailblock.com", "pokemail.net", "armyspy.com", "cuvox.de", "dayrep.com",
  "einrot.com", "fleckens.hu", "gustr.com", "jourrapide.com", "rhyta.com", "superrito.com", "teleworm.us",
  "mailcatch.com", "mail-temp.com", "emailfake.com", "tempmailo.com", "linshiyouxiang.net",
]);

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]{1,64}@[^\s@]{1,255}\.[a-z]{2,}$/i.test(email.trim()) && email.length <= 254;
}

export function isDisposableEmail(email: string): boolean {
  const domain = normaliseEmail(email).split("@")[1] ?? "";
  if (!domain) return false;
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  // subdomains of known disposable providers
  for (const d of DISPOSABLE_DOMAINS) if (domain.endsWith("." + d)) return true;
  return false;
}
