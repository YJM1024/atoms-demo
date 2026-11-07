"""Two-account isolation check against the running backend.

Signs real JWTs with the backend's own secret (same claims shape as Atoms Auth),
then verifies that user B can neither list nor read/modify/delete user A's
project and versions, while the public share link stays readable with no token.

Run from /workspace/app/backend:  python ../../scripts/verify/auth_isolation.py
"""
import json
import sys
import urllib.error
import urllib.request

sys.path.insert(0, "/workspace/app/backend")

from core.auth import create_access_token  # noqa: E402

BASE = "http://127.0.0.1:8000"
USERS = {
    "A": {"sub": "verify-user-a", "email": "a@verify.local", "name": "账号 A", "role": "user"},
    "B": {"sub": "verify-user-b", "email": "b@verify.local", "name": "账号 B", "role": "user"},
}
TOKENS = {name: create_access_token(claims) for name, claims in USERS.items()}
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


# --- Account A creates a project with one version ---
status, project = call("POST", "/api/v1/entities/projects", TOKENS["A"],
                       {"title": "A 的隔离测试项目", "prompt": "隔离测试", "code": "<h1>A</h1>", "messages": "[]", "version": 1})
assert status == 201, (status, project)
pid = project["id"]
record("A 创建项目", True, project_id=pid, owner=project["user_id"])

status, version = call("POST", "/api/v1/entities/project_versions", TOKENS["A"],
                       {"project_id": pid, "version": 1, "code": "<h1>A v1</h1>", "summary": "隔离测试",
                        "mode": "full", "fix_rounds": 0, "test_passed": True, "test_issues": ""})
assert status == 201, (status, version)
vid = version["id"]

# --- Account B creates its own project, then tries to reach A's data ---
status, b_project = call("POST", "/api/v1/entities/projects", TOKENS["B"],
                         {"title": "B 的隔离测试项目", "prompt": "隔离测试 B", "code": "<h1>B</h1>", "messages": "[]", "version": 1})
assert status == 201, (status, b_project)
b_pid = b_project["id"]

status, listing = call("GET", "/api/v1/entities/projects?limit=200", TOKENS["B"])
ids = [item["id"] for item in listing["items"]]
record("B 的项目列表不含 A 的项目", status == 200 and pid not in ids and b_pid in ids,
       http=status, a_project_visible=pid in ids, b_sees=len(ids))

status, _ = call("GET", f"/api/v1/entities/projects/{pid}", TOKENS["B"])
record("B 读取 A 的项目被拒", status == 404, http=status)

status, _ = call("PUT", f"/api/v1/entities/projects/{pid}", TOKENS["B"], {"title": "被 B 篡改"})
record("B 修改 A 的项目被拒", status == 404, http=status)

status, _ = call("DELETE", f"/api/v1/entities/projects/{pid}", TOKENS["B"])
record("B 删除 A 的项目被拒", status == 404, http=status)

status, v_list = call("GET", f"/api/v1/entities/project_versions?limit=200&query=%7B%22project_id%22%3A{pid}%7D", TOKENS["B"])
record("B 查询 A 的版本列表为空", status == 200 and not v_list.get("items"), http=status, items=len(v_list.get("items") or []))

status, _ = call("GET", f"/api/v1/entities/project_versions/{vid}", TOKENS["B"])
record("B 读取 A 的版本被拒", status == 404, http=status)

status, _ = call("PUT", f"/api/v1/entities/project_versions/{vid}", TOKENS["B"], {"code": "<h1>hacked</h1>"})
record("B 修改 A 的版本被拒", status == 404, http=status)

status, _ = call("DELETE", f"/api/v1/workspace/projects/{pid}", TOKENS["B"])
record("B 通过工作台接口删除 A 的项目被拒", status == 404, http=status)

status, _ = call("POST", "/api/v1/workspace/share", TOKENS["B"], {"project_id": pid})
record("B 为 A 的项目创建分享被拒", status == 404, http=status)

# --- A verifies its data is intact, then shares it publicly ---
status, after = call("GET", f"/api/v1/entities/projects/{pid}", TOKENS["A"])
record("A 的项目未被篡改", status == 200 and after["title"] == "A 的隔离测试项目", http=status, title=after.get("title"))

status, share = call("POST", "/api/v1/workspace/share", TOKENS["A"], {"project_id": pid})
token = share["token"]
status, public = call("GET", f"/api/v1/workspace/public/{token}")
record("未登录可只读访问分享链接", status == 200 and public["code"] == "<h1>A</h1>", http=status, version=public.get("version"))

status, _ = call("GET", "/api/v1/entities/projects?limit=5")
record("未登录无法列出项目", status == 401, http=status)

status, _ = call("GET", f"/api/v1/workspace/public/{token}xyz")
record("失效分享 token 返回 404", status == 404, http=status)

status, _ = call("DELETE", f"/api/v1/workspace/share/{pid}", TOKENS["A"])
status, _ = call("GET", f"/api/v1/workspace/public/{token}")
record("停止分享后链接失效", status == 404, http=status)

# --- Cleanup ---
for owner, target in (("A", pid), ("B", b_pid)):
    call("DELETE", f"/api/v1/workspace/projects/{target}", TOKENS[owner])
status, listing = call("GET", "/api/v1/entities/projects?limit=200", TOKENS["A"])
record("清理测试数据", status == 200 and pid not in [i["id"] for i in listing["items"]], http=status)

for item in results:
    print(json.dumps(item, ensure_ascii=False), flush=True)
print(json.dumps({"all_passed": all(r["ok"] for r in results), "total": len(results)}, ensure_ascii=False))
