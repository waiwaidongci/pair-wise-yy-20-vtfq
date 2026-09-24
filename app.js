const storageKey = "wxyy-4-luogujing-grid";
const instruments = [
  { name: "大锣", token: "仓", freq: 180 },
  { name: "鼓", token: "冬", freq: 120 },
  { name: "钹", token: "才", freq: 360 },
  { name: "小锣", token: "台", freq: 520 }
];
const tokens = instruments.map((instrument) => instrument.token);
const steps = 16;
const measuresCount = 4;
const beatsPerMeasure = 4;
let safeStorage = null;
try {
  safeStorage = localStorage;
} catch (error) {
  safeStorage = null;
}
const candidateStore = LuoguCandidateStore.createStore(safeStorage);

const defaultPattern = () =>
  instruments.map((instrument) => Array.from({ length: steps }, (_, index) =>
    index % 4 === 0 ? instrument.token : ""));
const emptyLocks = () => instruments.map(() => Array(steps).fill(false));

const state = JSON.parse((safeStorage && safeStorage.getItem(storageKey)) || "null") || {
  pieceName: "出场锣鼓-慢起",
  bpm: 96,
  loop: "",
  notes: [],
  pattern: defaultPattern(),
  locks: emptyLocks(),
  saved: []
};
// 兼容旧存档：没有保留格字段时补齐
if (!Array.isArray(state.locks) || state.locks.length !== instruments.length) state.locks = emptyLocks();

let timer = null;
let playhead = 0;
let audioContext = null;
let lockMode = false;
let audition = candidateStore.load(); // 关闭页面再打开，仍能接着试听

const grid = document.querySelector("#grid");
const savedList = document.querySelector("#savedList");
const structure = document.querySelector("#structure");
const notesList = document.querySelector("#notesList");
const pieceName = document.querySelector("#pieceName");
const bpmInput = document.querySelector("#bpmInput");
const loopSelect = document.querySelector("#loopSelect");
const noteInput = document.querySelector("#noteInput");
const varMeasure = document.querySelector("#varMeasure");
const varDensity = document.querySelector("#varDensity");
const lockBtn = document.querySelector("#lockBtn");
const lockHint = document.querySelector("#lockHint");
const auditionSection = document.querySelector("#audition");
const auditionMeta = document.querySelector("#auditionMeta");
const candidateList = document.querySelector("#candidateList");
const auditionConflict = document.querySelector("#auditionConflict");
const statusBox = document.querySelector("#statusBox");

function save() {
  try {
    safeStorage && safeStorage.setItem(storageKey, JSON.stringify(state));
  } catch (error) {
    /* 存储不可用时仅影响刷新后的持久化 */
  }
}

function syncFields() {
  pieceName.value = state.pieceName;
  bpmInput.value = state.bpm;
  loopSelect.value = state.loop;
}

function beatLabel(index) {
  const measure = Math.floor(index / beatsPerMeasure) + 1;
  const beat = (index % beatsPerMeasure) + 1;
  return `${measure}-${beat}`;
}

function measureSlice(measureIndex) {
  const start = measureIndex * beatsPerMeasure;
  return state.pattern.map((row) => row.slice(start, start + beatsPerMeasure));
}

function lockSlice(measureIndex) {
  const start = measureIndex * beatsPerMeasure;
  return state.locks.map((row) => row.slice(start, start + beatsPerMeasure));
}

function renderGrid() {
  const header = ['<div class="label-cell">乐器</div>'];
  for (let i = 0; i < steps; i += 1) {
    header.push(`<div class="beat-cell">${beatLabel(i)}</div>`);
  }

  const rows = instruments.flatMap((instrument, rowIndex) => {
    const row = [`<div class="label-cell">${instrument.name}</div>`];
    for (let step = 0; step < steps; step += 1) {
      const value = state.pattern[rowIndex][step];
      const locked = state.locks[rowIndex][step];
      const classes = ["cell"];
      if (value) classes.push("filled");
      if (locked) classes.push("locked");
      const badge = locked ? '<span class="lock-badge">钉</span>' : "";
      row.push(
        `<button class="${classes.join(" ")}" type="button" data-row="${rowIndex}" data-step="${step}">${value}${badge}</button>`
      );
    }
    return row;
  });

  grid.innerHTML = [...header, ...rows].join("");
}

