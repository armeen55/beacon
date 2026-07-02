import { notFound } from "next/navigation";
import { isOperatorModeServer } from "@/lib/operator-mode";

/**
 * /diagnostics/* route-level gate (FINAL PREMIUM PLAN item 106): every diagnostics route is
 * operator-only, enforced ONCE here at the layout instead of per-page (23+ routes, several of
 * which had no gate of their own). A customer or anonymous visitor gets a plain 404 - the
 * routes do not exist for them.
 */
export default function DiagnosticsLayout({ children }: { children: React.ReactNode }) {
  const operator = isOperatorModeServer();
  if (!operator) notFound();
  return <>{children}</>;
}
