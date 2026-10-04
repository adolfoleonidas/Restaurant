"""Safety contracts for the explicitly dispatched cash-index migration."""
import json
import re
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "deploy.yml"
NODE_HARNESS = r"""
const fs = require('fs');
const vm = require('vm');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const source = process.env.CASH_MIGRATION_SOURCE;
const events = [];
const indexes = input.indexes.map(index => JSON.parse(JSON.stringify(index)));
let countCalls = 0;
function countFor(query, snapshot) {
  let key = 'total';
  if (query && query.status === 'open' && query.branch_id && query.branch_id.$exists === false) key = 'missing_open';
  else if (query && query.status === 'open' && query.branch_id && query.branch_id.$type === 10) key = 'null_open';
  else if (query && query.status === 'open' && query.branch_id && query.branch_id.$type === 'string') key = 'string_open';
  else if (query && query.status === 'open') key = 'open';
  const changed = input.afterCounts;
  if (snapshot >= 2 && changed && Object.prototype.hasOwnProperty.call(changed, key)) return changed[key];
  return input.counts[key];
}
const db = { async runCommand(command) {
  const operation = Object.keys(command)[0];
  events.push({ operation, command: JSON.parse(JSON.stringify(command)) });
  if (operation === 'buildInfo') return { ok: 1, version: '7.0.0' };
  if (operation === 'listIndexes') {
    const batchSize = command.cursor && command.cursor.batchSize;
    const rows = indexes.slice(0, batchSize || indexes.length).map(i => JSON.parse(JSON.stringify(i)));
    const rest = indexes.slice(rows.length);
    return { ok: 1, cursor: { id: rest.length ? 77 : 0, ns: 'private.cash_registers', firstBatch: rows, _rest: rest } };
  }
  if (operation === 'getMore') {
    const list = indexes.slice(101);
    return { ok: 1, cursor: { id: 0, ns: 'private.cash_registers', nextBatch: list.slice(0, command.batchSize).map(i => JSON.parse(JSON.stringify(i))) } };
  }
  if (operation === 'aggregate') return { ok: 1, cursor: { id: 0, firstBatch: input.duplicateGroups ? [{ groups: input.duplicateGroups }] : [] } };
  if (operation === 'count') {
    const snapshot = Math.floor(countCalls / 5);
    countCalls++;
    return { ok: 1, n: countFor(command.query, snapshot) };
  }
  if (operation === 'createIndexes') {
    for (const index of command.indexes) {
      if (input.failCreateName === index.name) return { ok: 0, code: 999, errmsg: 'private detail' };
      if (!indexes.some(existing => existing.name === index.name)) indexes.push(JSON.parse(JSON.stringify(index)));
    }
    return { ok: 1 };
  }
  if (operation === 'dropIndexes') {
    if (input.failDrop) return { ok: 0, code: 999, errmsg: 'private detail' };
    const before = indexes.length;
    for (let i = indexes.length - 1; i >= 0; i--) if (indexes[i].name === command.index) indexes.splice(i, 1);
    return { ok: indexes.length < before ? 1 : 0 };
  }
  if (operation === 'killCursors') return { ok: 1 };
  throw new Error('unexpected command');
} };
const printed = [];
(async () => {
  vm.runInNewContext(source, { db, process: { env: {
    CASH_BACKUP_ID: "cash-index-" + "a".repeat(40) + "-123",
    CASH_BACKUP_SHA256: "b".repeat(64), CASH_BACKUP_BYTES: "2048",
    CASH_BACKUP_VERIFIED: "true"
  } }, print: value => printed.push(String(value)) });
  await new Promise(resolve => setImmediate(resolve));
  process.stdout.write(JSON.stringify({ printed, events, indexes }));
})().catch(error => { process.stderr.write(String(error)); process.exitCode = 1; });
"""


def old_index(name="uniq_open_cash_register"):
    return {"name": name, "key": {"restaurant_id": 1}, "unique": True,
            "partialFilterExpression": {"status": "open"}}


def canonical_indexes():
    return [
        {"name": "uniq_open_cash_register_by_branch",
         "key": {"restaurant_id": 1, "branch_id": 1}, "unique": True,
         "partialFilterExpression": {"status": "open", "branch_id": {"$type": "string"}}},
        {"name": "uniq_open_legacy_cash_register", "key": {"restaurant_id": 1}, "unique": True,
         "partialFilterExpression": {"status": "open", "branch_id": None}},
    ]


class CashIndexMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")
        cls.script_match = re.search(r"script: \|\n(?P<script>.*)", cls.workflow, re.DOTALL)
        cls.assertIsNotNone = unittest.TestCase.assertIsNotNone
        cls.script = cls.script_match.group("script") if cls.script_match else ""
        cls.js_match = re.search(
            r"<<'CASH_MIGRATION_JS'\n(?P<source>.*?)\n\s*CASH_MIGRATION_JS",
            cls.workflow,
            re.DOTALL,
        )
        cls.source = cls.js_match.group("source") if cls.js_match else ""

    def _run_migration(self, indexes=None, **overrides):
        case = {
            "indexes": indexes if indexes is not None else [old_index()],
            "counts": {"total": 12, "open": 1, "string_open": 0, "missing_open": 1, "null_open": 0},
        }
        case.update(overrides)
        result = subprocess.run(
            ["node", "-e", NODE_HARNESS],
            input=json.dumps(case),
            text=True,
            capture_output=True,
            env={**__import__("os").environ, "CASH_MIGRATION_SOURCE": self.source,
                 "CASH_BACKUP_ID": "cash-index-" + "a" * 40 + "-123",
                 "CASH_BACKUP_SHA256": "b" * 64, "CASH_BACKUP_BYTES": "2048",
                 "CASH_BACKUP_VERIFIED": "true"},
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def _payload(self, run):
        rows = [line for line in run["printed"] if line.startswith("CASH_MIGRATION_JSON=")]
        self.assertEqual(len(rows), 1)
        self.assertNotIn("private", rows[0])
        return json.loads(rows[0].split("=", 1)[1])

    def test_migration_is_manual_and_never_the_push_or_default_operation(self):
        self.assertRegex(self.workflow, r"branches: \[main\]")
        self.assertIn("options: [preflight, deploy, migrate_cash]", self.workflow)
        self.assertIn("default: deploy", self.workflow)
        self.assertIn('if [ "$DEPLOY_OPERATION" = migrate_cash ]; then', self.script)
        self.assertLess(self.script.index('if [ "$DEPLOY_OPERATION" = preflight ]; then'),
                        self.script.index('if [ "$DEPLOY_OPERATION" = migrate_cash ]; then'))

    def test_tools_backup_dryrun_and_identity_guards_precede_pause_and_mongosh(self):
        migration = self.script.split('if [ "$DEPLOY_OPERATION" = migrate_cash ]; then', 1)[-1].split('\n            server_branch=', 1)[0]
        for required in ("EXPECTED_SERVER_COMMIT", "MIGRATION_RUN_ID", "mongodump", "mongorestore",
                         "--dryRun", "gzip -t", "sha256sum", "docker compose pause backend",
                         "docker compose unpause backend", "CASH_BACKUP_JSON=", "mongosh"):
            self.assertIn(required, migration)
        self.assertLess(migration.index("docker compose pause backend"), migration.index("mongodump --db="))
        self.assertLess(migration.index("mongodump --db="), migration.index("mongorestore --dryRun"))
        self.assertLess(migration.index("mongorestore --dryRun"), migration.index("mongo mongosh --quiet"))
        self.assertLess(migration.index("emit_backup\n"), migration.index("mongo mongosh --quiet"))
        self.assertIn("trap", migration)
        self.assertNotIn("docker compose stop", migration)
        self.assertNotIn("docker compose restart", migration)
        self.assertNotIn("docker compose up", migration)
        self.assertNotIn("MONGO_URL", migration)
        self.assertNotIn("JWT_SECRET", migration)

    def test_mongosh_migration_uses_only_index_writes_and_bounded_metadata(self):
        self.assertTrue(self.source, "migration JS heredoc is missing")
        for forbidden in ("insertOne", "insertMany", "updateOne", "updateMany", "deleteOne", "deleteMany",
                          "dropDatabase", "drop()", "restore:"):
            self.assertNotIn(forbidden, self.source)
        self.assertIn("batchSize: 101", self.source)
        self.assertIn("maxTimeMS: 10000", self.source)
        self.assertIn("async function run(command)", self.source)
        self.assertIn("await db.runCommand(command)", self.source)
        self.assertIn("$exists: true, $type: 10", self.source)
        self.assertIn("async function duplicateCounts()", self.source)
        self.assertRegex(self.source, r"await\s+run\(\{\s*createIndexes")
        self.assertRegex(self.source, r"await\s+run\(\{\s*dropIndexes")
        self.assertRegex(self.source, r"await\s+run\(\{\s*listIndexes")
        self.assertIn("uniq_open_cash_register_by_branch", self.source)
        self.assertIn("uniq_open_legacy_cash_register", self.source)

    def test_success_creates_and_verifies_both_indexes_before_dropping_only_matched_old(self):
        run = self._run_migration()
        payload = self._payload(run)
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["index_readiness"], "branch_ready")
        self.assertTrue(payload["documents_preserved"])
        self.assertEqual(payload["legacy_open_count"], 1)
        self.assertTrue(payload["backup_verified"])
        operations = [event["operation"] for event in run["events"]]
        self.assertEqual(operations.count("createIndexes"), 2)
        self.assertEqual(operations.count("dropIndexes"), 1)
        first_drop = operations.index("dropIndexes")
        self.assertEqual(operations[:first_drop].count("createIndexes"), 2)
        dropped = next(event["command"]["index"] for event in run["events"]
                       if event["operation"] == "dropIndexes")
        self.assertEqual(dropped, "uniq_open_cash_register")
        self.assertEqual([index["name"] for index in run["indexes"] if index.get("unique")],
                         [index["name"] for index in canonical_indexes()])

    def test_create_failure_keeps_old_index_and_never_drops_it(self):
        run = self._run_migration(failCreateName="uniq_open_cash_register_by_branch")
        payload = self._payload(run)
        self.assertEqual(payload["status"], "failed")
        self.assertTrue(any(index["name"] == "uniq_open_cash_register" for index in run["indexes"]))
        self.assertFalse(any(event["operation"] == "dropIndexes" for event in run["events"]))

    def test_ambiguous_old_index_and_metadata_overflow_fail_before_index_writes(self):
        ambiguous = self._run_migration(indexes=[old_index(), old_index("second_old")])
        self.assertEqual(self._payload(ambiguous)["status"], "failed")
        self.assertFalse(any(event["operation"] in {"createIndexes", "dropIndexes"}
                             for event in ambiguous["events"]))
        overflow = self._run_migration(indexes=[{"name": f"idx-{i}", "key": {"_id": 1}}
                                                for i in range(101)])
        self.assertEqual(self._payload(overflow)["status"], "failed")
        self.assertFalse(any(event["operation"] in {"createIndexes", "dropIndexes"}
                             for event in overflow["events"]))

    def test_unclassified_open_branch_type_fails_before_index_writes(self):
        run = self._run_migration(counts={"total": 12, "open": 2, "string_open": 0,
                                          "missing_open": 1, "null_open": 0})
        self.assertEqual(self._payload(run)["status"], "failed")
        self.assertTrue(self._payload(run)["rollback_protection"])
        self.assertFalse(any(event["operation"] in {"createIndexes", "dropIndexes"}
                             for event in run["events"]))

    def test_duplicate_open_groups_fail_before_index_writes(self):
        run = self._run_migration(duplicateGroups=1)
        self.assertEqual(self._payload(run)["status"], "failed")
        self.assertFalse(any(event["operation"] in {"createIndexes", "dropIndexes"}
                             for event in run["events"]))

    def test_already_ready_state_is_idempotent(self):
        run = self._run_migration(indexes=[{"name": "_id_", "key": {"_id": 1}}, *canonical_indexes()])
        payload = self._payload(run)
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["index_readiness"], "branch_ready")
        self.assertFalse(any(event["operation"] in {"createIndexes", "dropIndexes"}
                             for event in run["events"]))


    def test_document_count_change_after_old_drop_fails_and_restores_old_protection(self):
        run = self._run_migration(afterCounts={"total": 13})
        payload = self._payload(run)
        self.assertEqual(payload["status"], "failed")
        self.assertFalse(payload["documents_preserved"])
        self.assertTrue(payload["rollback_protection"])
        self.assertTrue(any(index["name"] == "uniq_open_cash_register" for index in run["indexes"]))
        events = [event["operation"] for event in run["events"]]
        self.assertLess(events.index("dropIndexes"), len(events) - 1 - events[::-1].index("createIndexes"))

    def test_snapshot_counts_are_completed_before_any_index_write(self):
        run = self._run_migration()
        events = run["events"]
        first_write = min(i for i, event in enumerate(events)
                          if event["operation"] in {"createIndexes", "dropIndexes"})
        before = events[:first_write]
        self.assertGreaterEqual(sum(event["operation"] == "count" for event in before), 5)
        self.assertGreaterEqual(sum(event["operation"] == "aggregate" for event in before), 2)
        self.assertTrue(all(event["command"].get("maxTimeMS") == 10000
                            for event in before if event["operation"] in {"count", "aggregate"}))


if __name__ == "__main__":
    unittest.main()
