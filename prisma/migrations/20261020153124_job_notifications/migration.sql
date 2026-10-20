-- CreateTable
CREATE TABLE "job_notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "content_hash" TEXT NOT NULL,
    "source_org" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "apply_url" TEXT,
    "published_at" TEXT,
    "eligibility" TEXT DEFAULT 'unreviewed',
    "match_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "match_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "harvested_by" TEXT NOT NULL DEFAULT 'laptop',
    "alerted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_notifications_content_hash_key" ON "job_notifications"("content_hash");

-- CreateIndex
CREATE INDEX "job_notifications_recent" ON "job_notifications"("created_at" DESC);

-- CreateIndex
CREATE INDEX "job_notifications_match" ON "job_notifications"("eligibility", "match_score" DESC);
