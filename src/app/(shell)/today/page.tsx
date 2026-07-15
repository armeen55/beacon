import { redirect } from "next/navigation";

/**
 * Compatibility route for old bookmarks, onboarding copy, and browser history.
 * Today has lived at `/` since the customer-surface consolidation, but a normal
 * user should never get a 404 for the product's primary page name.
 */
export default function TodayCompatibilityPage() {
  redirect("/");
}
