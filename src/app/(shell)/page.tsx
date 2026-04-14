import { TodayClient } from "./today-client";
import { respondToRecommendation } from "./recommendation-actions";
import { startExperimentAction } from "./experiment-actions";
import { loadTodayPageData } from "./today-data";

export default async function TodayPage() {
  const data = await loadTodayPageData();

  return (
    <div className="max-w-6xl">
      <TodayClient
        {...data}
        onRespondToRec={respondToRecommendation}
        onStartExperiment={startExperimentAction}
      />
    </div>
  );
}
