-- AlterTable
ALTER TABLE "OverlayClip" ADD COLUMN     "annotations" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "crop" JSONB,
ADD COLUMN     "speedSegments" JSONB NOT NULL DEFAULT '[]';
