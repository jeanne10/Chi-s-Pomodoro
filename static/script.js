let appData = {
    users: [],
    sessions: [],
    todos: {},
    settings: { Focus: 25, "Short Break": 5, "Long Break": 15 }
};

let myPlayer = localStorage.getItem("pomodoro_my_player") || "";
let myToken = localStorage.getItem("pomodoro_my_token") || "";

let currentMode = "Focus";
let remainingSeconds = 25 * 60;
let timerRunning = false;
let timerInterval = null;
let cycleCount = 0;
let currentPeriod = "Today";

const modeColors = {
    "Focus": "#E06C9F",
    "Short Break": "#5C9CE6",
    "Long Break": "#5E9662"
};

function getLocalTodayStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function parseLocalDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
}

window.onload = async () => {
    renderPlayerBadge();
    renderTodos();
    await fetchAppData();
    updateDateDisplay();
    resetTimer();

    if (!myPlayer) {
        setTimeout(ensurePlayerRegistered, 300);
    }

    // Auto-refresh leaderboard and data every 15 seconds so friends see live updates
    setInterval(() => {
        if (!timerRunning) {
            fetchAppData();
        }
    }, 15000);
};

async function fetchAppData() {
    try {
        const res = await fetch('/api/data');
        appData = await res.json();
        if (!appData.todos) appData.todos = {};

        // If server wiped or player no longer exists in DB, unlock device so they can register
        if (myPlayer && Array.isArray(appData.users) && !appData.users.includes(myPlayer)) {
            myPlayer = "";
            myToken = "";
            localStorage.removeItem("pomodoro_my_player");
            localStorage.removeItem("pomodoro_my_token");
        }

        renderPlayerBadge();
        syncSettingsInputs();
        updateStats();
        renderTodos();
        if (document.getElementById('board-page').classList.contains('active')) {
            renderLeaderboard();
        }
    } catch (e) {
        console.error("Failed to fetch app data:", e);
    }
}

function renderPlayerBadge() {
    const badge = document.getElementById('player-badge');
    const label = document.getElementById('player-name-label');
    if (myPlayer) {
        label.innerText = myPlayer;
        badge.classList.add('locked');
        badge.title = "Locked to your device";
    } else {
        label.innerText = "Set your name...";
        badge.classList.remove('locked');
        badge.title = "Click to register your player name";
    }
    updateGreeting();
}

function syncSettingsInputs() {
    document.getElementById('set-focus').value = appData.settings["Focus"] || 25;
    document.getElementById('set-short').value = appData.settings["Short Break"] || 5;
    document.getElementById('set-long').value = appData.settings["Long Break"] || 15;
}

function updateDateDisplay() {
    const options = { weekday: 'long', month: 'long', day: 'numeric' };
    document.getElementById('date-label').innerText = new Date().toLocaleDateString('en-US', options);
}

function updateGreeting() {
    const hour = new Date().getHours();
    const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    document.getElementById('greeting').innerText = myPlayer ? `${part}, ${myPlayer}` : `${part}!`;
}

async function ensurePlayerRegistered() {
    if (myPlayer) return true;

    const name = prompt("Enter your player name (this locks to your device so nobody else can use your account):");
    if (!name || !name.trim()) return false;
    const cleanName = name.trim().substring(0, 20);

    const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cleanName })
    });
    const result = await res.json();

    if (!res.ok) {
        alert(result.error || "Could not register that name.");
        return false;
    }

    myPlayer = result.user;
    myToken = result.token;
    localStorage.setItem("pomodoro_my_player", myPlayer);
    localStorage.setItem("pomodoro_my_token", myToken);

    appData = result.state;
    renderPlayerBadge();
    updateStats();
    renderTodos();
    if (document.getElementById('board-page').classList.contains('active')) {
        renderLeaderboard();
    }
    return true;
}

/* ---------- TO-DO LIST FUNCTIONS ---------- */
function getCurrentTodos() {
    if (!myPlayer) return [];
    if (!appData.todos) appData.todos = {};
    if (!Array.isArray(appData.todos[myPlayer])) {
        appData.todos[myPlayer] = [];
    }
    return appData.todos[myPlayer];
}

async function syncTodos(todos) {
    if (!myPlayer) {
        const ok = await ensurePlayerRegistered();
        if (!ok) return;
    }
    if (!appData.todos) appData.todos = {};
    appData.todos[myPlayer] = todos;
    renderTodos();

    const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: myPlayer, token: myToken, todos })
    });
    if (res.ok) {
        appData = await res.json();
        renderTodos();
    }
}

