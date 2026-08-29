# Implementation gate

A narrow runtime guard for the global `implement` skill. It also exposes `/implement` as a direct
alias for Pi's native `/skill:implement` command.

It enforces four phase transitions:

1. `/implement` activates planning.
2. `Acceptance Map Ready` permits direct `edit` and `write` tools.
3. `Freeze Gate Passed` permits configured full-suite commands.
4. A later direct edit invalidates the freeze; `Implementation Complete` resets the gate.

The phase is stored in Pi custom session entries and survives session reloads. Run
`/implementation-gate-reset` to clear an abandoned workflow.

## Project configuration

`config.json` maps an absolute project path to exact full-suite commands. Commands are matched only
as direct tool input or exact quoted strings inside command-wrapper tools.

The extension intentionally does not infer arbitrary shell or MCP mutations. The skill remains the
primary workflow; this extension only guards direct file tools and explicitly configured suites.

Restart Pi after changing the extension or its configuration.
