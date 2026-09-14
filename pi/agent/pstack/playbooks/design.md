### Design

**You own the direction. The three skills own the craft.** Never run two of them on the same decision.

Variants are the spine of this playbook. Each skill produces its own three, they get built side by side and looked at, one wins, the losers get deleted the same turn.

| Skill | Owns | Variant round | Path |
|---|---|---|---|
| `design-taste-frontend` | Design read, the three dials, design-system choice, layout hard rules, AI tells | Static | `~/.agents/skills/design-taste-frontend/SKILL.md` |
| `impeccable` | Project truth (PRODUCT.md, DESIGN.md, surface brief), surface mode, refine-vs-replace, craft floor, its command references | Static | `~/.agents/skills/impeccable/SKILL.md` |
| `emil-design-eng` | Motion, easing, interruptibility, component feel | Motion | `~/.agents/skills/emil-design-eng/SKILL.md` |

Precedence when they disagree: the user's brief, then the project's committed DESIGN.md, then taste §4.7 and §9, which are bans and not preferences, then emil. Outside its own column a skill is advisory. Do not average two opinions into a third design.

1. Read the surface before naming it. Inspect the target and at least one source of incumbent visual truth (tokens, theme, CSS, a shipped component). Run impeccable's Setup step 1 from the project root, once, with `--target <path>`.
2. Write the design read. Three lines, fixed for every variant in every round, and the contract each one is checked against. Surface mode from impeccable's Modes, chosen from the requested surface and not from the product. The one-line Design Read from taste §0.B. Refine or replace, per impeccable's "refinement preserves, redesign replaces". Variants differ in direction and in dials, never in these three lines.
3. Name the matrix before building it. One line per variant: its id, its owning skill, its direction, its dial values from taste §1.A, and the reachable path it will render at. Two variants that would collapse into the same direction are one variant, so replace the duplicate. A brief that pins an aesthetic, era, palette, or font constrains every variant rather than cancelling the round.
4. Build the static round in parallel. One delegate per static skill, three variants each, six in total. Each delegate loads only its own skill plus impeccable's `reference/craft-floor.md`, gets step 2's three lines pinned verbatim at the top of its brief, gets taste §9 attached as the ban list, and writes only inside its own variant paths. No delegate reads another's output. Review every diff yourself.
5. Show them, do not describe them. Drive Firefox through the `playwright-cli` skill, capture each variant at desktop and mobile, and write an index at `design-variants/VARIANTS.md` holding the matrix from step 3 plus each screenshot and reachable path. `open` the index or the gallery route for the user.
6. Stop and let the user pick. This is a taste call and it is theirs, so present the six and wait. They pick a winner, or they pick one to iterate. Do not pick for them and do not rank them into a recommendation they have to argue with.
7. Iterate only the pick, with only its owning skill. Bounded rounds, not a loop: change, re-capture, show, ask. Each round starts from the current pick rather than from a fresh variant. The user ends the loop.
8. Run the motion round on the winner. Three emil variants of the settled composition, then steps 5 and 6 again. Skip it with `motion round skipped: <reason>` for a static surface. MOTION_INTENSITY from the winning variant is the budget, and taste §5.D still forbids what it forbids. When the target is a single component or interaction, emil has a real competing opinion about the whole thing, so fold its three into the step 4 round and delete this step for that run.
9. Promote and drop in one turn. Move the winner into its real paths, delete every loser and the `design-variants/` tree, and record in the reply which directions lost and why. A dropped variant never survives as a commented-out block, a `.old` file, or a dead route.
10. Gate the promoted diff against taste §4.7 and §9, then run `/skill:deslop` over the promoted diff and `/skill:unslop` over every string in it. Both are real here: deslop is hidden from the skill list and lives at `~/.pi/agent/npm/node_modules/@zenspc/pi-pstack/skills/deslop/SKILL.md`, and it scopes to the working tree rather than to `git diff main`. Placeholder names, `lorem`, and invented metrics fail the gate rather than counting as nits.
11. Stop at the diff. `~/.pi/agent/AGENTS.md` holds: do not stage, commit, or push. **Opening a PR** runs only on an explicit instruction.

Pixel-exact equivalence between two implementations is **Visual parity**, not this. A sketch that only has to settle one question, with nothing to pick between, is **Prototype**.

**Reply:** the three lines from step 2, the variant matrix with each verdict, why each loser lost, what a visitor sees differently, and the surface you actually drove. Table for the matrix.
