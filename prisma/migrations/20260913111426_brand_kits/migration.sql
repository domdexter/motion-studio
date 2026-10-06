-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "brandKitId" TEXT,
ADD COLUMN     "brandKitVersion" INTEGER;

-- CreateTable
CREATE TABLE "BrandKit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "brand" JSONB NOT NULL,
    "design" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandKit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandKitFile" (
    "id" TEXT NOT NULL,
    "brandKitId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandKitFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandKitFile_brandKitId_idx" ON "BrandKitFile"("brandKitId");

-- CreateIndex
CREATE INDEX "Project_brandKitId_idx" ON "Project"("brandKitId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_brandKitId_fkey" FOREIGN KEY ("brandKitId") REFERENCES "BrandKit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandKitFile" ADD CONSTRAINT "BrandKitFile_brandKitId_fkey" FOREIGN KEY ("brandKitId") REFERENCES "BrandKit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
