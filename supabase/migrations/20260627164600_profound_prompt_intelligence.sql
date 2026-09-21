-- Profound Prompt Intelligence durable storage (additive only; RLS deny-all).
CREATE TABLE IF NOT EXISTS public.profound_prompt_rows (
  tenant_id      text        NOT NULL,
  prompt_id      text        NOT NULL,
  prompt         text        NOT NULL,
  topic_id       text,
  topic          text,
  tags           text[]      NOT NULL DEFAULT '{}',
  status         text,
  pulled_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, prompt_id)
);

CREATE TABLE IF NOT EXISTS public.profound_answer_rows (
  tenant_id        text        NOT NULL,
  answer_key       text        NOT NULL,
  prompt           text        NOT NULL,
  topic            text,
  model            text,
  date             date        NOT NULL,
  mentions         text[]      NOT NULL DEFAULT '{}',
  citation_urls    text[]      NOT NULL DEFAULT '{}',
  citation_hosts   text[]      NOT NULL DEFAULT '{}',
  themes           text[]      NOT NULL DEFAULT '{}',
  own_cited        boolean     NOT NULL DEFAULT false,
  own_mentioned    boolean     NOT NULL DEFAULT false,
  response_excerpt text,
  pulled_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, answer_key)
);

CREATE TABLE IF NOT EXISTS public.profound_query_fanout_rows (
  tenant_id     text        NOT NULL,
  fanout_key    text        NOT NULL,
  prompt        text        NOT NULL,
  query         text        NOT NULL,
  model         text,
  date          date        NOT NULL,
  total_fanouts double precision,
  share         double precision,
  pulled_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, fanout_key)
);

ALTER TABLE public.profound_prompt_rows        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profound_answer_rows        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profound_query_fanout_rows  ENABLE ROW LEVEL SECURITY;;
