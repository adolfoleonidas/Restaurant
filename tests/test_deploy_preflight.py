"""Contract checks for the read-only deployment preflight workflow."""
import contextlib
import io
import os
import re
import sys
import textwrap
import types
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "deploy.yml"


class DeployPreflightTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")
        script_start = cls.workflow.index("script: |") + len("script: |")
        cls.script = textwrap.dedent(cls.workflow[script_start:])

    def _python_source(self):
        match = re.search(
            r"docker compose exec -T .*?backend python - (?:2>/dev/null )?<<'PY'\n(?P<source>.*?)\n\s*PY",
            self.workflow,
            re.DOTALL,
        )
        self.assertIsNotNone(match, "read-only Python query block is missing")
        return textwrap.dedent(match.group("source"))

    def _run_preflight(self, indexes=None, fail=False, absent=False):
        source = self._python_source()
        calls = []

        class Cursor:
            def __init__(self, rows):
                self.rows = rows
                self.closed = False
                self.iterated = 0

            def __iter__(self):
                for row in self.rows:
                    self.iterated += 1
                    yield row

            def close(self):
                self.closed = True
                calls.append(("index_cursor_close",))

        class Collection:
            def list_indexes(self):
                calls.append(("list_indexes",))
                if absent:
                    error = RuntimeError("Namespace missing")
                    error.code = 26
                    raise error
                cursor = Cursor(indexes or [])
                calls.append(("index_cursor", cursor))
                return cursor

            def count_documents(self, query, **options):
                calls.append(("count_documents", query, options))
                if query.get("branch_id") == {"$exists": False}:
                    return 2
                if query.get("branch_id") == {"$type": 10}:
                    return 1
                return 7

            def aggregate(self, pipeline, **options):
                calls.append(("aggregate", pipeline, options))
                return Cursor([
                    {"_id": {"tenant": "private-tenant", "branch": "private-branch"}, "total": 2},
                    {"_id": "private-tenant", "total": 2},
                ])

        class Database:
            def __getitem__(self, name):
                self.collection_name = name
                return Collection()

            def command(self, command, **options):
                calls.append(("command", command, options))
                if fail:
                    raise RuntimeError("mongodb://private-user:private-secret@host/private-tenant")
                return {"ok": 1}

        class Client:
            def __init__(self, uri, **options):
                calls.append(("MongoClient", uri, options))

            def __getitem__(self, name):
                return Database()

            def close(self):
                calls.append(("close",))

        fake_pymongo = types.ModuleType("pymongo")
        fake_pymongo.MongoClient = Client
        fake_stdout = io.StringIO()
        environment = {
            "MONGO_URL": "mongodb://private-user:private-secret@host/private-tenant",
            "DB_NAME": "private-tenant",
            "PREFLIGHT_SERVER_MAIN": "true",
            "PREFLIGHT_SERVER_COMMIT": "a" * 40,
            "PREFLIGHT_SERVER_CLEAN": "true",
        }
        with patch.dict(sys.modules, {"pymongo": fake_pymongo}), patch.dict(os.environ, environment):
            with contextlib.redirect_stdout(fake_stdout):
                exec(compile(source, "<preflight>", "exec"), {"__name__": "__main__"})
        output = fake_stdout.getvalue()
        self.assertEqual(len(output.splitlines()), 1)
        self.assertTrue(output.startswith("CASH_PREFLIGHT_JSON="))
        self.assertNotIn("private-user", output)
        self.assertNotIn("private-secret", output)
        self.assertNotIn("private-tenant", output)
        self.assertNotIn("private-branch", output)
        return output.split("=", 1)[1], calls, source

    def test_dispatch_choice_preserves_main_push_and_defaults_to_deploy(self):
        self.assertIn("branches: [main]", self.workflow)
        self.assertIn("workflow_dispatch:", self.workflow)
        self.assertIn("operation:", self.workflow)
        self.assertIn("type: choice", self.workflow)
        self.assertIn("options: [preflight, deploy, migrate_cash]", self.workflow)
        self.assertIn("default: deploy", self.workflow)

    def test_preflight_branch_precedes_every_deploy_mutation(self):
        self.assertIn('case "$DEPLOY_OPERATION" in', self.script)
        self.assertIn('*) printf', self.script)
        preflight_start = self.script.index('if [ "$DEPLOY_OPERATION" = preflight ]; then')
        branch_read = 'server_branch=$(git symbolic-ref --short -q HEAD 2>/dev/null || true)'
        deploy_start = self.script.index(branch_read, self.script.index(branch_read, preflight_start) + 1)
        preflight = self.script[preflight_start:deploy_start]
        for forbidden in ("git fetch", "git merge", "git pull", "touch .env", "docker compose up",
                          "curl", "docker compose logs", "openssl rand", "create_index", "drop_index"):
            self.assertNotIn(forbidden, preflight)
        self.assertIn("docker compose exec -T", preflight)

    def test_preflight_queries_are_bounded_read_only_and_redacted(self):
        indexes = [
            {"key": {"_id": 1}},
            {"key": {"restaurant_id": 1, "branch_id": 1}, "unique": True,
             "partialFilterExpression": {"status": "open", "branch_id": {"$type": "string"}}},
            {"key": {"restaurant_id": 1}, "unique": True,
             "partialFilterExpression": {"status": "open", "branch_id": None}},
        ]
        payload, calls, source = self._run_preflight(indexes=indexes)
        result = __import__("json").loads(payload)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["index_readiness"], "branch_ready")
        self.assertEqual(result["counts"]["open"], 7)
        self.assertEqual(result["counts"]["missing_branch_open"], 2)
        self.assertEqual(result["counts"]["explicit_null_branch_open"], 1)
        self.assertEqual(result["counts"]["duplicate_valid_branch_groups_at_least"], 2)
        self.assertEqual(result["counts"]["duplicate_legacy_groups_at_least"], 2)
        self.assertEqual(result["server"]["commit"], "a" * 40)
        self.assertEqual({line.split()[1] for line in source.splitlines() if line.strip().startswith("import ")},
                         {"os", "json", "pymongo"})
        self.assertTrue(all(call[-1].get("maxTimeMS") == 10_000 for call in calls
                            if call[0] in {"command", "count_documents", "aggregate"}))
        cursor = next(call[1] for call in calls if call[0] == "index_cursor")
        self.assertTrue(cursor.closed)
        self.assertFalse(any(call[0] in {"max_time_ms", "limit"} for call in calls))
        self.assertFalse(any("insert" in call[0] or "update" in call[0] or "drop" in call[0]
                             or "create" in call[0] for call in calls))

    def test_query_failure_is_controlled_and_never_prints_driver_error(self):
        payload, _, _ = self._run_preflight(fail=True)
        result = __import__("json").loads(payload)
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["reason"], "database_query_failed")

    def test_too_many_indexes_fail_closed_without_counts(self):
        payload, calls, _ = self._run_preflight(indexes=[{"key": {"_id": 1}}] * 1000)
        result = __import__("json").loads(payload)
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["reason"], "index_metadata_overflow")
        self.assertNotIn("counts", result)
        cursor = next(call[1] for call in calls if call[0] == "index_cursor")
        self.assertTrue(cursor.closed)
        self.assertEqual(cursor.iterated, 101)
        self.assertFalse(any(call[0] in {"count_documents", "aggregate"} for call in calls))

    def test_absent_cash_collection_reports_zeroes_without_starting_a_service(self):
        payload, calls, _ = self._run_preflight(absent=True)
        result = __import__("json").loads(payload)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["index_readiness"], "absent")
        self.assertEqual(result["counts"]["open"], 0)
        self.assertEqual(calls[-1], ("close",))

    def test_unsupported_exists_false_index_does_not_claim_branch_readiness(self):
        indexes = [
            {"key": {"restaurant_id": 1, "branch_id": 1}, "unique": True,
             "partialFilterExpression": {"status": "open", "branch_id": {"$type": "string"}}},
            {"key": {"restaurant_id": 1}, "unique": True,
             "partialFilterExpression": {"status": "open", "branch_id": {"$exists": False}}},
        ]
        payload, _, _ = self._run_preflight(indexes=indexes)
        self.assertEqual(__import__("json").loads(payload)["index_readiness"], "unready")

    def test_deploy_requires_main_fast_forward_of_exact_workflow_commit(self):
        self.assertIn('git symbolic-ref --short -q HEAD', self.script)
        self.assertIn('git status --porcelain --untracked-files=no', self.script)
        self.assertIn('git fetch --quiet origin "$EXPECTED_COMMIT"', self.script)
        self.assertIn('git merge --ff-only "$EXPECTED_COMMIT"', self.script)
        self.assertLess(self.script.index('git fetch --quiet origin "$EXPECTED_COMMIT"'),
                        self.script.index('git merge --ff-only'))


if __name__ == "__main__":
    unittest.main()
