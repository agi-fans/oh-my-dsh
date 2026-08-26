<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

type TranscriptLine = {
  text: string;
  tone: "muted" | "tool" | "answer";
};

const prompt = ref("");
const submittedPrompt = ref("");
const transcript = ref<TranscriptLine[]>([]);
const caretVisible = ref(true);
const samplePrompt = "Hello, Oh My DSH!";
const deepseekLogo = [
  "         ⢀⣀  ⢀⡀",
  "⢀⣤⣶⣿⣿⣿⣿⣿⣿⣿⣧⣄⡀⢻⣿⣷⣶⣶⣶⡿",
  "⣿⡟⠛⠛⠛⠿⢿⣿⣿⣿⣿⡿⢿⣷⣾⣿⣿⠉⠉",
  "⢻⣿⣄⡀  ⢀⠈⠛⢿⣿⣿⣶⣿⣿⡿⠃",
  " ⠙⠻⢿⣶⣦⣼⣿⣷⣦⣭⣿⠿⣿⣷⠦",
  "     ⠉⠉⠉⠉⠉⠁",
] as const;
const timers = new Set<ReturnType<typeof setTimeout>>();
let stopped = false;

function logoColor(row: number, column: number): string {
  const progress = Math.min(1, (column + row * 0.7) / 23);
  const hue = Math.round(292 - progress * 108);
  return `hsl(${hue} 84% 61%)`;
}

function later(callback: () => void, delay: number): void {
  const timer = setTimeout(() => {
    timers.delete(timer);
    if (!stopped) callback();
  }, delay);
  timers.add(timer);
}

function typePrompt(index = 0): void {
  if (index >= samplePrompt.length) {
    later(runTurn, 450);
    return;
  }
  prompt.value += samplePrompt[index];
  later(() => typePrompt(index + 1), 38);
}

function runTurn(): void {
  submittedPrompt.value = prompt.value;
  prompt.value = "";
  transcript.value = [
    {
      tone: "muted",
      text: "The user is saying hello. This is a casual greeting, so no tools are needed.",
    },
  ];
  later(() => {
    transcript.value.push({
      tone: "answer",
      text: "Hello! Welcome to Oh My DSH. Tell me what you’d like to build, fix, or explore.",
    });
  }, 850);
  later(resetDemo, 6200);
}

function resetDemo(): void {
  prompt.value = "";
  submittedPrompt.value = "";
  transcript.value = [];
  later(() => typePrompt(), 650);
}

onMounted(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) {
    submittedPrompt.value = samplePrompt;
    transcript.value = [
      {
        tone: "muted",
        text: "The user is saying hello. This is a casual greeting, so no tools are needed.",
      },
      {
        tone: "answer",
        text: "Hello! Welcome to Oh My DSH. Tell me what you’d like to build, fix, or explore.",
      },
    ];
    caretVisible.value = false;
    return;
  }
  later(() => typePrompt(), 850);
});

onBeforeUnmount(() => {
  stopped = true;
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
});
</script>

<template>
  <div class="terminal-demo" aria-hidden="true">
    <div class="td-chrome">
      <i class="td-dot td-dot-red" />
      <i class="td-dot td-dot-yellow" />
      <i class="td-dot td-dot-green" />
    </div>

    <div class="td-screen">
      <section class="td-welcome">
        <span class="td-welcome-title">omdsh v0.10.0</span>

        <div class="td-identity">
          <strong>Into the Unknown</strong>
          <div class="td-logo">
            <span v-for="(row, rowIndex) in deepseekLogo" :key="rowIndex" class="td-logo-row">
              <i
                v-for="(character, column) in Array.from(row)"
                :key="column"
                class="td-logo-cell"
                :style="{ color: logoColor(rowIndex, column) }"
              >{{ character === " " ? "\u00a0" : character }}</i>
            </span>
          </div>
          <div class="td-model">deepseek-v4-flash</div>
          <div class="td-reasoning">max</div>
        </div>

        <div class="td-welcome-content">
          <div class="td-section td-tips">
            <strong>Tips</strong>
            <div class="td-tip"><span>/</span><span>Browse available commands</span></div>
            <div class="td-tip"><span>/resume</span><span>Continue a durable session</span></div>
            <div class="td-tip"><span>Ctrl+R</span><span>Search prompt history</span></div>
            <div class="td-tip"><span>Shift+Enter</span><span>Insert a newline</span></div>
          </div>
          <div class="td-section td-recent">
            <strong>Recent sessions</strong>
            <div>review the current changes <span>(just now)</span></div>
            <div>improve terminal rendering <span>(8m ago)</span></div>
            <div>prepare the next release <span>(1h ago)</span></div>
          </div>
        </div>
      </section>

      <div class="td-transcript">
        <div v-if="submittedPrompt" class="td-user-message">{{ submittedPrompt }}</div>
        <div class="td-response">
          <div v-for="(line, index) in transcript" :key="`${index}-${line.text}`" :class="`td-${line.tone}`">
            {{ line.text }}
          </div>
        </div>
      </div>

      <div class="td-composer">
        <span class="td-composer-label">🐳</span>
        <span class="td-access">full access</span>
        <span>{{ prompt }}</span><i v-if="caretVisible" class="td-caret" />
      </div>

      <footer class="td-footer">
        <div class="td-footer-row">
          <span><b>deepseek-v4-flash</b> · <em>max</em> · <mark>standard</mark></span>
          <span>~/oh-my-dsh&nbsp; · &nbsp;main</span>
        </div>
        <div class="td-footer-row">
          <span>Ctx <mark>1%</mark> · <b>10.1k/1M</b> · Cache <em>99%</em></span>
          <span>TTFT <em>0.9s</em> · <em>97 tok/s</em> · <b>9.6K</b> in · <b>395</b> out</span>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.terminal-demo {
  width: min(760px, calc(100vw - 32px));
  overflow: hidden;
  color: #c8c7cc;
  background: #101016;
  border: 1px solid #20212b;
  border-radius: 17px;
  box-shadow: 0 26px 72px rgb(0 0 0 / 42%);
  font-family: "SFMono-Regular", "Cascadia Code", "JetBrains Mono", ui-monospace, monospace;
  font-size: 10px;
  line-height: 1.45;
  text-align: left;
}

