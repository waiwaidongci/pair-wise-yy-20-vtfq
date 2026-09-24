// 页面操作层：渲染、交互、播放、试听流程。生成规则见 variations.js，存档见 audition.js。
import {
  generateCandidates,
  createSeed,
  commandSteps,
  stepsPerMeasure
} from "./js/variations.js";
import {
  loadAudition,
  saveAudition,
  clearAudition,
  openAudition,
  applyCandidate,
  sessionConflict
} from "./js/audition.js";

const storageKey = "wxyy-4-luogujing-grid";
const instruments = [
  { name: "大锣", token: "仓", freq: 180 },
  { name: "鼓", token: "冬", freq: 120 },
  { name: "钹", token: "才", freq: 360 },
  { name: "小锣", token: "台", freq: 520 }
];
const tokens = instruments.map((i) => i.token);
const steps = 16;
const measureCount = 4;

const state = JSON.parse(localStorage.getItem(storageKey) || "null") || {
  pieceName: "出场锣鼓-慢起",
  bpm: 96,
  loop: "",
  notes: [],
  pattern: instruments.map((instrument) => Array.from({ length: steps }, (_, index) => index % 4 === 0 ? instrument.token : "")),
  saved: []
};

let timer = null;
let playhead = 0;
let auditionTimer = null;
let auditionStep = 0;
let audioContext = null;
let audition = loadAudition();

const grid = document.querySelector("#grid");
const savedList = document.querySelector("#savedList");
const structure = document.querySelector("#structure");
const notesList = document.querySelector("#notesList");
const pieceName = document.querySelector("#pieceName");
const bpmInput = document.querySelector("#bpmInput");
const loopSelect = document.querySelector("#loopSelect");
const noteInput = document.querySelector("#noteInput");
const variationMeasure = document.querySelector("#variationMeasure");
const generateBtn = document.querySelector("#generateBtn");
const candidateArea = document.querySelector("#candidateArea");
const variationMessage = document.querySelector("#variationMessage");

function save() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function syncFields() {
  pieceName.value = state.pieceName;
  bpmInput.value = state.bpm;
  loopSelect.value = state.loop;
}

function beatLabel(index) {
  const measure = Math.floor(index / 4) + 1;
  const beat = (index % 4) + 1;
  return `${measure}-${beat}`;
}

function lockedSteps() {
  if (!audition) return new Set();
  const start = audition.measure * stepsPerMeasure;
  const set = new Set();
  for (let s = 0; s < stepsPerMeasure; s += 1) set.add(start + s);
  return set;
}

function commandStepSet(measure) {
  return new Set(commandSteps(state.pattern, measure).map((s) => measure * stepsPerMeasure + s));
}

function renderGrid() {
  const locked = lockedSteps();
  const header = ['<div class="label-cell">乐器</div>'];
  for (let i = 0; i < steps; i += 1) {
    header.push(`<div class="beat-cell">${beatLabel(i)}</div>`);
  }

  const rows = instruments.flatMap((instrument, rowIndex) => {
    const row = [`<div class="label-cell">${instrument.name}</div>`];
    for (let step = 0; step < steps; step += 1) {
      const value = state.pattern[rowIndex][step];
      const isLocked = locked.has(step);
      const classes = ["cell", value ? "filled" : ""];
      if (isLocked) classes.push("locked");
      row.push(
        `<button class="${classes.filter(Boolean).join(" ")}" type="button" data-row="${rowIndex}" data-step="${step}" ${isLocked ? "disabled" : ""} title="${isLocked ? "试听中，本小节已锁定" : ""}">${value}${isLocked && !value ? "·" : ""}</button>`
      );
    }
    return row;
  });

  grid.innerHTML = [...header, ...rows].join("");
}

function renderSidebars() {
  const filledByMeasure = Array.from({ length: measureCount }, (_, measure) => {
    const start = measure * stepsPerMeasure;
    const count = state.pattern.flatMap((row) => row.slice(start, start + 4)).filter(Boolean).length;
    const frozen = commandSteps(state.pattern, measure).length;
    return { measure: measure + 1, count, frozen };
  });
  structure.innerHTML = filledByMeasure.map((item) => `
    <div class="structure-row"><span>第${item.measure}小节</span><strong>${item.count}个口令 · ${item.frozen}格骨架</strong></div>
  `).join("");

  notesList.innerHTML = state.notes.length ? state.notes.map((note) => `
    <article class="note"><p>${note}</p></article>
  `).join("") : "<p>暂无批注。</p>";

  savedList.innerHTML = state.saved.length ? state.saved.map((item) => `
    <button class="saved-item" type="button" data-load="${item.id}">
      <strong>${item.name}</strong><br><span>${item.bpm}BPM · ${item.notes.length}条批注</span>
    </button>
  `).join("") : "<p>还没有保存方案。</p>";
}

function miniGridHtml(candidateGrid, frozenLocal) {
  return candidateGrid.map((row, r) => {
    const cells = row.map((value, s) => {
      const cls = frozenLocal.includes(s) ? "mini-cell command" : value ? "mini-cell hit" : "mini-cell";
      return `<span class="${cls}">${value || ""}</span>`;
    }).join("");
    return `<div class="mini-row"><span class="mini-inst">${instruments[r].token}</span>${cells}</div>`;
  }).join("");
}

