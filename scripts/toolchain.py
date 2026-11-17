#!/usr/bin/env python3
"""Language-agnostic toolchain helper for agents and workflows.

Detects every project/language under a path and gives one uniform interface
for formatting, linting, testing and building, so agents never have to guess
which tools a repo uses.

Usage:
  python3 scripts/toolchain.py detect [PATH]                 # JSON: projects + commands
  python3 scripts/toolchain.py run KIND [PATH] [--lang L]    # KIND: format|format-check|lint|test|build|check
  python3 scripts/toolchain.py files [PATH]                  # JSON: source files with line counts
  python3 scripts/toolchain.py slices [PATH] [--max-lines N] # JSON: files grouped into hunt slices

`check` runs format-check, lint, build and test in that order.
Exit code of `run` is 0 only if every command passed. Only stdlib is used.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

SKIP_DIRS = {
    ".git", "node_modules", "vendor", "target", "dist", "build", "out", ".venv",
    "venv", "__pycache__", ".mypy_cache", ".ruff_cache", ".pytest_cache", ".next",
    ".gradle", "bin", "obj", ".idea", ".vscode", "coverage", ".claude", "reports",
}

LANG_EXT = {
    "python": {".py"},
    "javascript": {".js", ".mjs", ".cjs", ".jsx"},
    "typescript": {".ts", ".tsx", ".mts", ".cts"},
    "go": {".go"},
    "rust": {".rs"},
    "java": {".java", ".kt", ".kts"},
    "c-cpp": {".c", ".h", ".cc", ".cpp", ".hpp", ".cxx"},
    "csharp": {".cs"},
    "ruby": {".rb"},
    "shell": {".sh", ".bash"},
    "php": {".php"},
    "swift": {".swift"},
}
EXT_LANG = {ext: lang for lang, exts in LANG_EXT.items() for ext in exts}
KINDS = ["format", "format-check", "lint", "build", "test"]


def has(tool: str) -> bool:
    return shutil.which(tool) is not None


def walk(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for name in filenames:
            yield Path(dirpath) / name


def source_files(root: Path) -> list[dict]:
    out = []
    for p in walk(root):
        lang = EXT_LANG.get(p.suffix)
        if not lang:
            continue
        try:
            lines = sum(1 for _ in p.open("rb"))
        except OSError:
            continue
        out.append({"path": str(p.relative_to(root)), "lang": lang, "lines": lines})
    out.sort(key=lambda f: f["path"])
    return out


def find_manifests(root: Path, names: set[str], max_depth: int = 3) -> list[Path]:
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        depth = len(Path(dirpath).relative_to(root).parts)
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        if depth >= max_depth:
            dirnames[:] = []
        for n in filenames:
            if n in names or any(n.endswith(x[1:]) for x in names if x.startswith("*")):
                found.append(Path(dirpath) / n)
    return found


def cmds(**kinds) -> dict:
    return {k.replace("_", "-"): v for k, v in kinds.items() if v}


def node_project(dirp: Path) -> dict:
    pkg = json.loads((dirp / "package.json").read_text() or "{}")
    scripts = pkg.get("scripts", {})
    runner = "pnpm" if (dirp / "pnpm-lock.yaml").exists() else "yarn" if (dirp / "yarn.lock").exists() else "npm"
    run = lambda s: f"{runner} run {s}"
    ts = (dirp / "tsconfig.json").exists()
    lint = [run("lint")] if "lint" in scripts else (["npx --no-install eslint ."] if has("eslint") else [])
    if ts and "typecheck" in scripts:
        lint.append(run("typecheck"))
    elif ts:
        lint.append("npx --no-install tsc --noEmit")
    return {
        "lang": "typescript" if ts else "javascript",
        "commands": cmds(
            format=[run("format")] if "format" in scripts else (["npx --no-install prettier --write ."] if has("prettier") else []),
            format_check=["npx --no-install prettier --check ."] if has("prettier") else [],
            lint=lint,
            build=[run("build")] if "build" in scripts else [],
            test=[run("test")] if "test" in scripts and "no test specified" not in scripts["test"] else [],
        ),
    }


def detect(root: Path) -> dict:
    root = root.resolve()
    projects: list[dict] = []
    claimed: set[tuple[str, Path]] = set()

    def add(dirp: Path, lang: str, commands: dict, manifest: str | None):
        claimed.add((lang, dirp))
        projects.append({"lang": lang, "root": str(dirp.relative_to(root)) or ".", "manifest": manifest, "commands": commands})

    for m in find_manifests(root, {"package.json"}):
        info = node_project(m.parent)
        add(m.parent, info["lang"], info["commands"], "package.json")
    for m in find_manifests(root, {"pyproject.toml", "setup.py", "requirements.txt"}):
        if ("python", m.parent) in claimed:
            continue
        add(m.parent, "python", python_cmds(m.parent), m.name)
    for m in find_manifests(root, {"go.mod"}):
        add(m.parent, "go", cmds(
            format=["gofmt -w ."], format_check=['test -z "$(gofmt -l .)" || (gofmt -l .; exit 1)'],
            lint=["go vet ./..."] + (["staticcheck ./..."] if has("staticcheck") else []),
            build=["go build ./..."], test=["go test ./..."]), "go.mod")
    for m in find_manifests(root, {"Cargo.toml"}):
        add(m.parent, "rust", cmds(
            format=["cargo fmt"], format_check=["cargo fmt --check"],
            lint=["cargo clippy --all-targets -- -D warnings"], build=["cargo build"], test=["cargo test"]), "Cargo.toml")
    for m in find_manifests(root, {"pom.xml"}):
        add(m.parent, "java", cmds(lint=["mvn -q -DskipTests verify"], build=["mvn -q -DskipTests package"], test=["mvn -q test"]), "pom.xml")
    for m in find_manifests(root, {"build.gradle", "build.gradle.kts"}):
        g = "./gradlew" if (m.parent / "gradlew").exists() else "gradle"
        add(m.parent, "java", cmds(lint=[f"{g} check -x test"], build=[f"{g} build -x test"], test=[f"{g} test"]), m.name)
    for m in find_manifests(root, {"CMakeLists.txt"}):
        if ("c-cpp", m.parent) in claimed or any(("c-cpp", p) in claimed for p in m.parents):
            continue
        add(m.parent, "c-cpp", cmds(
            format=["find . -name '*.[ch]pp' -o -name '*.[ch]' | xargs -r clang-format -i"] if has("clang-format") else [],
            build=["cmake -S . -B build && cmake --build build"], test=["ctest --test-dir build --output-on-failure"]), "CMakeLists.txt")
    for m in find_manifests(root, {"Makefile"}):
        if any(p["root"] == (str(m.parent.relative_to(root)) or ".") for p in projects):
            continue
        add(m.parent, "make", cmds(build=["make"], test=["make test"]), "Makefile")
    for m in find_manifests(root, {"Gemfile"}):
        add(m.parent, "ruby", cmds(
            format=["bundle exec rubocop -a"], lint=["bundle exec rubocop"],
            test=["bundle exec rspec" if (m.parent / "spec").exists() else "bundle exec rake test"]), "Gemfile")
    for m in find_manifests(root, {"*.csproj", "*.sln"}):
        add(m.parent, "csharp", cmds(
            format=["dotnet format"], format_check=["dotnet format --verify-no-changes"],
            build=["dotnet build"], test=["dotnet test"]), m.name)

    # Loose source files with no manifest: group by directory + language.
    covered = [Path(root / p["root"]) for p in projects]
    loose: dict[tuple[str, Path], list[str]] = {}
    for f in source_files(root):
        p = root / f["path"]
        if any(c == p.parent or c in p.parents for c in covered):
            continue
        loose.setdefault((f["lang"], p.parent), []).append(p.name)
    for (lang, dirp), files in sorted(loose.items(), key=lambda kv: str(kv[0][1])):
        c = loose_cmds(lang, dirp, files)
        if c is not None:
            add(dirp, lang, c, None)

    tools = sorted({c.split()[0] for p in projects for v in p["commands"].values() for c in v})
    builtin = {"test", "find", "for", "cd", "./gradlew"}
    missing = [t for t in tools if t not in builtin and not has(t)]
    return {"root": str(root), "projects": projects, "missing_tools": missing}


def python_cmds(dirp: Path) -> dict:
    tests = any(dirp.glob("test*")) or any(dirp.glob("**/test_*.py"))
    return cmds(
        format=["ruff format ."] if has("ruff") else (["black ."] if has("black") else []),
        format_check=["ruff format --check ."] if has("ruff") else (["black --check ."] if has("black") else []),
        lint=(["ruff check ."] if has("ruff") else []) + (["mypy ."] if has("mypy") and (dirp / "mypy.ini").exists() else []),
        build=["python3 -m compileall -q ."],
        test=(["python3 -m pytest -q"] if importlib.util.find_spec("pytest") else ["python3 -m unittest discover -q"]) if tests else [],
    )


def loose_cmds(lang: str, dirp: Path, files: list[str]) -> dict | None:
    fl = " ".join(sorted(files))
    if lang == "python":
        return python_cmds(dirp)
    if lang == "javascript":
        tests = [f for f in files if ".test." in f or f.startswith("test")]
        return cmds(
            format=[f"prettier --write {fl}"] if has("prettier") else [],
            format_check=[f"prettier --check {fl}"] if has("prettier") else [],
            lint=[f"for f in {fl}; do node --check \"$f\" || exit 1; done"],
            test=["node --test " + " ".join(tests)] if tests else [])
    if lang == "shell":
        return cmds(lint=[f"shellcheck {fl}"] if has("shellcheck") else [f"for f in {fl}; do bash -n \"$f\" || exit 1; done"])
    if lang == "go":
        return cmds(format=[f"gofmt -w {fl}"], format_check=[f'test -z "$(gofmt -l {fl})"'], lint=[f"go vet {fl}"])
    if lang == "c-cpp":
        return cmds(format=[f"clang-format -i {fl}"] if has("clang-format") else [],
                    lint=[f"gcc -fsyntax-only -Wall -Wextra {' '.join(f for f in files if f.endswith('.c'))}"] if any(f.endswith(".c") for f in files) else [])
    if lang == "ruby":
        return cmds(lint=[f"ruby -wc {fl}"])
    return None


def run(kind: str, root: Path, lang: str | None) -> int:
    info = detect(root)
    kinds = ["format-check", "lint", "build", "test"] if kind == "check" else [kind]
    results = []
    for proj in info["projects"]:
        if lang and proj["lang"] != lang:
            continue
        cwd = Path(info["root"]) / proj["root"]
        for k in kinds:
            for c in proj["commands"].get(k, []):
                try:
                    r = subprocess.run(c, shell=True, cwd=cwd, capture_output=True, text=True, timeout=900, check=False)
                    code, out = r.returncode, (r.stdout + r.stderr)
                except subprocess.TimeoutExpired:
                    code, out = 124, "timed out after 900s"
                results.append({"project": proj["root"], "lang": proj["lang"], "kind": k, "cmd": c,
                                "ok": code == 0, "exit": code, "output_tail": out[-4000:] if code else ""})
    if not results:
        print(json.dumps({"ok": True, "note": f"no '{kind}' commands detected", "results": []}, indent=2))
        return 0
    ok = all(r["ok"] for r in results)
    print(json.dumps({"ok": ok, "passed": sum(r["ok"] for r in results), "failed": sum(not r["ok"] for r in results),
                      "results": results, "missing_tools": info["missing_tools"]}, indent=2))
    return 0 if ok else 1


def slices(root: Path, max_lines: int) -> list[dict]:
    """Group source files into slices of roughly max_lines, keeping directories together."""
    files = source_files(root)
    by_dir: dict[str, list[dict]] = {}
    for f in files:
        by_dir.setdefault(str(Path(f["path"]).parent), []).append(f)
    out, cur, cur_lines = [], [], 0

    def flush():
        nonlocal cur, cur_lines
        if cur:
            dirs = sorted({str(Path(f["path"]).parent) for f in cur})
            out.append({"name": f"slice-{len(out) + 1}:{dirs[0]}" + ("+" if len(dirs) > 1 else ""),
                        "files": [f["path"] for f in cur], "lines": cur_lines})
        cur, cur_lines = [], 0

    for d in sorted(by_dir):
        for f in by_dir[d]:
            if cur and cur_lines + f["lines"] > max_lines:
                flush()
            cur.append(f)
            cur_lines += f["lines"]
        if cur_lines >= max_lines // 2:
            flush()
    flush()
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("detect"); d.add_argument("path", nargs="?", default=".")
    r = sub.add_parser("run"); r.add_argument("kind", choices=KINDS + ["check"]); r.add_argument("path", nargs="?", default="."); r.add_argument("--lang")
    f = sub.add_parser("files"); f.add_argument("path", nargs="?", default=".")
    s = sub.add_parser("slices"); s.add_argument("path", nargs="?", default="."); s.add_argument("--max-lines", type=int, default=1500)
    a = ap.parse_args()
    root = Path(a.path)
    if not root.is_dir():
        print(f"not a directory: {root}", file=sys.stderr)
        return 2
    if a.cmd == "detect":
        print(json.dumps(detect(root), indent=2))
    elif a.cmd == "run":
        return run(a.kind, root, a.lang)
    elif a.cmd == "files":
        print(json.dumps(source_files(root), indent=2))
    elif a.cmd == "slices":
        print(json.dumps(slices(root, a.max_lines), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
