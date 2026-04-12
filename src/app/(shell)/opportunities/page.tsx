import { redirect } from "next/navigation";

/** Legacy list route — primary surface is Opportunities (`/topics`). */
export default function OpportunitiesPage() {
  redirect("/competitors");
}
