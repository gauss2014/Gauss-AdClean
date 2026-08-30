#!/usr/bin/env python3
import json
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULES = ROOT / "modules"
FORBIDDEN = (
    "script-path=http://",
    "script-path=https://",
    "ca-p12",
    "ca-passphrase",
    "BEGIN PRIVATE KEY",
    "BEGIN CERTIFICATE",
    "Authorization:",
    "Cookie:",
)


def validate_module(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    errors: list[str] = []
    if not text.startswith("#!name="):
        errors.append("missing #!name")
    for marker in FORBIDDEN:
        if marker.lower() in text.lower():
            errors.append(f"forbidden marker: {marker}")

    host_lines = re.findall(r"^hostname\s*=.*$", text, flags=re.M | re.I)
    if host_lines and any("%APPEND%" not in line for line in host_lines):
        errors.append("MITM hostname must use %APPEND%")

    active: dict[str, list[str]] = {}
    section = "metadata"
    for raw in text.splitlines():
        line = raw.strip()
        match = re.fullmatch(r"\[([^]]+)\]", line)
        if match:
            section = match.group(1)
            active.setdefault(section, [])
        elif section != "metadata" and line and not line.startswith("#"):
            active.setdefault(section, []).append(line)

    for name, lines in active.items():
        duplicates = {line for line in lines if lines.count(line) > 1}
        if duplicates:
            errors.append(f"duplicate active lines in [{name}]: {len(duplicates)}")

    for line in active.get("Body Rewrite", []):
        if not line.startswith(("http-response-jq ", "http-request-jq ")):
            continue
        start, end = line.find("'"), line.rfind("'")
        if start < 0 or end <= start:
            errors.append("jq rewrite is missing quoted expression")
            continue
        result = subprocess.run(
            ["jq", "-n", f"try ({line[start + 1:end]}) catch null"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        if result.returncode:
            errors.append("invalid jq expression")
    return errors


manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
expected = {entry["path"] for entry in manifest["modules"]}
actual = {str(path.relative_to(ROOT)) for path in MODULES.glob("*.sgmodule")}
if expected != actual:
    print(f"FAIL manifest mismatch: expected={sorted(expected)} actual={sorted(actual)}")
    sys.exit(1)

failed = False
for module in sorted(MODULES.glob("*.sgmodule")):
    errors = validate_module(module)
    if errors:
        failed = True
        print(f"FAIL {module.name}: {'; '.join(errors)}")
    else:
        print(f"PASS {module.name}")

sys.exit(1 if failed else 0)
