-- AlterTable
ALTER TABLE "uploads" ADD COLUMN     "extractError" TEXT,
ADD COLUMN     "extractMeta" TEXT,
ADD COLUMN     "extractStatus" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "extractedAt" TIMESTAMP(3),
ADD COLUMN     "sha256" TEXT;

