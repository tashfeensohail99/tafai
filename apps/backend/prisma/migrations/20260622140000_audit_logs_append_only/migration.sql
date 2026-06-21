-- Make audit.audit_logs APPEND-ONLY at the database level (tamper-resistance),
-- without needing a separate low-privilege role: a BEFORE UPDATE/DELETE trigger
-- blocks all UPDATEs, and blocks DELETEs unless the session has opted in via
--   SET LOCAL audit.allow_purge = 'on'
-- which ONLY the AuditRetentionService purge transaction does. INSERTs are
-- always allowed. Purely additive (a trigger); no data or column changes, and
-- it is invisible to the Prisma schema model.

CREATE OR REPLACE FUNCTION audit.audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_logs is append-only: UPDATE is not permitted';
  END IF;
  IF TG_OP = 'DELETE'
     AND coalesce(current_setting('audit.allow_purge', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'audit_logs is append-only: DELETE only via the retention job';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_immutable_guard ON audit.audit_logs;
CREATE TRIGGER audit_logs_immutable_guard
  BEFORE UPDATE OR DELETE ON audit.audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit.audit_logs_immutable();
