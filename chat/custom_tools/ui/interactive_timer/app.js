AdaSkill.init();

let timers = [];
let intervalId = null;

function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    const m = Math.floor(s / 60);
    const remS = s % 60;
    return `${m.toString().padStart(2, '0')}:${remS.toString().padStart(2, '0')}`;
}

function render() {
    const listEl = document.getElementById('timers-list');
    listEl.innerHTML = '';
    
    timers.forEach(timer => {
        const el = document.createElement('div');
        el.className = `timer-card ${timer.state}`;
        
        let displayTime = timer.remaining;
        if (timer.state === 'running') {
            const now = Date.now() / 1000;
            const elapsed = now - timer.last_updated;
            displayTime = Math.max(0, timer.remaining - elapsed);
        }
        
        el.innerHTML = `
            <div class="timer-info">
                <div class="timer-label">${timer.label}</div>
                <div class="timer-time">${formatTime(displayTime)}</div>
                <div class="timer-state">${timer.state}</div>
            </div>
            <div class="timer-controls">
                ${(timer.state === 'stopped' || timer.state === 'paused') ? `<button onclick="onStart('${timer.id}')">Start</button>` : ''}
                ${timer.state === 'running' ? `<button onclick="onPause('${timer.id}')">Pause</button>` : ''}
                <button onclick="onReset('${timer.id}')">Reset</button>
                <button class="delete-btn" onclick="onDelete('${timer.id}')">Delete</button>
            </div>
        `;
        listEl.appendChild(el);
    });
}

function updateCountdowns() {
    let needsRender = false;
    timers.forEach(timer => {
        if (timer.state === 'running') {
            needsRender = true;
            const now = Date.now() / 1000;
            const elapsed = now - timer.last_updated;
            if (timer.remaining - elapsed <= 0) {
                timer.state = 'finished';
                timer.remaining = 0;
                timer.last_updated = now;
            }
        }
    });
    if (needsRender) {
        render();
    }
}

async function refresh() {
    const data = await AdaSkill.getData();
    timers = data.records || [];
    render();
    
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(updateCountdowns, 100);
}

async function onCreate() {
    const label = document.getElementById('label-input').value;
    const duration = parseInt(document.getElementById('duration-input').value, 10);
    if (!label || isNaN(duration) || duration <= 0) {
        alert("Please enter a valid label and duration in seconds.");
        return;
    }
    document.getElementById('label-input').value = '';
    document.getElementById('duration-input').value = '';
    await AdaSkill.call('create_timer', { label, duration });
    await refresh();
}

window.onStart = async function(id) {
    await AdaSkill.call('start_timer', { timer_id: id });
    await refresh();
};

window.onPause = async function(id) {
    await AdaSkill.call('pause_timer', { timer_id: id });
    await refresh();
};

window.onReset = async function(id) {
    await AdaSkill.call('reset_timer', { timer_id: id });
    await refresh();
};

window.onDelete = async function(id) {
    await AdaSkill.call('delete_timer', { timer_id: id });
    await refresh();
};

document.getElementById('create-btn').addEventListener('click', onCreate);
AdaSkill.onDataChanged(refresh);
AdaSkill.loadActionsFromTools().finally(refresh);
