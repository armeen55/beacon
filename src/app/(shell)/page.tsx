import { TodayClient } from "./today-client";
import { respondToRecommendation } from "./recommendation-actions";
import { startExperimentAction } from "./experiment-actions";
import { resolveFinding, promoteFinding } from "./finding-actions";
import { loadTodayPageData } from "./today-data";

export default async function TodayPage() {
  const data = await loadTodayPageData();

  return (
    <div className="max-w-3xl">
      <TodayClient
        {...data}
        onRespondToRec={respondToRecommendation}
        onStartExperiment={startExperimentAction}
        onResolveFinding={resolveFinding}
        onPromoteFinding={promoteFinding}
      />
    </div>
  );
}
