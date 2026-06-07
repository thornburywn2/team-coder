-- LISTEN/NOTIFY realtime spine.
-- Emits an id-only payload on 'db_notifications' for every row change. The
-- server's dedicated listener (P2) fetches the full row on receipt, which keeps
-- us comfortably under Postgres' 8 KB NOTIFY payload limit.
--
-- Idempotent: safe to re-run on every migrate.

CREATE OR REPLACE FUNCTION notify_record_change() RETURNS trigger AS $$
DECLARE
  key_col text := COALESCE(TG_ARGV[0], 'id');
  row_json jsonb;
  rec_id text;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    row_json := to_jsonb(OLD);
  ELSE
    row_json := to_jsonb(NEW);
  END IF;

  rec_id := row_json ->> key_col;

  PERFORM pg_notify(
    'db_notifications',
    json_build_object('op', TG_OP, 'table', TG_TABLE_NAME, 'id', rec_id)::text
  );

  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach to the tables whose changes drive the live UI. The argument is the
-- table's primary-key column name (user_presence keys on user_id, not id).
DROP TRIGGER IF EXISTS trg_tasks_change ON tasks;
CREATE TRIGGER trg_tasks_change AFTER INSERT OR UPDATE OR DELETE ON tasks
  FOR EACH ROW EXECUTE FUNCTION notify_record_change('id');

DROP TRIGGER IF EXISTS trg_proposals_change ON proposals;
CREATE TRIGGER trg_proposals_change AFTER INSERT OR UPDATE OR DELETE ON proposals
  FOR EACH ROW EXECUTE FUNCTION notify_record_change('id');

DROP TRIGGER IF EXISTS trg_votes_change ON votes;
CREATE TRIGGER trg_votes_change AFTER INSERT OR UPDATE OR DELETE ON votes
  FOR EACH ROW EXECUTE FUNCTION notify_record_change('id');

DROP TRIGGER IF EXISTS trg_comments_change ON comments;
CREATE TRIGGER trg_comments_change AFTER INSERT OR UPDATE OR DELETE ON comments
  FOR EACH ROW EXECUTE FUNCTION notify_record_change('id');

DROP TRIGGER IF EXISTS trg_modules_change ON modules;
CREATE TRIGGER trg_modules_change AFTER INSERT OR UPDATE OR DELETE ON modules
  FOR EACH ROW EXECUTE FUNCTION notify_record_change('id');

DROP TRIGGER IF EXISTS trg_activity_change ON activity_events;
CREATE TRIGGER trg_activity_change AFTER INSERT ON activity_events
  FOR EACH ROW EXECUTE FUNCTION notify_record_change('id');

DROP TRIGGER IF EXISTS trg_presence_change ON user_presence;
CREATE TRIGGER trg_presence_change AFTER INSERT OR UPDATE OR DELETE ON user_presence
  FOR EACH ROW EXECUTE FUNCTION notify_record_change('user_id');
