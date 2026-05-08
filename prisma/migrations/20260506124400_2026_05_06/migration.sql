-- CreateIndex
CREATE INDEX "reports_reporter_event_status_idx" ON "reports"("reporterId", "eventId", "status");

-- CreateIndex
CREATE INDEX "reports_reporter_comment_status_idx" ON "reports"("reporterId", "commentId", "status");
