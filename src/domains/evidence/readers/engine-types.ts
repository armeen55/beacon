/** The four AI engines an observation may name. Platform values written to prompt_answer_observations use these exact
 *  strings; "chatgpt" and "perplexity" match the historical native-poll labels so old reads keep working unchanged. */
type EngineId = "chatgpt" | "perplexity" | "gemini" | "claude";

export const ALL_ENGINES: readonly EngineId[] = ["chatgpt", "perplexity", "gemini", "claude"];
