import { redirect } from "next/navigation";

/** Canonical opportunity detail lives under Opportunities (`/topics/opportunity/...`). */
export default async function LegacyOpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/topics/opportunity/${id}`);
}
