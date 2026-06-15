-- AlterEnum: resoluções de denúncia com ação sobre o usuário (suspensão/ban)
ALTER TYPE "ReportStatus" ADD VALUE 'RESOLVED_SUSPENDED';
ALTER TYPE "ReportStatus" ADD VALUE 'RESOLVED_BANNED';
