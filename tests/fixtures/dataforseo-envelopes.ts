/** BOUNDED exact-shape DataForSEO response fixtures, transcribed from docs.dataforseo.com on 2026-07-24. Giant arrays are trimmed to 2-3 representative items; every field name and nesting level is preserved exactly so the
 *  provider-contract tests bind to the REAL envelope, not a guess. Sources are cited inline per fixture. */

// dataforseo_labs/google/keywords_for_site/live
export const labsKeywordsForSiteLive = {
  version: "0.1.20241227", status_code: 20000, status_message: "Ok.", cost: 0.0102,
  tasks: [{ id: "labs-1", status_code: 20000, status_message: "Ok.", cost: 0.0102, result: [{
    se_type: "google", target: "apple.com", location_code: 2840, language_code: "en", total_count: 61789671, items_count: 2, offset: 0,
    items: [
      { se_type: "google", keyword: "video editing app for ipad pro", location_code: 2840, language_code: "en",
        keyword_info: { se_type: "google", competition: 0.1, competition_level: "LOW", cpc: 1.36, search_volume: 30, monthly_searches: [{ year: 2025, month: 1, search_volume: 30 }, { year: 2024, month: 12, search_volume: 30 }] },
        keyword_properties: { se_type: "google", keyword_difficulty: 60 }, search_intent_info: { se_type: "google", main_intent: "transactional" } },
      { se_type: "google", keyword: "apple watch couldn't pair", location_code: 2840, language_code: "en",
        keyword_info: { se_type: "google", competition: null, competition_level: "LOW", cpc: null, search_volume: 40, monthly_searches: [{ year: 2025, month: 1, search_volume: 50 }, { year: 2024, month: 12, search_volume: 70 }] },
        keyword_properties: { se_type: "google", keyword_difficulty: 13 }, search_intent_info: { se_type: "google", main_intent: "commercial" } },
    ],
  }] }],
};

// serp/google/organic/task_get/advanced
export const serpTaskGetAdvanced = {
  version: "3.0", status_code: 20000, status_message: "Ok.", cost: 0.05,
  tasks: [{ id: "task-serp-1", status_code: 20000, status_message: "Ok.", cost: 0.05, result: [{
    keyword: "python programming", type: "organic", se_domain: "google.com", location_code: 2840, language_code: "en", items_count: 5,
    items: [
      { type: "organic", rank_group: 1, rank_absolute: 1, domain: "python.org", title: "Welcome to Python.org", url: "https://www.python.org/", description: "The official home." },
      { type: "organic", rank_group: 2, rank_absolute: 2, domain: "w3schools.com", title: "Python Tutorial - W3Schools", url: "https://www.w3schools.com/python/", description: "Tutorials." },
      { type: "people_also_ask", rank_group: 1, rank_absolute: 5, items: [
        { type: "people_also_ask_element", title: "Is Python good for beginners?", expanded_element: { type: "people_also_ask_expanded", questions: [{ type: "people_also_ask_question", title: "Is Python good for beginners?", answer: "Yes." }] } },
        { type: "people_also_ask_element", title: "What can you do with Python?", expanded_element: { type: "people_also_ask_expanded", questions: [{ type: "people_also_ask_question", title: "What can you do with Python?", answer: "A lot." }] } },
      ] },
      { type: "related_searches", rank_group: 2, rank_absolute: 10, items: ["python programming for beginners", "python programming tutorial", "python programming examples"] },
      { type: "ai_overview", rank_group: 3, rank_absolute: 3, items: [{
        type: "ai_overview_element", title: "What is Python?", text: "Python is a high-level programming language.", markdown: "**Python** is high-level.",
        references: [
          { type: "ai_overview_reference", source: "Python.org", domain: "python.org", url: "https://www.python.org/about/", title: "About Python", text: "Work quickly." },
          { type: "ai_overview_reference", source: "Wikipedia", domain: "wikipedia.org", url: "https://en.wikipedia.org/wiki/Python_(programming_language)", title: "Python (programming language)", text: "Interpreted." },
        ] }] },
    ],
  }] }],
};

// ai_optimization/chat_gpt/llm_responses/task_post (acknowledgement)
export const llmResponsesTaskPostAck = {
  version: "0.1.20241227", status_code: 20000, status_message: "Ok.", cost: 0.035,
  tasks: [{ id: "llm-task-1", status_code: 20100, status_message: "Task Created.", cost: 0.035, result_count: 0,
    path: ["v3", "ai_optimization", "chat_gpt", "llm_responses", "task_post"],
    data: { user_prompt: "best running shoes", model_name: "gpt-4o", tag: "TAGVALUE" }, result: null }],
};

// ai_optimization/chat_gpt/llm_responses/task_get
export const llmResponsesTaskGet = {
  version: "0.1.20241227", status_code: 20000, status_message: "Ok.", cost: 0,
  tasks: [{ id: "llm-task-1", status_code: 20000, status_message: "Ok.", cost: 0, result: [{
    model_name: "gpt-4o-2024-08-06", input_tokens: 12, output_tokens: 88, reasoning_tokens: 0, web_search: true, money_spent: 0.03, datetime: "2026-07-24 10:30:45 +00:00",
    fan_out_queries: ["best running shoes 2026", "top cushioned running shoes"],
    items: [{ type: "message", sections: [{ type: "text", text: "The top pick is the Brand X Runner.",
      annotations: [
        { title: "Brand X review", url: "https://runnersworld.com/brand-x", start_index: 4, end_index: 20, text: "Brand X Runner" },
        { title: "Best shoes guide", url: "https://www.wirecutter.com/running-shoes", start_index: 21, end_index: 30, text: "guide" },
      ] }] }],
  }] }],
};

// ai_optimization/perplexity/llm_responses/live
export const perplexityLive = {
  status_code: 20000, status_message: "Ok.", cost: 0.035,
  tasks: [{ id: "ppx-1", status_code: 20000, status_message: "Ok.", cost: 0.035, result: [{
    model_name: "sonar", input_tokens: 9, output_tokens: 40, web_search: true, money_spent: 0.03,
    items: [{ type: "message", sections: [{ type: "text", text: "Perplexity recommends Brand Y.", annotations: [{ title: "Brand Y", url: "https://www.gearlab.com/brand-y" }] }] }],
  }] }],
};

// ai_optimization/{chat_gpt,perplexity}/llm_responses/models (perplexity is Live-only)
export const chatgptModels = {
  version: "0.1.20241227", status_code: 20000, status_message: "Ok.", cost: 0,
  tasks: [{ id: "models-1", status_code: 20000, status_message: "Ok.", cost: 0, result: [
    { model_name: "gpt-3.5-turbo-1106", reasoning: false, web_search_supported: false, task_post_supported: true },
    { model_name: "gpt-4o", reasoning: false, web_search_supported: true, task_post_supported: true },
    { model_name: "gpt-5", reasoning: true, web_search_supported: true, task_post_supported: false },
  ] }],
};
export const perplexityModels = {
  status_code: 20000, status_message: "Ok.", cost: 0,
  tasks: [{ id: "ppx-models-1", status_code: 20000, status_message: "Ok.", cost: 0, result: [
    { model_name: "sonar-reasoning-pro", reasoning: true, web_search_supported: true, task_post_supported: false },
    { model_name: "sonar", reasoning: false, web_search_supported: true, task_post_supported: false },
  ] }],
};
