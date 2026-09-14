---
name: Design
description: "Visual and interaction design of a frontend surface. A new page or component, a redesign, a look that is bland, loud, or templated, or a UI that needs typography, color, layout, or motion decided rather than debugged. Every variant renders on the real surface behind one toggle, the user flips between them and picks one to iterate, the losers get deleted. Resolves the three skills' overlap."
outranks: "Feature, Visual parity, Prototype, and figure-it-out whenever the deliverable is how a surface looks or feels"
command: /design
---

### Design

**You own the direction. The three skills own the craft.** Never run two of them on the same decision.

Variants are the spine of this playbook. Each skill produces its own three, every one of them renders on the real surface behind a single toggle, the user flips between them, one wins, the losers get deleted the same turn.

| Skill | Owns | Variant round | Path |
|---|---|---|---|
| `design-taste-frontend` | Design read, the three dials, design-system choice, layout hard rules, AI tells | Static | `~/.agents/skills/design-taste-frontend/SKILL.md` |
| `impeccable` | Project truth (PRODUCT.md, DESIGN.md, surface brief), surface mode, refine-vs-replace, craft floor, its command references | Static | `~/.agents/skills/impeccable/SKILL.md` |
| `emil-design-eng` | Motion, easing, interruptibility, component feel | Motion | `~/.agents/skills/emil-design-eng/SKILL.md` |

Precedence when they disagree: the user's brief, then the project's committed DESIGN.md, then taste §4.7 and §9, which are bans and not preferences, then emil. Taste scopes itself to landing pages, portfolios, and redesigns, so on an Operate or Read surface impeccable owns the design read and the dial values and taste keeps only its bans. Outside its own column a skill is advisory. Do not average two opinions into a third design.

1. Read the surface before naming it. Inspect the target and at least one source of incumbent visual truth (tokens, theme, CSS, a shipped component). Run impeccable's Setup step 1 from the project root, once, with `--target <path>`.
2. Write the design read. Three lines, fixed for every variant in every round, and the contract each one is checked against. Surface mode from impeccable's Modes, chosen from the requested surface and not from the product. The one-line Design Read from taste §0.B. Refine or replace, per impeccable's "refinement preserves, redesign replaces". Variants differ in direction and in dials, never in these three lines.
3. Name the matrix before building it. One line per variant: its id, its owning skill, its direction, and its dial values from taste §1.A. The id is the toggle's key and the variant module's filename, so it is short, stable, and lowercase. Two variants that would collapse into the same direction are one variant, so replace the duplicate. A brief that pins an aesthetic, era, palette, or font constrains every variant rather than cancelling the round.
4. Build the toggle harness yourself, before any delegate launches. Every variant renders at the real surface's own path, picked at runtime, so there is no second route and no throwaway gallery. A variant renders against the real data the surface already receives, never a fixture, because a variant that only looks right against invented content has not been tested. `baseline` is a registry entry holding the current surface unchanged, which puts "before" one keystroke from every variant. Resolve the active id from `?variant=<id>` first, then `localStorage` key `design-variant`, then `baseline`, because a URL survives a screenshot and a link to a colleague while a click does not.

   These names are fixed, so that step 10's grep can prove the harness left.

   | Harness piece | Path | Exports | Owner |
   |---|---|---|---|
   | One module per variant, the whole composition, default export, same props as the surface body it replaces | `variants/<id>.<ext>` beside the surface | default | that variant's delegate |
   | Registry mapping id to module, carrying step 3's row as data | `variants/registry.<ext>` | `VARIANTS` | you, before the fan-out |
   | Active-id resolution, param then storage then `baseline` | `variants/resolve.<ext>` | `resolveVariant` | you, before the fan-out |
   | Switcher UI, dev-only, the build check inside this module and in no config file | `variants/switcher.<ext>` | `VariantSwitcher` | you, before the fan-out |

   The real surface gains one import, one render of the resolved module, and one `<VariantSwitcher />`. Nothing else about the harness lives outside `variants/`, which is what makes the delete in step 10 one move. The switcher names each id with its owning skill and direction, and binds `[` and `]` to cycle plus `0` to return to baseline.

   A surface with no module system to import from at runtime, such as a static HTML file, a server-rendered template, or a foreign toolchain, gets the one fallback. `data-variant="<id>"` on the root element, each variant a sibling block of markup and scoped custom properties in that same file, the id read by one inline script. There is no second fallback. When neither shape is reachable, say so in the reply with the reason and stop, because rebuilding the old side-by-side routes is the failure this harness exists to prevent.
