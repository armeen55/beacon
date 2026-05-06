import { redirect } from "next/navigation";

/**
 * 2026-05-06 demo-path fix — `/settings` no longer redirects to
 * `/settings/import`. Customer landing on Settings should NOT see the
 * import page first (it's an operator/transitional surface that
 * mentions historical Profound CSV imports). Redirect to
 * `/settings/prompts`, which is the most-relevant customer-facing
 * settings page (manage your daily-poll prompts).
 */
export default function SettingsPage() {
  redirect("/settings/prompts");
}
