-- CreateTable
CREATE TABLE "capability_proposals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "description" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "review" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "capability_proposals_pkey" PRIMARY KEY ("id")
);
