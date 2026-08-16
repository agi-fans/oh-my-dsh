---
name: sync-oh-my-dsh-docs
description: Keep oh-my-dsh English and Simplified Chinese documentation accurate and aligned. Use when editing README.md, README.zh-CN.md, docs/performance.md, docs/performance.zh-CN.md, adding a bilingual document, translating documentation, or auditing whether installation, commands, architecture, performance claims, links, and code examples have drifted between languages.
---

# Sync oh-my-dsh Documentation

Treat both languages as maintained product documentation. Synchronize meaning and structure without mechanically translating reviewed prose that did not change.

## Identify the pair

The current maintained pairs are:

- `README.md` ↔ `README.zh-CN.md`
- `docs/architecture.md` ↔ `docs/architecture.zh-CN.md`
- `docs/performance.md` ↔ `docs/performance.zh-CN.md`
- `docs/skills-and-mcp.md` ↔ `docs/skills-and-mcp.zh-CN.md`
- `docs/tutorials.md` ↔ `docs/tutorials.zh-CN.md`

Do not assume every file under `docs/` needs a counterpart. Create a new pair only when the user requests bilingual coverage or the document is clearly part of the public bilingual surface.

## Verify the source claim

Read [`AGENTS.md`](../../../AGENTS.md), package manifests, scripts, and owning code for any changed installation command, package name, version behavior, keybinding, feature, configuration path, benchmark, or architecture statement. Documentation agreement is not correctness when both sides repeat a stale claim.

## Update an existing pair

1. Inspect the diff and identify the smallest changed semantic units: heading, paragraph, list item, table row, or code block.
2. Update only the corresponding units on the other side. Preserve reviewed phrasing elsewhere.
3. Keep heading depth, section order, list structure, links, inline code, code blocks, package names, commands, environment variables, and paths aligned.
4. Translate meaning and tone rather than English word order. Keep technical identifiers verbatim.
5. Read the changed counterpart alone for natural language, then compare it clause by clause with the authored side for omissions or inventions.

## Create a new pair

Lock the section structure first, translate one semantic section at a time, preserve executable blocks, and perform a whole-document clause comparison at the end. Use `README.zh-CN.md` terminology as the local precedent for project vocabulary. Do not invent an i18n manifest or hash sidecar unless the repository adopts that infrastructure separately.

## Protect document form

Apply [`write-oh-my-dsh-prose`](../write-oh-my-dsh-prose/SKILL.md): keep prose paragraphs on one physical source line, use blank lines around CommonMark blocks, and avoid duplicated explanations. Keep language-switch links and relative asset links correct when present.

## Validate and report

Run:

```sh
pnpm check:md
git diff --check
```

Also inspect the rendered Markdown or repository preview when tables, images, anchors, or nested lists change. Report which side was authored, which sections were synchronized, deliberate language-specific differences, and the checks run.