function renderAudition() {
  variationMeasure.value = String(audition ? audition.measure : variationMeasure.value);
  if (!audition) {
    candidateArea.innerHTML = "<p class=\"placeholder\">尚未生成。选好小节点“生成三份候选”，三份会先停在这里供试听。</p>";
    return;
  }

  const frozenLocal = audition.frozen;
  const conflicted = sessionConflict(state.pattern, audition);
  candidateArea.innerHTML = audition.candidates.map((candidate, index) => `
    <article class="candidate ${audition.activeIndex === index ? "active" : ""}" data-index="${index}">
      <header>
        <strong>${candidate.label}</strong>
        <span class="hits">${candidate.hits}响 · 口令格保留 ${frozenLocal.length}</span>
      </header>
      <div class="mini-grid" data-audition-grid="${index}">${miniGridHtml(candidate.grid, frozenLocal)}</div>
      <div class="candidate-actions">
        <button type="button" class="ghost" data-audition-play="${index}">试听</button>
        <button type="button" class="accept" data-audition-adopt="${index}" ${conflicted ? "disabled" : ""}>采纳</button>
      </div>
    </article>
  `).join("") + `
    <div class="audition-footer">
      <button type="button" class="ghost" id="regenerateBtn">重新生成</button>
      <button type="button" class="ghost danger" id="discardBtn">放弃候选（保留原谱）</button>
      <p class="seed-note">种子 ${audition.seed} · 第${audition.round || 1}轮 · 可复现 · 第${audition.measure + 1}小节${conflicted ? " · 与现谱冲突" : ""}</p>
    </div>`;
}

function setMessage(text, kind) {
  variationMessage.textContent = text || "";
  variationMessage.className = `variation-message ${kind || ""}`.trim();
}

function render() {
  syncFields();
  renderGrid();
  renderSidebars();
  renderAudition();
  if (audition && sessionConflict(state.pattern, audition)) {
    setMessage(`冲突小节：第${audition.measure + 1}小节在试听期间被改动，候选已停用。口令骨架（强拍齐奏）保持不动，请放弃后重新生成。`, "error");
  }
}

function playSound(instrument) {
  audioContext ||= new AudioContext();
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.frequency.value = instrument.freq;
  osc.type = instrument.name === "鼓" ? "sine" : "square";
  gain.gain.setValueAtTime(0.08, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.08);
  osc.connect(gain).connect(audioContext.destination);
  osc.start();
  osc.stop(audioContext.currentTime + 0.09);
}

function highlight(step) {
  document.querySelectorAll(".cell.playing").forEach((cell) => cell.classList.remove("playing"));
  document.querySelectorAll(`[data-step="${step}"]`).forEach((cell) => cell.classList.add("playing"));
}

function currentRange() {
  if (state.loop === "") return [0, steps - 1];
  const start = Number(state.loop) * 4;
  return [start, start + 3];
}

function tick() {
  const [start, end] = currentRange();
  if (playhead < start || playhead > end) playhead = start;
  highlight(playhead);
  instruments.forEach((instrument, rowIndex) => {
    if (state.pattern[rowIndex][playhead]) playSound(instrument);
  });
  playhead = playhead >= end ? start : playhead + 1;
}

function stopAuditionPlayback() {
  if (auditionTimer) clearInterval(auditionTimer);
  auditionTimer = null;
  document.querySelectorAll("[data-audition-grid] .mini-cell.playing").forEach((cell) => cell.classList.remove("playing"));
}

function stopMainPlayback() {
  if (timer) clearInterval(timer);
  timer = null;
  document.querySelectorAll(".cell.playing").forEach((cell) => cell.classList.remove("playing"));
}

// 试听播放：只响候选（仅目标小节这 4 格），主谱不响。
function playCandidate(index) {
  if (!audition) return;
  stopAuditionPlayback();
  stopMainPlayback();
  audition.activeIndex = index;
  saveAudition(audition);
  renderAudition();

  const candidate = audition.candidates[index].grid;
  auditionStep = 0;

  const stepTick = () => {
    document.querySelectorAll("[data-audition-grid] .mini-cell.playing").forEach((cell) => cell.classList.remove("playing"));
    const gridEl = document.querySelector(`[data-audition-grid="${index}"]`);
    if (gridEl) {
      gridEl.querySelectorAll(`.mini-row`).forEach((rowEl, r) => {
        const cellEl = rowEl.querySelectorAll(".mini-cell")[auditionStep];
        if (candidate[r][auditionStep]) {
          playSound(instruments[r]);
          cellEl.classList.add("playing");
        }
      });
    }
    auditionStep = (auditionStep + 1) % stepsPerMeasure;
  };

  stepTick();
  auditionTimer = setInterval(stepTick, 60000 / state.bpm);
}

