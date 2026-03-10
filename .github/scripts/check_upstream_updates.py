#!/usr/bin/env python3
"""Check if cat2151 upstream libraries have been updated.

Reads package-lock.json, extracts the locked commit SHA for each library,
fetches the latest SHA from GitHub API, and writes results to GITHUB_OUTPUT.
"""

import json
import os
import sys
import urllib.request
import urllib.error

LIBRARIES = [
    ("tonejs-json-sequencer", "cat2151/tonejs-json-sequencer", "sequencer"),
    ("tonejs-mml-to-json", "cat2151/tonejs-mml-to-json", "mml"),
]


def get_lock_sha(lock_data: dict, pkg: str) -> str:
    entry = lock_data.get("packages", {}).get(f"node_modules/{pkg}")
    if not entry:
        print(f"ERROR: {pkg} not found in package-lock.json", file=sys.stderr)
        sys.exit(1)
    resolved = entry.get("resolved", "")
    parts = resolved.split("#")
    if len(parts) < 2 or not parts[1]:
        print(
            f"ERROR: no SHA found in resolved field for {pkg}: {resolved}",
            file=sys.stderr,
        )
        sys.exit(1)
    return parts[1]


def get_latest_sha(repo: str, token: str) -> str:
    url = f"https://api.github.com/repos/{repo}/commits/main"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"ERROR: GitHub API HTTP error for {repo}: {e.code} {e.reason}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"ERROR: GitHub API network error for {repo}: {e.reason}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"ERROR: Failed to parse GitHub API response for {repo}: {e}", file=sys.stderr)
        sys.exit(1)
    return data["sha"]


def main() -> None:
    token = os.environ.get("GH_TOKEN")
    if not token:
        print("ERROR: GH_TOKEN not set", file=sys.stderr)
        sys.exit(1)

    try:
        with open("package-lock.json") as f:
            lock_data = json.load(f)
    except FileNotFoundError:
        print("ERROR: package-lock.json not found", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"ERROR: Failed to parse package-lock.json: {e}", file=sys.stderr)
        sys.exit(1)

    github_output = os.environ.get("GITHUB_OUTPUT", "")

    updated = False
    output_lines: list[str] = []

    for pkg, repo, prefix in LIBRARIES:
        lock_sha = get_lock_sha(lock_data, pkg)
        latest_sha = get_latest_sha(repo, token)

        print(f"{pkg}: lock={lock_sha} latest={latest_sha}")

        output_lines.append(f"{prefix}_old={lock_sha}")
        output_lines.append(f"{prefix}_new={latest_sha}")

        if lock_sha != latest_sha:
            updated = True

    output_lines.append(f"updated={'true' if updated else 'false'}")

    if not updated:
        print("No updates found.")

    if github_output:
        try:
            with open(github_output, "a") as f:
                for line in output_lines:
                    f.write(line + "\n")
        except OSError as e:
            print(f"ERROR: Failed to write to GITHUB_OUTPUT: {e}", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
