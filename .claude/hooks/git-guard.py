#!/usr/bin/env python3
"""git 품질 게이트 우회를 차단하는 PreToolUse 훅.

차단 대상:
- git commit --no-verify / -n (결합 단축 플래그 -nm 등 포함) — pre-commit/commit-msg 우회
- git commit --author 에 Claude/Anthropic — 기여자 표기 우회
- core.hooksPath 를 .githooks 외의 값으로 조작 — 훅 자체 무력화
"""
import json
import re
import sys


def block(message: str) -> None:
    print(message, file=sys.stderr)
    sys.exit(2)


data = json.load(sys.stdin)
cmd = data.get("tool_input", {}).get("command", "")

if re.search(r"\bgit\b", cmd) and "hooksPath" in cmd and ".githooks" not in cmd:
    block(
        "core.hooksPath를 .githooks 외의 값으로 바꿀 수 없습니다: "
        "커밋 품질 게이트(pre-commit/commit-msg)가 무력화됩니다."
    )

if re.search(r"\bgit\b[^|;&]*\bcommit\b", cmd):
    if re.search(r"--no-verify\b", cmd) or re.search(
        r"(^|\s)-[a-zA-Z]*n[a-zA-Z]*\b", cmd
    ):
        block(
            "git commit에 --no-verify/-n(결합 플래그 포함) 금지: "
            "pre-commit 품질 게이트(lint/typecheck/coverage)와 commit-msg 검사를 우회할 수 없습니다."
        )
    if re.search(r"--author[= ][^|;&]*(claude|anthropic)", cmd, re.IGNORECASE):
        block("git commit --author에 Claude/Anthropic을 넣을 수 없습니다.")