grid.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell || cell.disabled) return;
  const row = Number(cell.dataset.row);
  const step = Number(cell.dataset.step);
  state.pattern[row][step] = state.pattern[row][step] ? "" : instruments[row].token;
  save();
  render();
});

pieceName.addEventListener("input", () => {
  state.pieceName = pieceName.value;
  save();
});

bpmInput.addEventListener("input", () => {
  state.bpm = Number(bpmInput.value || 96);
  save();
  if (timer) {
    clearInterval(timer);
    timer = setInterval(tick, 60000 / state.bpm);
  }
  if (auditionTimer) {
    const index = audition.activeIndex || 0;
    playCandidate(index);
  }
});

loopSelect.addEventListener("change", () => {
  state.loop = loopSelect.value;
  playhead = currentRange()[0];
  save();
});

noteInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !noteInput.value.trim()) return;
  state.notes.unshift(noteInput.value.trim());
  noteInput.value = "";
  save();
  renderSidebars();
});

document.querySelector("#playBtn").addEventListener("click", () => {
  // 试听期间播放只响候选
  if (audition) {
    playCandidate(audition.activeIndex || 0);
    return;
  }
  stopAuditionPlayback();
  if (timer) clearInterval(timer);
  playhead = currentRange()[0];
  tick();
  timer = setInterval(tick, 60000 / state.bpm);
});

document.querySelector("#stopBtn").addEventListener("click", () => {
  stopMainPlayback();
  stopAuditionPlayback();
});

document.querySelector("#saveBtn").addEventListener("click", () => {
  state.saved.unshift({
    id: crypto.randomUUID(),
    name: state.pieceName || "未命名片段",
    bpm: state.bpm,
    loop: state.loop,
    notes: [...state.notes],
    pattern: state.pattern.map((row) => [...row]),
    createdAt: new Date().toISOString()
  });
  save();
  renderSidebars();
});

savedList.addEventListener("click", (event) => {
  const id = event.target.closest("[data-load]")?.dataset.load;
  const item = state.saved.find((entry) => entry.id === id);
  if (!item) return;
  state.pieceName = item.name;
  state.bpm = item.bpm;
  state.loop = item.loop;
  state.notes = [...item.notes];
  state.pattern = item.pattern.map((row) => [...row]);
  save();
  render();
});

function generate(roundBump) {
  stopAuditionPlayback();
  const measure = Number(variationMeasure.value);
  // 同一小节反复重新生成时推进轮次，换一批花；种子仍由谱面+轮次派生，可复现。
  const round = audition && audition.measure === measure ? audition.round + (roundBump ? 1 : 0) : 1;
  const seed = createSeed(state.pattern, measure, round);
  const result = generateCandidates(state.pattern, measure, seed, tokens);

  if (!result.ok) {
    const frozen = commandSteps(state.pattern, measure).map((s) => s + 1);
    setMessage(`已保留原谱。冲突小节：第${measure + 1}小节；保留口令格：第${frozen.join("、")}拍；失败原因：${result.reason}`, "error");
    return;
  }

  audition = openAudition({
    measure,
    seed,
    round,
    frozen: result.frozen,
    candidates: result.candidates,
    patternSnapshot: state.pattern.map((row) => [...row])
  });
  setMessage(`第${measure + 1}小节三份候选已停在试听区（种子 ${seed}）。口令格第${result.frozen.map((s) => s + 1).join("、")}拍整格保留；播放只响候选，采纳才替换本小节。`, "ok");
  render();
}

generateBtn.addEventListener("click", () => generate(true));

candidateArea.addEventListener("click", (event) => {
  if (event.target.closest("#regenerateBtn")) {
    generate(true);
    return;
  }
  if (event.target.closest("#discardBtn")) {
    if (!audition) return;
    const measure = audition.measure;
    clearAudition();
    audition = null;
    stopAuditionPlayback();
    setMessage(`已放弃第${measure + 1}小节候选，原谱与已存方案全部保留。`, "ok");
    render();
    return;
  }

  const playBtn = event.target.closest("[data-audition-play]");
  const adoptBtn = event.target.closest("[data-audition-adopt]");
  const card = event.target.closest(".candidate");

  if (playBtn) {
    playCandidate(Number(playBtn.dataset.auditionPlay));
    return;
  }

  if (adoptBtn) {
    if (!audition) return;
    const index = Number(adoptBtn.dataset.auditionAdopt);
    if (sessionConflict(state.pattern, audition)) {
      setMessage(`冲突小节：第${audition.measure + 1}小节已被改动，无法采纳，候选作废。口令骨架保留，原谱不变。`, "error");
      return;
    }
    const measure = audition.measure;
    const label = audition.candidates[index].label;
    state.pattern = applyCandidate(state.pattern, audition, index);
    save();
    clearAudition();
    audition = null;
    stopAuditionPlayback();
    setMessage(`已采纳第${measure + 1}小节「${label}」候选，仅替换该小节；其余谱面与已存方案照旧。`, "ok");
    render();
    return;
  }

  if (card && audition) {
    audition.activeIndex = Number(card.dataset.index);
    saveAudition(audition);
    renderAudition();
  }
});

render();
