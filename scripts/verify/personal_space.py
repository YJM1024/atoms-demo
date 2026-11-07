"""Checks the personal workspace surface: rename, session persistence and account identity.

Uses the real backend with two signed JWTs; verifies rename ownership, that a reload
keeps the same account (token-based session, not an in-memory flag) and that /auth/me
exposes the identity fields the account menu displays.

Run from /workspace/app/backend:  python ../../scripts/verify/personal_space.py
"""
import json
import sys
import urllib.error
import urllib.request

sys.path.insert(0, "/workspace/app/backend")

from core.auth import create_access_token  # noqa: E402

BASE = "http://127.0.0.1:8000"
TOKENS = {
    "A": create_access_token({"sub": "verify-user-a", "email": "a@verify.local", "name": "账号 A", "role": "user"}),
    "B": create_access_token({"sub": "verify-user-b", "email": "b@verify.local", "name": "账号 B", "role": "user"}),
}
results = []


def call(method, path, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{BASE}{path}", data=data, method=method)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.loads(res.read().decode() or "null")
    except urllib.error.HTTPError as exc:
        return exc.code, (exc.read().decode()[:160] or None)


def record(check, ok, **detail):
    results.append({"check": check, "ok": ok, **detail})


# Identity shown by the account menu (name / email) must come from the session endpoint.
status, me = call("GET", "/api/v1/auth/me", TOKENS["A"])
identity = me if isinstance(me, dict) else {}
record("已登录会话返回账号标识", status == 200 and bool(identity.get("email")),
       http=status, fields=sorted(k for k in identity if k in {"id", "name", "email", "role"}))

status, _ = call("GET", "/api/v1/auth/me")
record("未登录读取会话被拒", status == 401, http=status)

# Rename is a projects update: allowed for the owner, rejected for everyone else.
status, project = call("POST", "/api/v1/entities/projects", TOKENS["A"],
                       {"title": "重命名前", "prompt": "个人空间核查", "code": "<h1>A</h1>", "messages": "[]", "version": 1})
assert status == 201, (status, project)
pid = project["id"]

status, renamed = call("PUT", f"/api/v1/entities/projects/{pid}", TOKENS["A"], {"title": "重命名后"})
record("本人重命名项目成功", status == 200 and renamed.get("title") == "重命名后", http=status, title=renamed.get("title"))

status, _ = call("PUT", f"/api/v1/entities/projects/{pid}", TOKENS["B"], {"title": "B 改的名字"})
record("他人重命名项目被拒", status == 404, http=status)

status, check = call("GET", f"/api/v1/entities/projects/{pid}", TOKENS["A"])
record("重命名后代码与版本不变", status == 200 and check["code"] == "<h1>A</h1>" and check["version"] == 1,
       http=status, version=check.get("version"))

# A fresh request with the stored token behaves like a page reload: same account, same project.
fresh_status, fresh = call("GET", "/api/v1/entities/projects?limit=200", TOKENS["A"])
owned = [p["id"] for p in (fresh.get("items") or [])]
record("用已有令牌重新请求仍是同一账号（等同刷新后保持登录）",
       fresh_status == 200 and pid in owned, http=fresh_status, projects=len(owned))

status, _ = call("GET", f"/api/v1/entities/projects/{pid}", "tampered.token.value")
record("伪造令牌被拒", status == 401, http=status)

call("DELETE", f"/api/v1/workspace/projects/{pid}", TOKENS["A"])

for item in results:
    print(json.dumps(item, ensure_ascii=False), flush=True)
print(json.dumps({"all_passed": all(r["ok"] for r in results), "total": len(results)}, ensure_ascii=False))
