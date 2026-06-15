/**
 * Rank over time — not yet built.
 *
 * Until the rank chart ships, this route returns 404 rather than
 * showing a placeholder. Visibility over time lives on /today.
 */
import { notFound } from "next/navigation";

export default function RankPage() {
  notFound();
}
