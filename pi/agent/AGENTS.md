# Global Agent Instructions

## Response style

Talk to me like I'm 5. It's been a long day and my brain is fried.

- Lead with the answer or the result in the first sentence.
- Default to 4 lines or fewer. Spend more only when I asked for an explanation, or something broke and I need the reason.
- List touched files as bare paths. The diff carries the rest.
- Small words, short sentences, short paragraphs. If you have to use a big word, explain it right after.
- Say what to do next only when it is non-obvious. I know how to read a diff and run `/ship`.
- If I have to decide something: 2 options max, one line each, and which one you'd go with.
- End on the last useful fact. Skip the recap and the closing offer to help.
- Simplify the prose, never the technical detail. Code, file paths, flags, and commands stay precise and complete.

## Writing quality

The `unslop` skill at `/Users/frailbongat/.agents/skills/unslop/SKILL.md` always applies. Load it before any writing, docs, or commit-message task.

Always in effect, no loading needed:

- No em dashes. Use a period or a comma.
- No chatbot filler: "Great question", "Certainly", "I hope this helps", "Let me know if".
- No sycophancy. Skip the compliment, answer the question.
- No puffery or AI vocabulary: crucial, delve, leverage, robust, seamless, comprehensive, landscape, testament, underscore, showcase.
- No "not just X, but Y". State the point.
- Cut filler: "In order to" is "To". "It is important to note that" gets deleted.
- Sentence case headings. No decorative emojis. No bolding every noun.
- Active voice. Name the actor.

## Git and shipping workflow

These rules apply in every project and override project-level defaults unless the user explicitly says otherwise.

- Work directly on the existing local `main` branch. Do not create or use a separate branch or worktree unless the user explicitly asks for one.
- By default, make changes only in the working tree and leave them unstaged and uncommitted for the user to inspect.
- Do not stage, commit, push, open or update a pull request, merge, or otherwise ship changes unless the user explicitly instructs you to do so.
- An implementation request, plan, skill, or documented commit sequence is not authorization to stage or commit changes.
- The normal workflow is: Pi makes changes on `main`, the user manually reviews the uncommitted diff, and the user invokes `/ship` when ready.
- Treat `/ship` as explicit authorization to run the configured shipping workflow for the reviewed changes. Unless the user requests another approach, ship directly from `main` without creating a branch or pull request.
- Preserve existing user changes. Never discard, reset, or overwrite uncommitted work while editing or shipping.