function renderTodos() {
    const list = document.getElementById('todo-list');
    const countEl = document.getElementById('todo-count');
    const barEl = document.getElementById('todo-bar');
    if (!list) return;

    const todos = getCurrentTodos();
    const doneCount = todos.filter(t => t.done).length;
    const totalCount = todos.length;

    countEl.innerText = `${doneCount} of ${totalCount} done`;
    barEl.style.width = totalCount ? `${Math.round((doneCount / totalCount) * 100)}%` : '0%';

    list.innerHTML = '';
    if (!totalCount) {
        list.innerHTML = `<li class="todo-empty">No tasks yet — add what you want to focus on today.</li>`;
        return;
    }

    todos.forEach((todo, idx) => {
        const li = document.createElement('li');
        li.className = `todo-item ${todo.done ? 'done' : ''}`;

        const checkBtn = document.createElement('button');
        checkBtn.type = 'button';
        checkBtn.className = 'todo-check';
        checkBtn.innerText = todo.done ? '✓' : '';
        checkBtn.onclick = () => toggleTodo(idx);

        const span = document.createElement('span');
        span.className = 'todo-text';
        span.innerText = todo.text;
        span.onclick = () => toggleTodo(idx);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'todo-del';
        delBtn.innerHTML = '×';
        delBtn.title = 'Delete task';
        delBtn.onclick = () => deleteTodo(idx);

        li.appendChild(checkBtn);
        li.appendChild(span);
        li.appendChild(delBtn);
        list.appendChild(li);
    });
}

async function addTodo() {
    if (!myPlayer) {
        const ok = await ensurePlayerRegistered();
        if (!ok) return;
    }
    const input = document.getElementById('todo-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    const todos = [...getCurrentTodos(), { text, done: false }];
    input.value = '';
    await syncTodos(todos);
}

async function toggleTodo(idx) {
    const todos = getCurrentTodos().map((t, i) =>
        i === idx ? { ...t, done: !t.done } : t
    );
    await syncTodos(todos);
}

async function deleteTodo(idx) {
    const todos = getCurrentTodos().filter((_, i) => i !== idx);
    await syncTodos(todos);
}

async function clearCompletedTodos() {
    const todos = getCurrentTodos().filter(t => !t.done);
    await syncTodos(todos);
}

/* ---------- POMODORO TIMER FUNCTIONS ---------- */
function switchMode(mode) {
    timerRunning = false;
    clearInterval(timerInterval);
    currentMode = mode;
    const durMins = appData.settings[mode] || 25;
    remainingSeconds = durMins * 60;
    updateDisplay();
}

async function toggleTimer() {
    if (currentMode === "Focus" && !myPlayer) {
        const ok = await ensurePlayerRegistered();
        if (!ok) return;
    }
    
    if (timerRunning) {
        timerRunning = false;
        clearInterval(timerInterval);
    } else {
        timerRunning = true;
        const startTime = Date.now();
        const startRemaining = remainingSeconds;
        timerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            remainingSeconds = startRemaining - elapsed;
            if (remainingSeconds <= 0) {
                remainingSeconds = 0;
                clearInterval(timerInterval);
                timerRunning = false;
                onTimerComplete();
            }
            updateDisplay();
        }, 200);
    }
    updateDisplay();
}

function resetTimer() {
    timerRunning = false;
    clearInterval(timerInterval);
    const durMins = appData.settings[currentMode] || 25;
    remainingSeconds = durMins * 60;
    updateDisplay();
}

function skipTimer() {
    timerRunning = false;
    clearInterval(timerInterval);
    advancePhase(false);
}

async function onTimerComplete() {
    playBeep();
    if (currentMode === "Focus" && myPlayer) {
        const durMins = appData.settings["Focus"];
        const res = await fetch('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user: myPlayer,
                token: myToken,
                minutes: durMins,
                pomodoros: 1
            })
        });
        if (res.ok) {
            appData = await res.json();
            updateStats();
        }
    }
    advancePhase(true);
}

function advancePhase(counted) {
    if (currentMode === "Focus") {
        if (counted) cycleCount++;
        currentMode = (counted && cycleCount % 4 === 0) ? "Long Break" : "Short Break";
    } else {
        currentMode = "Focus";
    }
    remainingSeconds = (appData.settings[currentMode] || 25) * 60;
    updateDisplay();
}

function updateDisplay() {
    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    document.getElementById('time-display').innerText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    document.getElementById('mode-title').innerText = currentMode.toLowerCase();
    
    const total = (appData.settings[currentMode] || 25) * 60;
    const progress = document.getElementById('progress-ring');
    const offset = 360 - (360 * ((total - remainingSeconds) / total));
    progress.style.strokeDashoffset = offset;
    progress.style.stroke = modeColors[currentMode];

    document.getElementById('start-btn').innerText = timerRunning ? "Pause" : "Start";

    const dots = document.querySelectorAll('.dot');
    dots.forEach((dot, idx) => {
        if (idx < (cycleCount % 4)) {
            dot.classList.add('active');
        } else {
            dot.classList.remove('active');
        }
    });
}

