import { redirect } from "next/navigation";

/**
 * `/settings` lands on Connectors (2026-06-15 goal pivot): connecting
 * GSC/GA4/SEMrush/Profound/Clarity/Wix is the first thing a customer must do,
 * so Settings opens on the connect surface rather than the prompts editor.
 */
export default function SettingsPage() {
  redirect("/settings/connectors");
}
