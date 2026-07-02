/**
 * Plain-English IndexNow setup copy (BEACON_500 item 75, 2026-07-02).
 *
 * No network calls here - pure copy helpers so the diagnostics section and
 * the config-store caller stay in sync on wording without duplicating it.
 * Business-voice: first person, concrete, one next step, no jargon.
 */

/** The key-file URL the operator needs to upload, given host + key. */
export function keyFileUrl(host: string, key: string, keyLocation?: string): string {
  if (keyLocation && keyLocation.trim() !== "") return keyLocation.trim();
  return `https://${host}/${key}.txt`;
}

/** The one-time setup instructions shown when no key is configured yet. */
export function indexNowSetupInstructions(): string {
  return (
    "I can tell Bing about every change the moment it goes live, which helps ChatGPT " +
    "find your pages too, since it browses using Bing's index. To turn this on: " +
    "1. Generate a key (any random letters and numbers, 8 or more characters). " +
    "2. Create a text file named <key>.txt containing just that key. " +
    "3. Upload it to your site so it loads at https://yoursite.com/<key>.txt. " +
    "4. Paste the same key here. Once I can see the file, I will ping Bing after every live change."
  );
}

/** The instructions shown when a key is configured but the key file has not
 *  been confirmed reachable yet (best-effort copy; we do not probe the file
 *  ourselves here to keep this module network-free - see verification note
 *  below). */
export function indexNowKeyFileReminder(host: string, key: string, keyLocation?: string): string {
  return (
    `Make sure ${keyFileUrl(host, key, keyLocation)} is live and contains exactly "${key}". ` +
    "Bing checks that file before it trusts a ping from this site."
  );
}
