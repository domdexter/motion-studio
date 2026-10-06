-- CreateTable
CREATE TABLE "EditStep" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "coalesceKey" TEXT,
    "changes" JSONB NOT NULL,
    "undone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EditStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EditStep_projectId_actor_createdAt_idx" ON "EditStep"("projectId", "actor", "createdAt");

-- AddForeignKey
ALTER TABLE "EditStep" ADD CONSTRAINT "EditStep_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