function renderSidebars() {
  const filledByMeasure = Array.from({ length: measuresCount }, (_, measure) => {
    const cells = state.pattern.flatMap((row) => row.slice(measure * 4, measure * 4 + 4));
    const locks = state.locks.flatMap((row) => row.slice(measure * 4, measure * 4 + 4)).filter(Boolean).length;
    return { measure: measure + 1, count: cells.filter(Boolean).length, locks };
  });
  structure.innerHTML = filledByMeasure.map((item) => `
    <div class="structure-row">
      <span>第${item.measure}小节</span>
      <strong>${item.count}个口令${item.locks ? ` · 钉${item.locks}` : ""}</strong>
    </div>
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

function renderAudition() {
  if (!audition) {
    auditionSection.hidden = true;
    auditionConflict.innerHTML = "";
    return;
  }
  auditionSection.hidden = false;
  const lockedText = audition.locked.length
    ? audition.locked.map((entry) =>
        `${instruments[entry.row].name}·${audition.measure + 1}-${entry.col + 1}「${entry.token}」`).join("，")
    : "无";
  auditionMeta.innerHTML = `
    <span>目标：<strong>第${audition.measure + 1}小节 · ${audition.tier}（${audition.target}点）</strong></span>
    <span>候选数：3 份</span>
    <span>保留口令：${lockedText}</span>
    <span>复现号：${audition.seed.toString(16)}</span>
  `;
  candidateList.innerHTML = audition.candidates.map((matrix, candidateIndex) => {
    const rows = matrix.map((row, rowIndex) => `
      <div class="mini-row">
        <span class="mini-label">${instruments[rowIndex].name}</span>
        ${row.map((value, col) => `
          <button class="mini-cell ${value ? "filled" : ""}" type="button" disabled
                  data-candidate="${candidateIndex}" data-index="${col}">${value}</button>
        `).join("")}
      </div>
    `).join("");
    const count = matrix.flat().filter(Boolean).length;
    return `
      <article class="candidate-card" data-candidate="${candidateIndex}">
        <header>
          <strong>候选 ${candidateIndex + 1} · ${audition.tier}</strong>
          <span>${count} 个口令</span>
        </header>
        <div class="mini-grid">${rows}</div>
        <footer>
          <button class="ghost-btn" type="button" data-action="preview" data-candidate="${candidateIndex}">试听本份</button>
          <button class="adopt-btn" type="button" data-action="adopt" data-candidate="${candidateIndex}">采纳替换</button>
        </footer>
      </article>
    `;
  }).join("");
}

function setStatus(message, level) {
  statusBox.textContent = message || "";
  statusBox.className = level ? `status ${level}` : "status";
  if (!message) return;
  clearTimeout(setStatus.timer);
  if (level === "ok" || level === "info") {
    setStatus.timer = setTimeout(() => {
      statusBox.textContent = "";
      statusBox.className = "status";
    }, 5000);
  }
}

function render() {
  syncFields();
  renderGrid();
  renderSidebars();
  renderAudition();
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

function clearHighlights(selector) {
  document.querySelectorAll(selector).forEach((cell) => cell.classList.remove("playing"));
}

function highlight(step) {
  clearHighlights(".cell.playing");
  document.querySelectorAll(`.cell[data-step="${step}"]`).forEach((cell) => cell.classList.add("playing"));
}

function currentRange() {
  if (state.loop === "") return [0, steps - 1];
  const start = Number(state.loop) * beatsPerMeasure;
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

/* ---------- 变奏预演：试听播放（只响候选，不碰正式谱面） ---------- */

let preview = { candidateIndex: null, offset: 0 };

function stopPlayback() {
  if (timer) clearInterval(timer);
  timer = null;
  clearHighlights(".cell.playing");
  clearHighlights(".mini-cell.playing");
  document.querySelectorAll("[data-action='preview'].playing").forEach((button) => {
    button.classList.remove("playing");
    button.textContent = "试听本份";
  });
  preview = { candidateIndex: null, offset: 0 };
}

function previewTick() {
  const { candidateIndex, offset } = preview;
  const matrix = audition.candidates[candidateIndex];
  const col = offset % beatsPerMeasure;
  clearHighlights(".mini-cell.playing");
  matrix.forEach((row, rowIndex) => {
    if (row[col]) playSound(instruments[rowIndex]);
  });
  document
    .querySelectorAll(`.mini-cell[data-candidate="${candidateIndex}"][data-index="${col}"]`)
    .forEach((cell) => cell.classList.add("playing"));
  preview.offset = (offset + 1) % beatsPerMeasure;
}

function playCandidate(candidateIndex) {
  if (!audition) return;
  stopPlayback();
  preview = { candidateIndex, offset: 0 };
  const button = candidateList.querySelector(`[data-action="preview"][data-candidate="${candidateIndex}"]`);
  if (button) {
    button.classList.add("playing");
    button.textContent = "停止试听";
  }
  previewTick();
  timer = setInterval(previewTick, 60000 / state.bpm);
}

/* ---------- 变奏预演：生成 / 采纳 / 放弃 ---------- */

function reasonToText(reason) {
  if (reason === "locked-too-full") {
    return "保留点太满：保留口令删不得，该档点数已装不下或凑不齐，原谱保留。";
  }
  if (reason === "same-as-current") {
    return "候选与当前相同：在这些保留口令下，该档只剩当前这一种排法，原谱保留。";
  }
  return "三份凑不齐：受保留口令限制，凑不够三份彼此不同的候选，原谱保留。";
}

function showConflict(result, measureIndex) {
  const lockedText = result.locked.length
    ? result.locked.map((entry) =>
        `${instruments[entry.row].name}·${measureIndex + 1}-${entry.col + 1}「${entry.token}」`).join("，")
    : "无";
  auditionConflict.innerHTML = `
    <article class="conflict-card">
      <header><strong>预演失败，已保留原谱</strong></header>
      <p>冲突小节：<strong>第${measureIndex + 1}小节 · ${result.tier}档（目标${result.target}点）</strong></p>
      <p>保留口令：${lockedText}</p>
      <p>保留口令点数：${result.lockedFilled} / ${result.target}；可动格：${result.freeCount}；还需填：${result.need}</p>
      <p class="conflict-reason">失败原因：${reasonToText(result.reason)}</p>
    </article>
  `;
}

function generateAudition() {
  stopPlayback();
  auditionConflict.innerHTML = "";
  const measureIndex = Number(varMeasure.value);
  const tier = varDensity.value;
  const result = LuoguVariations.generate({
    tokens,
    measure: measureSlice(measureIndex),
    locked: lockSlice(measureIndex),
    tier,
    context: `${state.pieceName}|${measureIndex}`
  });

  if (!result.ok) {
    audition = null;
    candidateStore.clear();
    renderAudition();
    showConflict(result, measureIndex);
    setStatus(reasonToText(result.reason), "error");
    return;
  }

  audition = LuoguCandidateStore.makeBatch(
    { pieceName: state.pieceName, measureIndex },
    result
  );
  candidateStore.save(audition);
  renderAudition();
  setStatus(`已生成第${measureIndex + 1}小节「${tier}」三份候选，先在试听区试听，采纳后才会替换谱面。`, "ok");
}

function adoptCandidate(candidateIndex) {
  if (!audition) return;
  const { measure } = audition;
  const start = measure * beatsPerMeasure;
  const candidate = audition.candidates[candidateIndex];
  audition.candidates[candidateIndex].forEach((row, rowIndex) => {
    row.forEach((value, col) => {
      const step = start + col;
      if (state.locks[rowIndex][step]) return; // 保留口令格不能被动
      state.pattern[rowIndex][step] = value;
    });
  });
  save();
  candidateStore.clear();
  audition = null;
  stopPlayback();
  render();
  setStatus(`已采纳候选 ${candidateIndex + 1}，仅替换第${measure + 1}小节；其余谱面与已存方案照旧。`, "ok");
}

function dismissAudition() {
  stopPlayback();
  candidateStore.clear();
  audition = null;
  auditionConflict.innerHTML = "";
  renderAudition();
  setStatus("已放弃本批候选，正式谱面未改动。", "info");
}

grid.addEventListener("click", (event) => {
  const cell = event.target.closest(".cell");
  if (!cell) return;
  const row = Number(cell.dataset.row);
  const step = Number(cell.dataset.step);

  if (lockMode) {
    if (!state.pattern[row][step]) {
      setStatus("空拍不能钉保留，请先在该格点入口令。", "error");
      return;
    }
    if (state.locks[row][step]) {
      state.locks[row][step] = false;
      setStatus(`已取消 ${instruments[row].name} ${beatLabel(step)} 的保留口令。`, "info");
    } else {
      state.locks[row][step] = true;
      setStatus(`已钉住 ${instruments[row].name} ${beatLabel(step)}「${state.pattern[row][step]}」，变奏不会动它。`, "ok");
    }
    save();
    renderGrid();
    renderSidebars();
    return;
  }

  if (state.locks[row][step]) {
    setStatus(`${beatLabel(step)}「${state.pattern[row][step]}」是保留口令，不能直接改；请先在保留模式里取消钉住。`, "error");
    return;
  }
  state.pattern[row][step] = state.pattern[row][step] ? "" : instruments[row].token;
  save();
  renderGrid();
  renderSidebars();
});

pieceName.addEventListener("input", () => {
  state.pieceName = pieceName.value;
  save();
});

bpmInput.addEventListener("input", () => {
  state.bpm = Number(bpmInput.value || 96);
  save();
  if (!timer) return;
  clearInterval(timer);
  timer = setInterval(preview.candidateIndex === null ? tick : previewTick, 60000 / state.bpm);
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
  stopPlayback();
  playhead = currentRange()[0];
  tick();
  timer = setInterval(tick, 60000 / state.bpm);
});

document.querySelector("#stopBtn").addEventListener("click", () => {
  stopPlayback();
});

document.querySelector("#saveBtn").addEventListener("click", () => {
  state.saved.unshift({
    id: LuoguCandidateStore.uid(),
    name: state.pieceName || "未命名片段",
    bpm: state.bpm,
    loop: state.loop,
    notes: [...state.notes],
    pattern: state.pattern.map((row) => [...row]),
    locks: state.locks.map((row) => [...row]),
    createdAt: new Date().toISOString()
  });
  save();
  renderSidebars();
  setStatus("方案已保存；试听区候选不属于方案，仍单独保留。", "info");
});

savedList.addEventListener("click", (event) => {
  const id = event.target.closest("[data-load]")?.dataset.load;
  const item = state.saved.find((entry) => entry.id === id);
  if (!item) return;
  stopPlayback();
  state.pieceName = item.name;
  state.bpm = item.bpm;
  state.loop = item.loop;
  state.notes = [...item.notes];
  state.pattern = item.pattern.map((row) => [...row]);
  state.locks = item.locks ? item.locks.map((row) => [...row]) : emptyLocks();
  save();
  render();
});

lockBtn.addEventListener("click", () => {
  lockMode = !lockMode;
  lockBtn.classList.toggle("active", lockMode);
  lockBtn.textContent = lockMode ? "退出保留模式" : "保留口令：关";
  lockHint.hidden = !lockMode;
});

document.querySelector("#generateBtn").addEventListener("click", generateAudition);

candidateList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const candidateIndex = Number(button.dataset.candidate);
  if (button.dataset.action === "preview") {
    if (timer && preview.candidateIndex === candidateIndex) {
      stopPlayback();
    } else {
      playCandidate(candidateIndex);
    }
  } else if (button.dataset.action === "adopt") {
    adoptCandidate(candidateIndex);
  }
});

document.querySelector("#dismissBtn").addEventListener("click", dismissAudition);

render();
