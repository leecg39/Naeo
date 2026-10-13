#!/usr/bin/env bash
# Claude Code가 한도에 걸렸을 때 Codex로 이어서 작업한다: ./scripts/handoff-to-codex.sh
set -euo pipefail
cd "$(dirname "$0")/.."
exec codex exec -C "$PWD" -s workspace-write \
 "docs/handoff/CODEX_HANDOFF.md와 TASKS.md를 읽고, '지금 하던 작업'의 남은 일부터 이어서 끝까지 진행해줘. 문서의 규칙을 지키고, 작업 단위마다 테스트·린트·빌드로 확인한 뒤 커밋·푸시하고 인계 문서를 갱신해줘."
