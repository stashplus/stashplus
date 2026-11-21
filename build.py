#!/usr/bin/env python3
"""Builds docs/<PluginId>.zip for each plugin folder and one docs/index.yml listing them all.

Usage (run from the repo root, list every plugin folder to publish):
    python3 build.py stashPlus ../stashoratings/stashOratings

Each folder must contain <FolderName>.yml with name, description and version.
Bump `version` in that yml before every release so Stash offers an update.
"""
import hashlib
import json
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path


def build(folder, out, date):
    pid = folder.name
    manifest = folder / f"{pid}.yml"
    if not manifest.is_file():
        sys.exit(f"Missing {manifest}")
    text = manifest.read_text(encoding="utf-8")

    def field(key):
        m = re.search(rf"^{key}:\s*(.+?)\s*$", text, re.M)
        if not m:
            sys.exit(f"'{key}' not found in {manifest}")
        return m.group(1).strip().strip("\"'")

    name, desc, version = field("name"), field("description"), field("version")

    zpath = out / f"{pid}.zip"
    # Plugin files go at the zip root; fixed timestamps keep the build reproducible.
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(folder.iterdir()):
            if f.is_file():
                info = zipfile.ZipInfo(f.name, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o644 << 16
                z.writestr(info, f.read_bytes())

    sha = hashlib.sha256(zpath.read_bytes()).hexdigest()
    print(f"Built {zpath} (version {version}, sha256 {sha})")
    return (
        f"- id: {pid}\n"
        f"  name: {json.dumps(name, ensure_ascii=False)}\n"
        f"  metadata:\n"
        f"    description: {json.dumps(desc, ensure_ascii=False)}\n"
        f"  version: {json.dumps(version)}\n"
        f"  date: {date}\n"
        f"  path: {pid}.zip\n"
        f"  sha256: {sha}\n"
    )


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    out = Path("docs")
    out.mkdir(exist_ok=True)
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    entries = [build(Path(arg), out, date) for arg in sys.argv[1:]]
    (out / "index.yml").write_text("".join(entries), encoding="utf-8")
    print(f"Wrote {out / 'index.yml'} with {len(entries)} plugin(s)")


if __name__ == "__main__":
    main()
