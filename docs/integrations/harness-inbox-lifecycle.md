# Harness inbox lifecycle: preservation on release

Assessment date: 2026-11-05, rechecked against `0.2.2-rc.3` on 2026-11-14. Scope: the published `0.2.2-rc.3` Harness cohort used by omdsh, including `dsh-agent`, `dsh-agent-loop`, session persistence and attachment storage. No dependency versions, package sources or upstream files are changed by this assessment.

## Result

Normal disposal cancels accepted, unclaimed messages in both inboxes. `agent.cancel({ kind: 'user' }, { keepInbox: true })` preserves them, but a later `AgentHandle.dispose()` or unload of the owning Cordis fiber clears them durably. Resume therefore sees empty queues. The image and file blobs remain readable; their queued messages have been canceled, rather than their attachment bytes lost.

As of the recheck, npm's `next` tag for `@deepseek-ai/dsh-agent-loop` is `0.2.2-rc.3`; its `latest` tag is the older `0.1.0-rc.6`. The published `AgentHandle.dispose()` still exposes no preservation option, so the blocked capability is unchanged. This is not a reason to downgrade to `latest` or mix release cohorts.

## Reproduce against published packages

From the omdsh repository, with its normal dependencies installed and product packages built:

```sh
pnpm exec tsx scripts/probe-harness-inbox.mjs
```

The probe creates an isolated home and workspace, mounts the application in exec mode without a TUI runner, and uses the published Agent, persistence and attachment services. It stores one real PNG and one text file, appends two next-turn messages and one next-step message through the public inbox, and verifies that Stop retains the exact messages and attachment references. It then releases the handle, reads the cold log and resumes the same session. A separate case unloads the owner fiber instead of explicitly releasing the handle. No model is invoked, no credentials are needed, and temporary data is removed on completion.

Observed result:

| Release path | Before Stop | After Stop | After release and resume | Attachment bytes |
| --- | --- | --- | --- | --- |
| `handle.dispose()` | 1 next-step, 2 next-turn | Identical messages | 0 next-step, 0 next-turn | Readable |
| Owning fiber unload | 1 next-step, 2 next-turn | Identical messages | 0 next-step, 0 next-turn | Readable |

Both cold logs contain two additional `agent/inbox/spliced` records with `outcome: canceled`: one removes the next-step message; the other removes both next-turn messages. Replaying those logs accurately produces empty queues. A TUI cannot fix this by changing its projection.

The future acceptance gate is:

```sh
pnpm exec tsx scripts/probe-harness-inbox.mjs --expect-preserved
```

This command intentionally fails on the current release. Once a supported release policy is available, update the probe to select that public policy before requiring this gate in CI. The ordinary diagnostic command exits successfully after reporting the observed behavior; that does not mean queue restoration passes.

## Source evidence

- [Public AgentHandle contract](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/core/agent/src/index.ts#L160): only `agent` and parameterless `dispose()` are exposed.
- [Ready-agent teardown](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/core/agent-loop/src/index.ts#L517): disposal calls `cancel` with `keepInbox: !ready`. Initialization failure preserves pending input; a successfully published handle does not.
- [Cancel semantics](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/core/agent-loop/src/agent.ts#L191): cancellation without `keepInbox` clears the inbox before aborting active work.
- [Durable inbox mutations](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/core/agent-loop/src/inbox.ts): clearing records cancellation splices in the Session log.

The installed npm artifact was checked against these source contracts. The minimal semantic sequence, independent of terminal rendering, is:

```ts
const handle = await ctx.agents.create(options)
handle.agent.inbox.append('next-turn', queuedMessage)
handle.agent.inbox.append('next-step', steeringMessage)
handle.agent.cancel({ kind: 'user' }, { keepInbox: true })
await handle.agent.whenIdle()
// Both messages are still pending here.
await handle.dispose()
const resumed = await ctx.agents.resume(resumeOptions)
// Both inboxes are empty on 0.2.2-rc.3.
```

## Proposed upstream issue

Title: Allow releasing a ready Agent while preserving durable pending inbox messages

A terminal client needs to release a session's live resources on navigation or shutdown without treating every accepted, unclaimed user message as withdrawn. Currently Stop can retain the inbox, but both explicit handle disposal and owner-fiber unload subsequently cancel it. This makes a normally closed session less recoverable than an uncleared persisted log.

Please provide an opt-in public lifecycle policy for preserving pending inbox input while stopping active work, draining persistence, releasing the write lock, unregistering the Agent and Session, and disposing their scoped resources. Keep the existing discard behavior available for intentional destructive disposal and archival.

A create/resume option captured by the handle, such as `inboxOnDispose: 'preserve' | 'discard'`, would make the policy consistent across explicit release, owner unload and factory teardown. The exact API is an upstream decision. A one-call `dispose({ keepInbox: true })` option would also need a documented rule for owner/factory teardown winning the race before that call. Removing the client's explicit dispose call alone does not help: owner unload reaches the same teardown path.

Required acceptance cases:

- Multiple next-step and next-turn messages retain their exact IDs, order, attribution, text, image references and file references through release and resume.
- Explicit release, owner-fiber unload, factory unload and concurrent disposal requests follow the same selected preservation policy and finish cleanup once.
- Preserving an inbox does not start another model request during shutdown. Opening a session for inspection must not silently send its pending messages.
- Claimed or already admitted messages do not return to either queue or get submitted a second time.
- Stop, terminal failure, persistence failure and initialization rollback retain their documented distinctions; explicit withdrawal and destructive disposal still record cancellation.

This issue text is prepared locally and has not been posted upstream.

## omdsh integration after an upstream release

Adopt a coherent published Harness cohort that supplies the policy. Select it at every top-level create/resume path, including temporary handles used to rename or inspect sessions; keep child-agent and intentional deletion semantics explicit. Then exercise stop → switch → return and normal exit → resume through the built CLI, with mixed attachments and an exact count of requests reaching the mock provider.

Until then, normal-exit and session-switch queue recovery remains blocked. omdsh does not retain a shadow copy of accepted messages, replay canceled messages automatically, overwrite `Agent.cancel`, skip resource cleanup, or patch `refs/` or installed packages. Queue → Steer uses the existing public inbox and steering entry points and can be delivered independently.
