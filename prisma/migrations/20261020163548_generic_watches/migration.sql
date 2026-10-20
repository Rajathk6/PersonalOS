-- CreateTable
CREATE TABLE "watches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "targets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "terms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "interval_minutes" INTEGER NOT NULL DEFAULT 0,
    "allowed_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "extra" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_checked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "watches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watch_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "watch_id" UUID NOT NULL,
    "content_hash" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "summary" TEXT,
    "extra" JSONB NOT NULL DEFAULT '{}',
    "alerted_at" TIMESTAMPTZ(6),
    "found_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watch_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "watch_items_content_hash_key" ON "watch_items"("content_hash");

-- CreateIndex
CREATE INDEX "watch_items_watch_time" ON "watch_items"("watch_id", "found_at" DESC);

-- CreateIndex
CREATE INDEX "watch_items_feed" ON "watch_items"("alerted_at", "found_at" DESC);

-- AddForeignKey
ALTER TABLE "watch_items" ADD CONSTRAINT "watch_items_watch_id_fkey" FOREIGN KEY ("watch_id") REFERENCES "watches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