async function updateDurations() {
    const focus = parseInt(document.getElementById('set-focus').value) || 25;
    const shortB = parseInt(document.getElementById('set-short').value) || 5;
    const longB = parseInt(document.getElementById('set-long').value) || 15;

    appData.settings = { "Focus": focus, "Short Break": shortB, "Long Break": longB };
    await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: appData.settings })
    });

    if (!timerRunning) {
        remainingSeconds = appData.settings[currentMode] * 60;
        updateDisplay();
    }
}

function updateStats() {
    const today = getLocalTodayStr();
    const mine = appData.sessions.filter(s => s.user === myPlayer && s.date === today);
    
    const totalPomos = mine.reduce((acc, s) => acc + (s.pomodoros || 1), 0);
    const totalMins = mine.reduce((acc, s) => acc + s.minutes, 0);

    document.getElementById('stat-pomos').innerText = totalPomos;
    document.getElementById('stat-minutes').innerText = totalMins >= 60 ? `${Math.floor(totalMins/60)}h ${totalMins%60}m` : `${totalMins}m`;
}

function showPage(pageName) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.dock-tab').forEach(t => t.classList.remove('active'));

    if (pageName === 'timer') {
        document.getElementById('timer-page').classList.add('active');
        document.getElementById('nav-timer').classList.add('active');
    } else {
        document.getElementById('board-page').classList.add('active');
        document.getElementById('nav-board').classList.add('active');
        fetchAppData();
        renderLeaderboard();
    }
}

function setPeriod(period) {
    currentPeriod = period;
    document.querySelectorAll('.period-pill').forEach(p => {
        p.classList.toggle('active', p.innerText === period);
    });
    renderLeaderboard();
}

function renderPlayersRoster() {
    const rosterEl = document.getElementById('players-roster');
    const countEl = document.getElementById('player-count-badge');
    if (!rosterEl || !countEl) return;

    const users = Array.isArray(appData.users) ? appData.users : [];
    countEl.innerText = `${users.length} player${users.length !== 1 ? 's' : ''}`;
    rosterEl.innerHTML = '';

    if (!users.length) {
        rosterEl.innerHTML = `<span class="roster-empty">No players joined yet.</span>`;
        return;
    }

    users.forEach(name => {
        const chip = document.createElement('span');
        const isMe = name === myPlayer;
        chip.className = `player-chip ${isMe ? 'is-me' : ''}`;

        const dot = document.createElement('span');
        dot.className = 'player-chip-dot';

        const label = document.createElement('span');
        label.innerText = isMe ? `${name} (You)` : name;

        chip.appendChild(dot);
        chip.appendChild(label);
        rosterEl.appendChild(chip);
    });
}

function renderLeaderboard() {
    renderPlayersRoster();

    const list = document.getElementById('leaderboard-list');
    list.innerHTML = '';

    const today = new Date();
    const todayStr = getLocalTodayStr();
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    monday.setDate(today.getDate() - (today.getDay() === 0 ? 6 : today.getDay() - 1));

    const totals = {};
    appData.users.forEach(u => totals[u] = { pomos: 0, mins: 0 });

    appData.sessions.forEach(s => {
        if (!totals[s.user]) totals[s.user] = { pomos: 0, mins: 0 };
        const sDate = parseLocalDate(s.date);
        
        if (currentPeriod === "Today") {
            if (s.date === todayStr) {
                totals[s.user].pomos += (s.pomodoros || 1);
                totals[s.user].mins += s.minutes;
            }
        } else if (currentPeriod === "This week") {
            if (sDate >= monday) {
                totals[s.user].pomos += (s.pomodoros || 1);
                totals[s.user].mins += s.minutes;
            }
        } else {
            totals[s.user].pomos += (s.pomodoros || 1);
            totals[s.user].mins += s.minutes;
        }
    });

    const ranked = Object.entries(totals).sort((a, b) => b[1].mins - a[1].mins || b[1].pomos - a[1].pomos || a[0].localeCompare(b[0]));

    if (!ranked.length) {
        list.innerHTML = `<div style="text-align:center; padding:48px 20px; color:var(--muted); font-family: Georgia, serif; font-style: italic; font-size: 18px;">No players registered yet.</div>`;
        return;
    }

    ranked.forEach(([name, data], idx) => {
        const item = document.createElement('div');
        item.className = `rank-card ${idx < 3 && data.mins > 0 ? 'podium-' + idx : ''}`;
        
        const timeStr = data.mins >= 60 ? `${Math.floor(data.mins/60)}h ${String(data.mins%60).padStart(2, '0')}m` : `${data.mins}m`;
        const displayName = name === myPlayer ? `${name} (You)` : name;

        item.innerHTML = `
            <div class="rank-info">
                <div class="rank-badge">${idx + 1}</div>
                <div>
                    <span class="rank-name">${displayName}</span>
                    <span class="rank-details">${data.pomos} pomodoro${data.pomos !== 1 ? 's' : ''}</span>
                </div>
            </div>
            <div class="rank-score">${timeStr}</div>
        `;
        list.appendChild(item);
    });
}

function playBeep() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
        console.log("Audio not supported");
    }
}
