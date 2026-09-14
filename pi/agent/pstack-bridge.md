# pstack bridge

pstack was a Cursor plugin. This machine runs pi, paseo, and Anthropic models through cliproxyapi.
Read this file before running any pstack playbook. Where it contradicts a playbook, this file wins.

## Tools the playbooks name that pi does not have

**`ask_user_question`.** No such tool exists here. Where a playbook forbids it, that means do not stop
and ask. Where a playbook sanctions a question, write the question in the reply and stop.

**A todolist.** pi has no todo tool. "Open a todolist" means write a plan file at
`${PI_SESSION_FILE%.jsonl}.plan.md`. One `- [ ]` box per playbook step, copied verbatim, before any
task-specific box. Tick a box only when its evidence exists. A skipped step keeps its box with
`skip: <reason>`. A file beats a TUI list because delegates can read it by absolute path.

**Cursor's Task tool.** Named by `interrogate` and `orchestrate`. Use `subagent({ agent, task })` from
pi-subagents. Model slugs come from the role table the pstack extension injects.

## Delegation

`poteto-agent` holds read, grep, find, ls, bash, edit, write. It has no `subagent` tool, no web search,
and no MCP access. Fan-out, web research, and every paseo call stay with the parent. Never write a
brief that tells a delegate to spawn its own children.

`comment-sicko` is read-only. It reports, the parent deletes.

## Cloud agents are paseo agents

Playbooks that say "Cursor cloud agent" mean a long-lived agent with its own checkout. Shipping step 1,
autopilot-full step 2, autopilot-stack step 1, and orchestrate all say it. Use the `paseo` MCP server.

- `paseo_create_workspace` for the isolated checkout, one per PR owner.
- `paseo_create_agent`, then `paseo_send_agent_prompt` to deliver the brief.
- `paseo_get_agent_status` and `paseo_get_agent_activity` to probe read-only. Never resume an agent
  just to check on it, because a resume restarts an idle agent.
- `paseo_list_pending_permissions` and `paseo_respond_to_permission` when an owner blocks.

Local `subagent()` still covers read-only fan-out inside one session, which is `how`, `why`, `arena`,
`swarm`, `interrogate`, and `reflect`. Reach for paseo when the work outlives this session or needs its
own working tree.

Orchestrate's Cursor-restart rule maps to a pi restart. Local subagents die, paseo agents do not.
Reattach by PR and branch, never by agent id.

## Automations are paseo schedules

The benny pack never ported. `automate-me` targets `paseo_create_schedule` for recurring agent runs and
`paseo_create_heartbeat` for recurring nudges. Inspect with `paseo_list_schedules`,
`paseo_inspect_schedule`, and `paseo_schedule_logs`.

## Forge

`gh` is the forge, authenticated as `frailbongat`. The `origin` CLI is not installed, so skip every
Origin branch in shipping, babysit, autopilot, and opening-a-pr. Graphite is not used either.

## Bundled scripts

The playbooks name these by relative path, which never resolves from a project directory. Use the PATH
shims instead. All four run from `~/.local/bin`.

- `watch-pr` replaces `scripts/watch-pr/watch-pr` in babysit and shipping.
- `orch` replaces `scripts/orch/orch.ts` in orchestrate.
- `check-plan <plan.md>` replaces `node skills/poteto-mode/scripts/check-plan.mjs` in multi-phase-plan.
- `worktree-audit` replaces `scripts/worktree-audit.sh` in worktree-cleanup.

`watch-pr` and `orch` run under bun, which lives at `~/.bun/bin/bun`.

## Review automation is local, not Bugbot

Cursor Bugbot is not installed and will not be. Never wait for a bot review, and never treat a missing
bot as a blocked step.

Wherever a playbook names Bugbot triage, run the review yourself instead. Babysit step 8,
autopilot-full step 2, and autopilot-stack step 1 all name it.

1. Scope the diff against the PR base, not the working tree.
2. Run the `interrogate` skill over that diff. Its reviewers come from the `interrogate reviewers`
   role list, so the adversarial signal is model diversity. For a small or docs-only PR, one
   fresh-context `reviewer` subagent is enough.
3. Triage every finding through `poteto-mode/references/bugbot-triage.md` unchanged. The rubric is
   about noisy machine review in general, so `fix`, `dismiss`, and `ask` still apply.
4. Record each dismissal with its concrete disproof in the run report. There is no thread to reply to,
   so the report is the only record.

The pass-count escalation in babysit step 8 has no meaning here, because you control how many reviews
run. Stop when a pass produces no new `fix` findings.

If some other bot does comment on a PR, such as Copilot or a repo's own workflow, triage it with the
same rubric and the same skeptical posture.

## Verifying on a real surface

Drive browsers through the `playwright-cli` skill with `--browser=firefox`. Never Chrome or Chromium
without asking. To show the user a page, run `open "<url>"` instead of automating a browser.

## Git authority beats every playbook

`~/.pi/agent/AGENTS.md` wins. A playbook runs until the diff is ready to review, then stops. Do not
stage, commit, push, open a PR, or merge without an explicit instruction, and `/ship` is that
instruction. So `playbooks/opening-a-pr.md` is not an automatic ending, and shipping, autopilot-full,
and autopilot-stack are programs the user names, never defaults.
