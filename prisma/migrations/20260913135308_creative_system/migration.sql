-- AlterTable
ALTER TABLE "AssetRequest" ADD COLUMN     "brief" JSONB;

-- AlterTable
ALTER TABLE "Scene" ADD COLUMN     "creative" JSONB;

-- CreateTable
CREATE TABLE "CreativeRevision" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreativeRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativeReview" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'claude',
    "title" TEXT NOT NULL DEFAULT '',
    "request" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL,
    "overallScore" INTEGER,
    "scores" JSONB NOT NULL DEFAULT '{}',
    "strengths" JSONB NOT NULL DEFAULT '[]',
    "issues" JSONB NOT NULL DEFAULT '[]',
    "scope" JSONB NOT NULL DEFAULT '[]',
    "weakestScenes" JSONB NOT NULL DEFAULT '[]',
    "basedOn" JSONB,
    "measured" JSONB,
    "compositionHash" TEXT,
    "storyboardVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreativeReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreativeRevision_projectId_version_key" ON "CreativeRevision"("projectId", "version");

-- CreateIndex
CREATE INDEX "CreativeReview_projectId_createdAt_idx" ON "CreativeReview"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeReview_projectId_version_key" ON "CreativeReview"("projectId", "version");

-- AddForeignKey
ALTER TABLE "CreativeRevision" ADD CONSTRAINT "CreativeRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativeReview" ADD CONSTRAINT "CreativeReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
