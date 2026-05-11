import { TodayClient } from "./today-client";
import { TodayV2Client } from "./today-v2-client";
import { respondToRecommendation } from "./recommendation-actions";
import { confirmFindingAsChange, resolveFinding } from "./finding-actions";
import { loadTodayPageData } from "./today-data";

async function dismissFinding(findingId: string) {
  "use server";
  return resolveFinding(findingId, "rejected");
}

/**
 * Bundle 1 (Plan: i-want-a-maximum-depth-curried-curry) — switch /today
 * between the legacy 19-section layout and the v2 4-zone layout.
 *
 * Routing:
 *   - Default: v1 (TodayClient) for safety until v2 is verified hosted.
 *   - `BEACON_TODAY_V2=true` env: v2 (TodayV2Client) becomes the default.
 *   - `?legacy=1` query: always v1 (escape hatch for operators / regression
 *     debugging — works regardless of the env flag).
 *   - `?v2=1` query: always v2 (preview escape hatch — works regardless of
 *     the env flag, useful for hosted demos before flipping the env).
 */
function shouldUseV2(
  searchParams: Record<string, string | string[] | undefined>,
): boolean {
  if (searchParams.legacy === "1") return false;
  if (searchParams.v2 === "1") return true;
  return process.env.BEACON_TODAY_V2 === "true";
}

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [data, params] = await Promise.all([
    loadTodayPageData(),
    searchParams,
  ]);

  const useV2 = shouldUseV2(params);

  return (
    <div className="max-w-6xl">
      {useV2 ? (
        <TodayV2Client
          {...data}
          onRespondToRec={respondToRecommendation}
          onConfirmFinding={confirmFindingAsChange}
          onDismissFinding={dismissFinding}
        />
      ) : (
        <TodayClient
          {...data}
          onRespondToRec={respondToRecommendation}
          onConfirmFinding={confirmFindingAsChange}
          onDismissFinding={dismissFinding}
        />
      )}
    </div>
  );
}
