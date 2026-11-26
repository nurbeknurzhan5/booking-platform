"""Генерирует таблицу endpoint'ов (docs/API-endpoints.md) из docs/openapi.json.
Запуск из корня репозитория: python -I scripts/gen-api-doc.py
"""
import json
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
spec = json.loads((root / "docs" / "openapi.json").read_text(encoding="utf-8"))


def access(path: str) -> str:
    p = path.removeprefix("/api/v1")
    if p.startswith("/public") or p.startswith("/integrations") or p.startswith("/health") or p.startswith("/dev") or p.startswith("/media"):
        return "публичный"
    if p.startswith("/admin"):
        return "суперадмин + MFA"
    if p.startswith("/me"):
        return "клиент (сессия)"
    if p.startswith("/auth"):
        return "по маршруту"
    if p.startswith("/organizations"):
        return "сотрудник организации (RBAC)"
    return "сотрудник"


groups: dict[str, list[str]] = {}
for path, ops in sorted(spec["paths"].items()):
    for method, op in ops.items():
        tag = (op.get("tags") or ["other"])[0]
        body = "да" if "requestBody" in op else ""
        params = ", ".join(p["name"] for p in op.get("parameters", []) if p.get("in") in ("path", "query"))
        summary = (op.get("summary") or "").replace("|", "/")
        groups.setdefault(tag, []).append(f"| `{method.upper()}` | `{path}` | {summary} | {params} | {body} | {access(path)} |")

out = [
    "# Справочник endpoint'ов (сгенерирован из OpenAPI)",
    "",
    "Файл создаётся скриптом `scripts/gen-api-doc.py` из `docs/openapi.json`. Схемы тел запросов и ответов — в Swagger UI (`/api/v1/docs`).",
    "Права доступа по ролям и лимиты частоты описаны в [API.md](API.md).",
    "",
]
for tag in sorted(groups):
    out += [f"## {tag}", "", "| Метод | URL | Назначение | Параметры | Тело | Доступ |", "|---|---|---|---|---|---|", *groups[tag], ""]
(root / "docs" / "API-endpoints.md").write_text("\n".join(out), encoding="utf-8", newline="\n")  # LF и на Windows (.gitattributes)
print("operations:", sum(len(v) for v in groups.values()))
