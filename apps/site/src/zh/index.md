---
layout: home

hero:
  name: Oh My DSH
  text:  探索未至之境
  tagline: 一个专注、键盘优先的 DeepSeek 终端编程智能体，构建于 DeepSeek Harness 插件运行时之上。
  actions:
    - theme: brand
      text: 快速上手
      link: /zh/docs/tutorials/first-task
    - theme: alt
      text: GitHub 仓库
      link: https://github.com/agi-fans/oh-my-dsh

features:
  - icon: 🗂
    title: 持久化对话
    details: 搜索、置顶、重命名和恢复会话；回退、重试、压缩，并将完整对话导出为 Markdown 或独立 HTML。
  - icon: 🎛
    title: 四项真实会话控制
    details: 无需离开键盘，即可选择 Agent preset、Workflow、工具展示和 Access 级别。
  - icon: ⌨️
    title: 丰富的终端输入
    details: 用 @ 提及文件与会话、粘贴剪贴板图片、复用持久输入历史，并排队后续消息。
  - icon: 🔍
    title: 清晰的工具活动
    details: 跟踪流式调用和 Agent Hub 中子智能体的实时进展，Input 与 Output 分区可展开。
  - icon: 📊
    title: 实时运行上下文
    details: 模型、推理强度、Git 状态、上下文压力、Token、TTFT、吞吐率与耗时尽在 composer 下方。
  - icon: ⚡
    title: 为响应速度而设计
    details: 线性时间会话回放、缓存 Transcript 布局、行级 diff 输出，CJK 与 emoji 对齐正确。
---

## 安装

```sh
npm install --global @agi-fans/oh-my-dsh
```

需要 Node.js 22.19 或更高的 22.x 版本，或者 Node.js 24 及更高版本，以及一个 DeepSeek API Key。在 omdsh 中运行一次 `/login`，即可开始对话。
