export const dynamic = "force-dynamic";

import { Suspense } from "react";

import { PageHeader } from "@/components/data/page-header";
import { pathFromSegments, loadPageDossier, labelFromPath } from "./page-dossier-data";
import {
  DossierChartSection,
  DossierQueriesSection,
  DossierTeamReadsSection,
  DossierHistorySection,
  DossierCurrentMoveSection,
} from "./dossier-sections";

/**
 * Per-page dossier (BEACON_500 item 54, carry-over 87) - /page/[...path]. Everything
 * the team knows about one page in one place: the clicks chart with ship markers, its
 * top queries, the teammates' current reads, the history of changes and verdicts, and
 * the current recommendation if one exists. Composition only - every band calls an
 * existing cached loader through page-dossier-data.ts and streams behind its own
 * Suspense, following the Today page's pattern.
 */
export default async function PageDossierPage({ params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params;
  const path = pathFromSegments(segments ?? []);

  return (
    <div className="max-w-3xl space-y-4">
      <Suspense fallback={<DossierHeaderSkeleton path={path} />}>
        <DossierHeader path={path} />
      </Suspense>
      <Suspense fallback={<CardSkeleton />}>
        <DossierChartSection path={path} />
      </Suspense>
      <Suspense fallback={<CardSkeleton />}>
        <DossierQueriesSection path={path} />
      </Suspense>
      <Suspense fallback={<CardSkeleton />}>
        <DossierTeamReadsSection path={path} />
      </Suspense>
      <Suspense fallback={<CardSkeleton />}>
        <DossierCurrentMoveSection path={path} />
      </Suspense>
      <Suspense fallback={<CardSkeleton />}>
        <DossierHistorySection path={path} />
      </Suspense>
    </div>
  );
}

async function DossierHeader({ path }: { path: string }) {
  const dossier = await loadPageDossier(path);
  return (
    <PageHeader
      title={dossier.pageLabel}
      description={
        dossier.hasAnyData
          ? `Everything I know about ${path}, in one place.`
          : `I do not have any data on ${path} yet. Once a source reports on it, I will show it here.`
      }
    />
  );
}

function DossierHeaderSkeleton({ path }: { path: string }) {
  return <PageHeader title={labelFromPath(path)} description="Loading what the team knows..." />;
}

function CardSkeleton() {
  return <div aria-hidden className="h-24 animate-pulse rounded-lg border border-border/60 bg-surface-inset/40" />;
}
