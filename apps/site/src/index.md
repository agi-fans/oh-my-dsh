---
layout: home

hero:
  name: Oh My DSH
  text: Into the Unknown
  tagline: A focused, keyboard-first DeepSeek coding agent for your terminal, built on the DeepSeek Harness plugin runtime.
  actions:
    - theme: brand
      text: Get Started
      link: /docs/tutorials/first-task
    - theme: alt
      text: View on GitHub
      link: https://github.com/agi-fans/oh-my-dsh

features:
  - icon: 🗂
    title: Durable conversations
    details: Search, pin, rename, and resume sessions. Rewind, retry, compact, and export complete transcripts as Markdown or standalone HTML.
  - icon: 🎛
    title: Four real session controls
    details: Choose an Agent preset, Workflow, tool presentation, and Access level without leaving the keyboard.
  - icon: ⌨️
    title: Rich terminal input
    details: Mention files and sessions with @, paste clipboard images, reuse persistent prompt history, and queue follow-ups.
  - icon: 🔍
    title: Readable tool activity
    details: Follow streaming calls and live subagent progress in the Agent Hub, with expandable Input and Output sections.
  - icon: 📊
    title: Live operational context
    details: Model, reasoning effort, Git state, context pressure, tokens, TTFT, throughput, and timings sit right below the composer.
  - icon: ⚡
    title: Responsive by design
    details: Linear-time session replay, cached transcript layout, and row-level diffs with correct CJK and emoji alignment.
---

## Install

```sh
npm install --global @agi-fans/oh-my-dsh
```

Requires Node.js 22.19 or later in the 22.x line, or Node.js 24 or newer, plus a DeepSeek API key. Run `/login` once inside omdsh, then start a conversation.
