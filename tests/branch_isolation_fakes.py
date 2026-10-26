"""Small in-memory database fakes shared by branch-isolation tests."""
import copy

class _Result:
    def __init__(self, matched=0, deleted=0):
        self.matched_count = matched
        self.modified_count = matched
        self.deleted_count = deleted


def _matches(row, query):
    for key, expected in (query or {}).items():
        if key == "$or":
            if not any(_matches(row, part) for part in expected):
                return False
        elif key == "$and":
            if not all(_matches(row, part) for part in expected):
                return False
        elif isinstance(expected, dict):
            if "$exists" in expected and ((key in row) != expected["$exists"]):
                return False
            if "$in" in expected and row.get(key) not in expected["$in"]:
                return False
            if "$nin" in expected and row.get(key) in expected["$nin"]:
                return False
            if "$ne" in expected and row.get(key) == expected["$ne"]:
                return False
            if "$gte" in expected and not (row.get(key) or "") >= expected["$gte"]:
                return False
        elif row.get(key) != expected:
            return False
    return True


def _project(row, projection):
    result = copy.deepcopy(row)
    if not projection:
        return result
    include = {key for key, enabled in projection.items() if enabled and key != "_id"}
    if include:
        return {key: value for key, value in result.items() if key in include}
    return {key: value for key, value in result.items() if projection.get(key, 1)}


class _Cursor:
    def __init__(self, rows):
        self.rows = rows
    def sort(self, *_): return self
    def limit(self, *_): return self
    async def to_list(self, length): return copy.deepcopy(self.rows[:length])


class _Collection:
    def __init__(self, rows=()):
        self.rows = copy.deepcopy(list(rows))
        self.reads = []
        self.writes = []
    async def find_one(self, query, projection=None):
        self.reads.append(copy.deepcopy(query))
        row = next((row for row in self.rows if _matches(row, query)), None)
        return _project(row, projection) if row is not None else None
    def find(self, query, projection=None):
        self.reads.append(copy.deepcopy(query))
        return _Cursor([_project(row, projection) for row in self.rows if _matches(row, query)])
    async def update_one(self, query, update, **kwargs):
        self.writes.append((copy.deepcopy(query), copy.deepcopy(update)))
        row = next((row for row in self.rows if _matches(row, query)), None)
        if row is None:
            return _Result()
        row.update(copy.deepcopy(update.get("$set", {})))
        for key in update.get("$unset", {}):
            row.pop(key, None)
        return _Result(1)
    async def update_many(self, query, update, **kwargs):
        self.writes.append((copy.deepcopy(query), copy.deepcopy(update)))
        rows = [row for row in self.rows if _matches(row, query)]
        for row in rows:
            row.update(copy.deepcopy(update.get("$set", {})))
        return _Result(len(rows))
    async def insert_one(self, row):
        self.rows.append(copy.deepcopy(row))
        return _Result(1)


class _DB:
    def __init__(self, *, orders=(), tables=(), zones=(), branches=(), attentions=(), table_groups=()):
        self.orders = _Collection(orders)
        self.tables = _Collection(tables)
        self.zones = _Collection(zones)
        self.branches = _Collection(branches or [{"id": "branch-a", "restaurant_id": "tenant-1"}, {"id": "branch-b", "restaurant_id": "tenant-1"}])
        self.attentions = _Collection(attentions)
        self.table_groups = _Collection(table_groups)
        self.users = _Collection()
        self.counters = _Collection()
        self.audit_logs = _Collection()
        # `require_payment_to_close` se lee al liberar/cerrar una mesa.
        self.restaurants = _Collection()


def _user(role="mozo", branch_id="branch-a", **extra):
    return {"id": "staff-1", "restaurant_id": "tenant-1", "role": role,
            "branch_id": branch_id, **extra}


def _order(order_id, branch_id, **extra):
    row = {"id": order_id, "restaurant_id": "tenant-1", "branch_id": branch_id,
           "status": "nuevo", "created_at": "t1", "items": [{"status": "pendiente"}]}
    row.update(extra)
    return row


def _table(table_id, branch_id, **extra):
    row = {"id": table_id, "restaurant_id": "tenant-1", "branch_id": branch_id,
           "number": 1, "status": "disponible", "area": "Patio"}
    row.update(extra)
    return row
