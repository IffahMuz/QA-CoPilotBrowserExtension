CREATE EXTENSION IF NOT EXISTS vector;   -- pgvector on the same instance (future dedup; unused this build)

CREATE TABLE bug_reports (
    id                BIGSERIAL PRIMARY KEY,
    capture_id        UUID        NOT NULL UNIQUE,          -- idempotent intake
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status            VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
    target_url        TEXT,
    module            VARCHAR(255),
    severity          VARCHAR(20),
    priority          VARCHAR(20),
    draft_report      JSONB,
    edited_report     JSONB,
    ado_work_item_id  BIGINT,
    evidence_manifest JSONB,
    error_details     TEXT
);

CREATE INDEX idx_bug_reports_status ON bug_reports (status);
