export type JourneyStage =
  | "awareness"
  | "consideration"
  | "comparison"
  | "decision"
  | "support"
  | "adversarial";

export type PromptSource =
  | "profound"
  | "mined"
  | "manual"
  | "expanded";

export type LibraryPrompt = {
  id: string;
  prompt_text: string;
  topic: string | null;
  city: string | null;
  service_type: string | null;
  journey_stage: JourneyStage;
  source: PromptSource;
  is_active: boolean;
  created_at: string;
};
