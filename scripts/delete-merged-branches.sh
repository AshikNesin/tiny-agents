#!/usr/bin/env bash
#
# Delete the remote branches that are fully merged into the default branch.
#
# Used by .github/workflows/cleanup-merged-branches.yml. Branch names are read
# one per line, never word-split, so a name with a space or a glob character
# is one branch and not several. Protected names, the default branch and
# branches with no commits of their own are kept.
#
# Usage: delete-merged-branches.sh [protected...]
# Env:   DEFAULT_BRANCH (default: the remote's HEAD), GIT_DIR
# Out:   lines "deleted <branch>", "failed <branch>", "kept <branch> <reason>"
set -euo pipefail

readonly PROTECTED=("main" "master" "develop" "development" "staging" "production" "next" "$@")

default_branch() {
  local branch
  branch="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || true)"
  branch="${branch#origin/}"
  if [ -z "$branch" ]; then
    # `git remote show` names the remote's HEAD branch, or "(unknown)" when it
    # cannot tell (an empty repository).
    branch="$(git remote show origin | sed -n 's/^ *HEAD branch: //p')"
  fi
  case "$branch" in "" | "(unknown)" | *" "*) return 1 ;; esac
  echo "$branch"
}

if ! DEFAULT_BRANCH="${DEFAULT_BRANCH:-$(default_branch)}" || [ -z "$DEFAULT_BRANCH" ]; then
  echo "Could not determine the default branch" >&2
  exit 1
fi
readonly DEFAULT_BRANCH

# Declared apart from the assignment: in `readonly X="$(...)"` bash does not
# act on the command's failure, and a missing ref must stop this script here.
DEFAULT_SHA="$(git rev-parse --verify "origin/$DEFAULT_BRANCH")"
readonly DEFAULT_SHA

is_protected() {
  local branch="$1" protected
  for protected in "${PROTECTED[@]}"; do
    [ "$branch" = "$protected" ] && return 0
  done
  return 1
}

# Full ref names, with the prefix stripped below. The short form of
# `refs/remotes/origin/HEAD` is the bare `origin`, which would be taken for a
# branch; a full name under `refs/remotes/origin/` is a branch, or that HEAD.
# A branch name cannot contain a newline, so a line is exactly one name.
while IFS= read -r ref; do
  case "$ref" in
    refs/remotes/origin/HEAD) continue ;;
    refs/remotes/origin/*) branch="${ref#refs/remotes/origin/}" ;;
    *) continue ;;
  esac
  [ -z "$branch" ] && continue

  if [ "$branch" = "$DEFAULT_BRANCH" ]; then
    echo "kept $branch default"
    continue
  fi
  if is_protected "$branch"; then
    echo "kept $branch protected"
    continue
  fi
  # Keep a branch whose tip is the default branch's tip. The workflow's
  # intent is to spare a branch that was just created and has no commits of
  # its own; note that git cannot tell that apart from one merged by
  # fast-forward while main has not moved on, which this spares as well.
  if [ "$(git rev-parse "origin/$branch")" = "$DEFAULT_SHA" ]; then
    echo "kept $branch at-default-tip"
    continue
  fi

  # `--` ends git's options: a branch may be named `-lead`, which git would
  # otherwise take for a flag.
  if git push origin --delete -- "$branch"; then
    echo "deleted $branch"
  else
    echo "failed $branch"
  fi
done < <(git branch -r --merged "origin/$DEFAULT_BRANCH" --format '%(refname)')
