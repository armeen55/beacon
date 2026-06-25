import { getBusinessConfigForCurrentTenant } from "@/lib/business-config";
import { buildEntitySchemaScript } from "@/domains/demand-graph/entity-schema";
import { EntityFoundationCopy } from "./today-entity-foundation-copy";

/**
 * today-entity-foundation-section (2026-06-25, L11) — the SITE entity foundation:
 * a one-time, copy-paste Organization + WebSite JSON-LD the operator drops in the
 * site <head> so Google + AI answer engines recognize the site as a named entity
 * (the bedrock under every page-level Article/FAQ schema). Deterministic, built
 * from business config; self-hides when there's no name/domain to ground it.
 */
export async function TodayEntityFoundationSection() {
  let script: string | null = null;
  let name = "";
  try {
    const cfg = await getBusinessConfigForCurrentTenant();
    name = cfg.name;
    script = buildEntitySchemaScript({
      name: cfg.name,
      domain: cfg.domain,
      description: cfg.industry ? `${cfg.name} — ${cfg.industry}` : undefined,
    });
  } catch {
    return null;
  }
  if (!script) return null;

  return (
    <section className="rounded-3xl border border-slate-200/70 bg-gradient-to-br from-slate-50/60 via-white to-indigo-50/20 p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
            <span className="text-indigo-500">◆</span> Entity foundation
          </h2>
          <p className="mt-1 max-w-xl text-sm text-gray-500">
            A one-time snippet that tells Google &amp; AI answer engines who <strong>{name}</strong> is — a
            named organization with its own website. Paste it once into your site&apos;s{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">&lt;head&gt;</code> (it applies
            site-wide). It&apos;s the bedrock under every page&apos;s schema.
          </p>
        </div>
      </div>
      <EntityFoundationCopy script={script} />
    </section>
  );
}
