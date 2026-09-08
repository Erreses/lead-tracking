# Where this came from

Vendored, not installed. Source:

    https://www.aitmpl.com/component/skill/creative-design/frontend-design
    https://github.com/davila7/claude-code-templates
    cli-tool/components/skills/creative-design/frontend-design/SKILL.md

`SKILL.md` and `LICENSE.txt` are copied verbatim. The repository is MIT, but
this skill ships its own LICENSE.txt — Apache 2.0 — which is the one that governs
it and is why it is kept alongside.

The published install route is `npx claude-code-templates@latest --skill
creative-design/frontend-design`, which runs a third-party package with full
permissions on the machine. Downloading two text files gets the same result
without that, and pins what we actually read rather than whatever the package
resolves to next time.

## It contradicts this project in two places

Both are resolved in the prompt (`src/lib/generate/agent.ts`), which states that
hard constraints override the brief:

- It says to avoid system fonts. These pages must render with **no network at
  all**, so a web font is impossible. The resolution is the characterful faces
  that ship with the OS — Iowan Old Style, Didot, Baskerville, Optima, Futura,
  Copperplate — not Arial and not Inter.
- It suggests the Motion library for animation. These pages ship no JavaScript;
  animation is CSS only.

It also has nothing to say about a hero fitting on one screen, which was a real
bug here, so that rule now lives in the prompt rather than in a brief.
