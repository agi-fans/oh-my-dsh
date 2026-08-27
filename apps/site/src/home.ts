export const homeCopy = {
  en: {
    pageTitle: 'Keyboard-first DeepSeek coding agent',
    heroName: 'Oh My DSH',
    heroText: 'Into the Unknown',
    tagline: 'omdsh is a focused, keyboard-first DeepSeek coding agent for your terminal, built on the DeepSeek Harness plugin runtime.',
    actionPrimary: 'Get Started',
    actionAlt: 'View on GitHub',
    featuresHeading: 'What a turn looks like',
    features: [
      {
        handle: '/sessions',
        title: 'Durable conversations',
        details: 'Search, pin, rename, and resume sessions. Rewind, retry, compact, and export complete transcripts as Markdown or standalone HTML.',
      },
      {
        handle: '/agent /workflow /permission',
        title: 'Four real session controls',
        details: 'Choose an Agent preset, Workflow, tool presentation, and Access level without leaving the keyboard.',
      },
      {
        handle: '@mention · Ctrl+V',
        title: 'Rich terminal input',
        details: 'Mention files and sessions with @, paste clipboard images, reuse persistent prompt history, and queue follow-ups.',
      },
      {
        handle: 'Alt+A',
        title: 'Readable tool activity',
        details: 'Follow streaming calls and live subagent progress in the Agent Hub, with expandable Input and Output sections.',
      },
      {
        handle: 'two-line footer',
        title: 'Live operational context',
        details: 'Model, reasoning effort, Git state, context pressure, tokens, TTFT, throughput, and timings sit right below the composer.',
      },
      {
        handle: '0.35 ms/frame',
        title: 'Responsive by design',
        details: 'Linear-time session replay, cached transcript layout, and row-level diffs with correct CJK and emoji alignment.',
      },
    ],
    installHeading: 'Install',
    installNote: 'Requires Node.js 22.19 or later in the 22.x line, or Node.js 24 or newer, plus a DeepSeek API key. Run /login once inside omdsh, then start a conversation.',
    keyboardHint: 'This site is keyboard-first too: press Ctrl+K to search, / works as well.',
  },
  zh: {
    pageTitle: '键盘优先的 DeepSeek 终端编程智能体',
    heroName: 'Oh My DSH',
    heroText: '探索未至之境',
    tagline: 'omdsh 是一个专注、键盘优先的 DeepSeek 终端编程智能体，构建于 DeepSeek Harness 插件运行时之上。',
    actionPrimary: '快速上手',
    actionAlt: 'GitHub 仓库',
    featuresHeading: '一个回合里有什么',
    features: [
      {
        handle: '/sessions',
        title: '持久化对话',
        details: '搜索、置顶、重命名和恢复会话；回退、重试、压缩，并将完整对话导出为 Markdown 或独立 HTML。',
      },
      {
        handle: '/agent /workflow /permission',
        title: '四项真实会话控制',
        details: '无需离开键盘，即可选择 Agent preset、Workflow、工具展示和 Access 级别。',
      },
      {
        handle: '@mention · Ctrl+V',
        title: '丰富的终端输入',
        details: '用 @ 提及文件与会话、粘贴剪贴板图片、复用持久输入历史，并排队后续消息。',
      },
      {
        handle: 'Alt+A',
        title: '清晰的工具活动',
        details: '跟踪流式调用和 Agent Hub 中子智能体的实时进展，Input 与 Output 分区可展开。',
      },
      {
        handle: '两行状态栏',
        title: '实时运行上下文',
        details: '模型、推理强度、Git 状态、上下文压力、Token、TTFT、吞吐率与耗时尽在 composer 下方。',
      },
      {
        handle: '0.35 ms/帧',
        title: '为响应速度而设计',
        details: '线性时间会话回放、缓存 Transcript 布局、行级 diff 输出，CJK 与 emoji 对齐正确。',
      },
    ],
    installHeading: '安装',
    installNote: '需要 Node.js 22.19 或更高的 22.x 版本，或者 Node.js 24 及更高版本，以及一个 DeepSeek API Key。在 omdsh 中运行一次 /login，即可开始对话。',
    keyboardHint: '本站同样键盘优先：按 Ctrl+K 搜索，/ 也可以。',
  },
} as const
