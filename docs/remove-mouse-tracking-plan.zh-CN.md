# 移除鼠标跟踪

[English](remove-mouse-tracking-plan.md) | [简体中文](remove-mouse-tracking-plan.zh-CN.md)

## 决策

主 TUI 将不再启用终端鼠标跟踪。omdsh 以键盘交互为先，transcript、composer、选择器、设置和子代理的所有必要操作都必须在没有鼠标输入时完整可用。指针选择和滚动继续由终端或终端复用器所有。

此变更直接移除鼠标交互，不增加持久化设置。设置会为产品交互模型并不需要的行为引入配置、运行时模式切换、清理分支和兼容状态。

## 目标

- 停止发送按钮事件跟踪（`1000`）和 SGR 鼠标编码（`1006`）的 DECSET/DECRST 序列。
- 在终端或终端复用器允许时，恢复无需应用绕过修饰键的普通终端文本选择。
- 从 TUI 移除滚轮滚动、点击定位光标以及点击 overlay 或子代理的行为。
- 保持 transcript、composer、设置、提示、overlay 和子代理视图的完整键盘操作。
- stdin 意外收到或因遗留状态收到 SGR 鼠标报告时，保持 raw input 稳健。

## 非目标

- 此变更不把终端 scrollback 作为 transcript 来源。
- 不承诺移除鼠标跟踪后滚轮会产生 PageUp 或 PageDown 输入。
- 此变更不实现原生 scrollback 或已结算历史插入架构（已在后续工作中完成；参见 `MainScreenRenderer` 与 `Frame.liveStart`）。
- 不增加替代鼠标配置、环境启发式判断或 tmux 专用模式。

## 行为契约

- 交互式启动不得启用终端模式 `1000` 或 `1006`。
- 正常清理必须继续恢复 raw mode、bracketed paste、光标可见性和 shell 光标位置，但不得管理 omdsh 已不再拥有的鼠标模式。
- 鼠标点击、释放、移动和滚轮报告不得移动编辑器光标、滚动虚拟 transcript、选择 overlay 行或激活子代理控件。
- PageUp 和 PageDown 必须继续翻动虚拟 transcript。Shift+Up 和 Shift+Down 必须继续执行现有的较小幅度 transcript 移动。
- 选择器、`/settings`、计划审核、transcript 检查和子代理视图必须保留键盘导航、选择、取消和焦点恢复。
- stdin 意外收到完整 SGR 鼠标报告时，必须将其作为终端控制序列消费，不得转成 composer 文本。解码器可以为此保留一个狭窄的忽略控制序列路径，无需暴露鼠标交互事件。
- Pipe mode 保持不变。

## 实施计划

1. 从 local provider 移除终端鼠标模式所有权。删除鼠标启用和关闭常量及其启动、清理写入，同时保持 bracketed paste、光标、raw mode、renderer 和 resume hint 的清理顺序。
2. 从输入分派移除鼠标动作。删除滚轮滚动 transcript、点击定位光标、点击 overlay、点击设置、点击提示和点击子代理。将丰富的鼠标事件解码替换为最小防御机制，消费完整 SGR 鼠标报告但不分派动作，也不把报告字节插入文本。
3. 删除仅服务于鼠标 hit testing 的代码。删除前审计每个 hit-test 字段和辅助函数，因为部分 overlay 布局状态还支持键盘文档滚动和光标定位；保留仍有非鼠标消费者的状态。
4. 提高键盘替代操作的可发现性。更新现有快捷键和帮助界面，用 PageUp/PageDown 与 Shift+Up/Shift+Down 描述 transcript 导航，并删除所有宣传鼠标交互的可见文本和过期模块注释。
5. 更新聚焦测试和发布说明。用否定测试替换鼠标动作测试，证明意外 SGR 报告会被吞掉；保留每个原可点击界面的键盘导航覆盖；在 `CHANGELOG.md` 的 `Unreleased` 下增加简洁的 `Changed` 条目。

## 预期实施范围

实施预计会修改 local provider、终端输入解码器、对应聚焦测试、仅服务于鼠标的 hit-testing 辅助函数或 frame 元数据、快捷键和帮助界面以及 `CHANGELOG.md`。超出这些区域的变更必须由仍然存在的具体鼠标消费者支持。不得修改 `refs/` 下的任何内容，也不得在运行时使用其中内容。

## 兼容性与风险

- 已结算历史现在进入终端原生 scrollback，由终端/复用器持有。未结算的 streaming tail 仍由 TUI 渲染，键盘滚动在窗口模式下继续可用。
- 原生选择只对终端当前显示且未被重绘的单元格可靠。在部分终端中，流式输出、spinner 更新、resize 或其他 frame 更新可能干扰正在进行的选择。
- tmux 启用 `mouse` 选项时仍可能拥有鼠标行为。移除 omdsh 跟踪不会覆盖 tmux copy-mode 或终端绕过规则。
- 之前崩溃的应用可能遗留已启用的终端鼠标报告。防御性消费 SGR 可以防止报告变成 prompt 文本，同时不重新取得鼠标所有权。

## 验证

聚焦测试必须覆盖交互式启动和清理序列、意外 SGR 报告消费、PageUp/PageDown transcript 翻页、Shift+Up/Shift+Down transcript 移动、仅键盘设置和提示选择、仅键盘子代理检查以及非 TTY 输入。真实 PTY smoke test 必须在 tmux 外和具有代表性的 tmux 鼠标配置下确认普通拖拽选择、键盘 transcript 滚动、Ctrl-C/Ctrl-D 行为和 resume 输出。

运行共享 TUI 和 raw-input 变更所需的仓库检查：

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm check:md
pnpm smoke:happy
pnpm smoke
git diff --check
```

## 验收标准

- 生产代码不发送 `\x1b[?1000h`、`\x1b[?1006h`、`\x1b[?1000l` 或 `\x1b[?1006l`。
- 鼠标事件不会改变 omdsh 应用状态。
- 意外收到的完整 SGR 鼠标报告不会出现在 composer 中。
- 所有必要交互都可以通过键盘到达并操作。
- 面向用户的帮助和 `CHANGELOG.md` 准确描述 keyboard-first 行为。
- 聚焦测试、完整必需检查集和 raw-TTY smoke 测试通过。

## 后续工作

原生 scrollback 已实现为独立的渲染项目。`MainScreenRenderer` 将已结算的 Transcript 历史插入终端 scrollback，同时把流式 tail、composer 和固定两行状态 footer 保留在实时 viewport 中。在 direct terminal 中，临时全屏界面会借用 alternate screen；multiplexer 与 ConPTY 则继续在 main screen 显示，以保留宿主兼容性。这已成为使用原生滚轮浏览完整 transcript 的基础。
