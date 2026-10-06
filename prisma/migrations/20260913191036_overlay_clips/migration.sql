-- CreateTable
CREATE TABLE "OverlayClip" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "placement" TEXT NOT NULL DEFAULT 'fullscreen',
    "fit" TEXT NOT NULL DEFAULT 'cover',
    "startSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "durationSec" DOUBLE PRECISION NOT NULL,
    "trimStartSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trimEndSec" DOUBLE PRECISION,
    "playbackRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "endBehavior" TEXT NOT NULL DEFAULT 'hold',
    "volume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dim" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "opacity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "fadeInSec" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "fadeOutSec" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OverlayClip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OverlayClip_projectId_order_idx" ON "OverlayClip"("projectId", "order");

-- AddForeignKey
ALTER TABLE "OverlayClip" ADD CONSTRAINT "OverlayClip_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OverlayClip" ADD CONSTRAINT "OverlayClip_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
