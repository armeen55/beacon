/**
 * Move detail — not yet built.
 *
 * Until the move-detail screen ships, this route returns 404 rather
 * than showing a placeholder. Guided execution lives on /recommendations.
 */
import { notFound } from "next/navigation";

export default function MoveDetailPage() {
  notFound();
}
