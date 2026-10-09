-- CreateTable
CREATE TABLE "model_benchmarks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "model_id" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "ran_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_benchmarks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "model_benchmarks_model_time" ON "model_benchmarks"("model_id", "ran_at" DESC);
