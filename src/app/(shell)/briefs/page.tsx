import { briefs } from "@/lib/seed-data.server";
import { BriefsClient } from "./briefs-client";

export default function BriefsPage() {
  return <BriefsClient briefs={briefs} />;
}
