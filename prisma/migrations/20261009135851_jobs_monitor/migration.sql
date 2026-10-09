-- CreateTable
CREATE TABLE "job_watches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_checked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_watches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_findings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "watch_id" UUID NOT NULL,
    "source_url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "snippet" TEXT,
    "matched_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notified" BOOLEAN NOT NULL DEFAULT false,
    "found_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_watches_name_key" ON "job_watches"("name");

-- CreateIndex
CREATE UNIQUE INDEX "job_findings_watch_id_source_url_title_key" ON "job_findings"("watch_id", "source_url", "title");

-- AddForeignKey
ALTER TABLE "job_findings" ADD CONSTRAINT "job_findings_watch_id_fkey" FOREIGN KEY ("watch_id") REFERENCES "job_watches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