5. Build the static round in parallel, in the foreground. Six delegates, one per variant, three carrying `design-taste-frontend` and three carrying `impeccable`. Pass `async: false` on the one top-level launch, so their progress lands in this conversation. Background buys nothing here, because step 6 cannot start until every variant lands. Each delegate loads only its own skill plus impeccable's `reference/craft-floor.md`, and also `reference/new-work.md` when step 2 chose replace. Each gets step 2's three lines pinned verbatim at the top of its brief, taste §9 attached as the ban list, its own id, its own file path, and the export contract from step 4's table. Each writes that one file and nothing else, because six agents editing one registry is one file serialized six ways. A delegate that needs data the surface does not already pass stops and reports it, and you make that edit yourself. No delegate reads another's output. Review every diff yourself.
6. Show them on the real surface, do not describe them. Drive Firefox through the `playwright-cli` skill, capture `?variant=<id>` at desktop and mobile for every id including `baseline`, write the shots to `variants/shots/`, and write an index at `variants/VARIANTS.md` holding step 3's matrix plus each shot and its `?variant=` URL. Every artifact stays inside `variants/`. `open` the real route for the user.
7. Hand them the toggle and stop. This is a taste call and it is theirs, so tell them the route, the keys, and the ids, then wait while they flip. They pick a winner, or they pick one to iterate. Do not pick for them and do not rank them into a recommendation they have to argue with.
8. Iterate only the pick, with only its owning skill. Bounded rounds, not a loop: change, re-capture, show, ask. The pick keeps its id and its module, so each round edits that one file and the toggle keeps working against baseline and the losers. The user ends the loop.
9. Run the motion round on the winner. Three emil variants of the settled composition, and you add their ids to `VARIANTS` before launching for the same reason as step 4, then steps 6 and 7 again. Skip it with `motion round skipped: <reason>` for a static surface. MOTION_INTENSITY from the winning variant is the budget, and taste §5.D still forbids what it forbids. When the target is a single component or interaction, emil has a real competing opinion about the whole thing, so fold its three into the step 5 round and delete this step for that run.
10. Promote and drop in one turn. Inline the winner's module into the real surface at its real path, revert the surface's three harness lines, then delete `variants/` whole. `rg -n 'VARIANTS|resolveVariant|VariantSwitcher|variants/|data-variant'` over the working tree returns nothing, which is the proof the toggle did not ship. Record in the reply which directions lost and why. A dropped variant never survives as a commented-out block, a `.old` file, a dead registry entry, or a dead route.
11. Gate the promoted diff against taste §4.7 and §9, then run `/skill:deslop` over the promoted diff and `/skill:unslop` over every string in it. `deslop` is real even though it never appears in the skill list, and the bridge holds its path and its scope correction. Placeholder names, `lorem`, and invented metrics fail the gate rather than counting as nits.
12. Stop at the diff. `~/.pi/agent/AGENTS.md` holds: do not stage, commit, or push. **Opening a PR** runs only on an explicit instruction.

Pixel-exact equivalence between two implementations is **Visual parity**, not this. A sketch that only has to settle one question, with nothing to pick between, is **Prototype**.

**Reply:** the three lines from step 2, the variant matrix with each verdict, why each loser lost, the route and keys the user flips with, what a visitor sees differently, and the grep output proving the harness is gone. Table for the matrix.
