import { TodayClient } from "./today-client";
import { respondToRecommendation } from "./recommendation-actions";
import { startExperimentAction } from "./experiment-actions";
import { confirmFindingAsChange, resolveFinding } from "./finding-actions";
import { loadTodayPageData } from "./today-data";

async function dismissFinding(findingId: string) {
  "use server";
  return resolveFinding(findingId, "rejected");
}

export default async function TodayPage() {
  const data = await loadTodayPageData();

  return (
    <div className="max-w-6xl">
      <TodayClient
        {...data}
        onRespondToRec={respondToRecommendation}
        onStartExperiment={startExperimentAction}
        onConfirmFinding={confirmFindingAsChange}
        onDismissFinding={dismissFinding}
      />
    </div>
  );
}
