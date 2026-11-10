#!/usr/bin/env python3
import argparse
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "modules" / "Gauss-AdClean.sgmodule"
VERSION = "0.4.3"
COMPONENTS = (
    ROOT / "components" / "Gauss-AdClean-Core.sgmodule",
    ROOT / "components" / "Gauss-AdClean-Advanced.sgmodule",
    ROOT / "components" / "Gauss-JD-Conservative.sgmodule",
    ROOT / "components" / "Gauss-System-Extras.sgmodule",
)
SECTION_ORDER = ("Rule", "URL Rewrite", "Body Rewrite", "Script")


def parse_component(path: Path) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {}
    section: str | None = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"\[([^]]+)]", raw.strip())
        if match:
            section = match.group(1)
            sections.setdefault(section, [])
            continue
        if section:
            sections[section].append(raw.rstrip())
    return sections


def active_lines(lines: list[str]) -> bool:
    return any(line.strip() and not line.lstrip().startswith("#") for line in lines)


def trim_blank(lines: list[str]) -> list[str]:
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return lines


def render() -> str:
    parsed = [(path, parse_component(path)) for path in COMPONENTS]
    output = [
        "#!name=Gauss AdClean",
        "#!desc=去广告优先：强化闲鱼、淘宝、京东、美团开屏与营销拦截，允许部分功能失效；不改分流与证书",
        "#!author=Gauss2014 local audit",
        f"#!version={VERSION}",
        "#!homepage=https://github.com/Gauss2014/Gauss-AdClean",
        "#!url=https://raw.githubusercontent.com/Gauss2014/Gauss-AdClean/main/modules/Gauss-AdClean.sgmodule",
        "",
    ]

    for section in SECTION_ORDER:
        if not any(active_lines(data.get(section, [])) for _, data in parsed):
            continue
        output.append(f"[{section}]")
        seen: set[str] = set()
        for path, data in parsed:
            source = trim_blank(list(data.get(section, [])))
            if not active_lines(source):
                continue
            rendered: list[str] = []
            for line in source:
                stripped = line.strip()
                if stripped and not stripped.startswith("#"):
                    if stripped in seen:
                        continue
                    seen.add(stripped)
                rendered.append(line)
            rendered = trim_blank(rendered)
            if not active_lines(rendered):
                continue
            if output[-1] != f"[{section}]":
                output.append("")
            output.append(f"# Component: {path.stem}")
            output.extend(rendered)
        output.append("")

    hosts: list[str] = []
    seen_hosts: set[str] = set()
    for _, data in parsed:
        for line in data.get("MITM", []):
            if not re.match(r"^\s*hostname\s*=", line, flags=re.I):
                continue
            value = line.split("=", 1)[1].strip()
            value = re.sub(r"^%APPEND%\s*", "", value, flags=re.I)
            for host in value.split(","):
                host = host.strip()
                if host and host not in seen_hosts:
                    seen_hosts.add(host)
                    hosts.append(host)
    if hosts:
        output.extend(
            (
                "[MITM]",
                "enable = true",
                "h2 = true",
                f"hostname = %APPEND% {','.join(hosts)}",
                "",
            )
        )

    return "\n".join(output)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    generated = render()
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != generated:
            print(f"FAIL generated module is stale: {OUTPUT.relative_to(ROOT)}")
            return 1
        print(f"PASS generated module is current: {OUTPUT.relative_to(ROOT)}")
        return 0
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(generated, encoding="utf-8")
    print(f"WROTE {OUTPUT.relative_to(ROOT)} bytes={OUTPUT.stat().st_size}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
