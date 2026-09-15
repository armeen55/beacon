/** The four AI engines an observation may name, in the exact strings ai_observations stores. */
type EngineId = "chatgpt" | "perplexity" | "gemini" | "claude";

export const ALL_ENGINES: readonly EngineId[] = ["chatgpt", "perplexity", "gemini", "claude"];