.td-chrome {
  display: flex;
  gap: 7px;
  align-items: center;
  height: 29px;
  padding: 0 11px;
  background: #101016;
}

.td-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.td-dot-red { background: #ff5f57; }
.td-dot-yellow { background: #febc2e; }
.td-dot-green { background: #28c840; }

.td-screen {
  padding: 12px 13px 10px;
}

.td-welcome {
  position: relative;
  display: grid;
  grid-template-columns: 31% 69%;
  min-height: 168px;
  border: 1px solid #363843;
  border-radius: 2px;
}

.td-welcome-title {
  position: absolute;
  top: 0;
  left: 14px;
  z-index: 1;
  padding: 0 7px;
  color: #696b77;
  background: #101016;
  transform: translateY(-55%);
}

.td-identity {
  display: flex;
  min-width: 0;
  padding: 13px 10px 8px;
  flex-direction: column;
  align-items: center;
  border-right: 1px solid #363843;
}

.td-identity strong {
  align-self: center;
  color: #d3d2d6;
  text-align: center;
}

.td-logo {
  display: grid;
  margin: 15px 0 8px;
  font-family: Menlo, Monaco, "DejaVu Sans Mono", monospace;
  font-size: 9.5px;
  line-height: 1;
}

.td-logo-row {
  display: grid;
  height: 1.45em;
  grid-auto-columns: 0.52em;
  grid-auto-flow: column;
  justify-content: start;
}

.td-logo-cell {
  display: block;
  width: 0.52em;
  overflow: visible;
  font-style: normal;
  text-align: center;
  transform: scale(0.84, 1.55);
  transform-origin: center;
}

.td-model,
.td-reasoning {
  max-width: 100%;
  overflow: hidden;
  color: #6d6f79;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.td-reasoning { margin-top: 2px; }

.td-welcome-content {
  display: grid;
  min-width: 0;
  grid-template-rows: auto 1fr;
}

.td-section {
  min-width: 0;
  padding: 10px 9px;
  overflow: hidden;
}

.td-section strong {
  display: block;
  margin-bottom: 4px;
  color: #f0a818;
}

.td-tips { border-bottom: 1px solid #363843; }

.td-tip {
  display: grid;
  grid-template-columns: 112px 1fr;
  color: #646672;
}

.td-tip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.td-recent div {
  overflow: hidden;
  color: #6d6f79;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.td-recent span { color: #50525d; }

.td-transcript {
  min-height: 155px;
  padding: 18px 0 20px;
}

.td-user-message {
  margin-bottom: 14px;
  padding: 14px 12px;
  color: #d6d4d7;
  background: #191613;
}

.td-response {
  display: grid;
  gap: 10px;
  padding: 0 13px;
}

.td-muted { color: #646672; }
.td-tool { color: #65c6a3; }
.td-answer { color: #d7d6d9; }

.td-composer {
  position: relative;
  min-height: 43px;
  padding: 13px 11px 8px;
  color: #dedde0;
  border: 1px solid #17627a;
  border-radius: 2px;
}

.td-composer-label,
.td-access {
  position: absolute;
  top: 0;
  padding: 0 7px;
  background: #101016;
  transform: translateY(-55%);
}

.td-composer-label { left: 8px; }

.td-access {
  right: 8px;
  color: #ff5364;
}

.td-caret {
  display: inline-block;
  width: 5px;
  height: 1.15em;
  margin-left: 2px;
  vertical-align: -2px;
  background: #aeb0ba;
  animation: blink 1s steps(1) infinite;
}

.td-footer {
  display: grid;
  gap: 2px;
  padding: 7px 8px 0;
  color: #696b76;
}

.td-footer-row {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  white-space: nowrap;
}

.td-footer b,
.td-footer em,
.td-footer mark {
  font: inherit;
  background: none;
}

.td-footer b { color: #e5a912; }
.td-footer em { color: #60c878; }
.td-footer mark { color: #ad77df; }

@keyframes blink {
  50% { opacity: 0; }
}

@media (max-width: 640px) {
  .terminal-demo {
    width: min(520px, calc(100vw - 24px));
    font-size: 8.5px;
  }

  .td-screen { padding: 10px; }
  .td-welcome { grid-template-columns: 38% 62%; }
  .td-tip { grid-template-columns: 74px 1fr; }
  .td-transcript { min-height: 132px; padding-bottom: 18px; }
  .td-footer-row span:last-child { overflow: hidden; text-overflow: ellipsis; }
}

@media (max-width: 430px) {
  .td-chrome { height: 24px; }
  .td-welcome { min-height: 150px; }
  .td-identity { padding-inline: 5px; }
  .td-logo { margin-block: 13px 7px; font-size: 7px; }
  .td-section { padding: 8px 7px; }
  .td-tip { grid-template-columns: 60px 1fr; }
  .td-tip:nth-of-type(4),
  .td-recent div:nth-of-type(3) { display: none; }
  .td-transcript { min-height: 126px; padding: 14px 0 16px; }
  .td-response { gap: 7px; padding-inline: 8px; }
  .td-footer-row:first-child span:last-child,
  .td-footer-row:last-child span:first-child { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .td-caret { animation: none; }
}
</style>
