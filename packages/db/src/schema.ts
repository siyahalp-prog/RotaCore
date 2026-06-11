/**
 * PostgreSQL schemas for every Rota Core module.
 * Applied with `applySchema(client)` or manually via psql.
 */

export const EVENTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS rota_events (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  actor_id TEXT,
  target_id TEXT,
  correlation_id TEXT,
  idempotency_key TEXT UNIQUE,
  payload JSONB NOT NULL DEFAULT '{}',
  metadata JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rota_events_status ON rota_events (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_rota_events_type ON rota_events (type);
CREATE INDEX IF NOT EXISTS idx_rota_events_correlation ON rota_events (correlation_id);

CREATE TABLE IF NOT EXISTS rota_event_dead_letters (
  id UUID PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES rota_events (id),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export const NOTIFICATIONS_SCHEMA = `
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  channel TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, read, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (user_id, channel, type)
);

CREATE TABLE IF NOT EXISTS notification_templates (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL,
  channel TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_template TEXT NOT NULL,
  UNIQUE (type, channel)
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id UUID PRIMARY KEY,
  notification_id UUID NOT NULL REFERENCES notifications (id),
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  correlation_id TEXT,
  sent_at TIMESTAMPTZ
);
`;

export const ANALYTICS_SCHEMA = `
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY,
  event_name TEXT NOT NULL,
  page_url TEXT,
  referrer TEXT,
  event_properties JSONB,
  session_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  user_id TEXT,
  user_agent TEXT,
  browser TEXT,
  device TEXT,
  country TEXT,
  correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_name ON analytics_events (event_name, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_visitor ON analytics_events (visitor_id, created_at);
`;

export const SEARCH_SCHEMA = `
CREATE TABLE IF NOT EXISTS search_documents (
  id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB,
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  search_vector TSVECTOR,
  PRIMARY KEY (type, id)
);
CREATE INDEX IF NOT EXISTS idx_search_documents_vector ON search_documents USING GIN (search_vector);

CREATE TABLE IF NOT EXISTS search_logs (
  id UUID PRIMARY KEY,
  query TEXT NOT NULL,
  filters JSONB,
  result_count INT NOT NULL,
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export const MONITORING_SCHEMA = `
CREATE TABLE IF NOT EXISTS monitoring_errors (
  id UUID PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  service TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  context JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_monitoring_errors_fp ON monitoring_errors (fingerprint, created_at);

CREATE TABLE IF NOT EXISTS monitoring_logs (
  id UUID PRIMARY KEY,
  service TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  context JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export const FEATURE_FLAGS_SCHEMA = `
CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  rollout_percentage INT,
  allowed_roles TEXT[],
  allowed_user_ids TEXT[],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export const WORKFLOWS_SCHEMA = `
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  definition JSONB NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id UUID PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  trigger_event_id TEXT,
  status TEXT NOT NULL,
  steps JSONB NOT NULL DEFAULT '[]',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_wf ON workflow_runs (workflow_id, started_at DESC);
`;

export const ALL_SCHEMAS = [
  EVENTS_SCHEMA,
  NOTIFICATIONS_SCHEMA,
  ANALYTICS_SCHEMA,
  SEARCH_SCHEMA,
  MONITORING_SCHEMA,
  FEATURE_FLAGS_SCHEMA,
  WORKFLOWS_SCHEMA,
];
