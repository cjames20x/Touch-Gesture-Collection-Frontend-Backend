import {} from './gesture.js';
const surface = document.getElementById('surface');
const output = document.getElementById('output');
const resetButton = document.getElementById('reset');
const instructionDisplay = document.getElementById('current-instruction');

const registerForm = document.getElementById('register-form');
const registrationSection = document.getElementById('registration');
const postRegister = document.getElementById('post-register');
const btnTraining = document.getElementById('btn-training');
const btnEval = document.getElementById('btn-eval');
const trainingSection = document.getElementById('training');
const startTrainingBtn = document.getElementById('start-training');
const stopTrainingBtn = document.getElementById('stop-training');
const trainingStatus = document.getElementById('training-status');
const evalSection = document.getElementById('eval');
const backFromEval = document.getElementById('back-from-eval');
let gesture = null;

let instructionSet = ['tap', 'swipe', 'scroll'];
let instructionIndex = 0;

let mode = 'idle';
let trainingInstructionSet = [];
let trainingStepIndex = 0;
let trainingRepsTarget = 10;
let trainingCurrentRep = 0;
let trainingRecords = [];
function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
function getCurrentInstruction() {
    if (mode === 'training' && trainingInstructionSet.length > 0) {
        const v = trainingInstructionSet[trainingStepIndex];
        if (typeof v === 'string' && v.length > 0)
            return v;
        return trainingInstructionSet[0] ?? 'tap';
    }
    const cur = instructionSet[instructionIndex];
    if (typeof cur === 'string' && cur.length > 0)
        return cur;
    return instructionSet[0] ?? 'tap';
}
function updateInstructionDisplay() {
    if (!instructionDisplay)
        return;
    if (mode === 'training') {
        instructionDisplay.textContent = `Training: ${capitalize(getCurrentInstruction())} (rep ${trainingCurrentRep + 1}/${trainingRepsTarget})`;
        if (trainingStatus)
            trainingStatus.textContent = `Step ${trainingStepIndex + 1} / ${trainingInstructionSet.length}`;
    }
    else {
        instructionDisplay.textContent = `Next: ${capitalize(getCurrentInstruction())}`;
    }
}
function reset() {
    gesture = null;
    instructionIndex = 0;
    updateInstructionDisplay();
}

document.querySelectorAll('input[name="instructions"]').forEach(r => {
    r.addEventListener('change', () => {
        const selected = document.querySelector('input[name="instructions"]:checked');
        if (!selected)
            return;
        instructionSet = selected.value.split(',').map(s => s.trim());
        instructionIndex = 0;
        updateInstructionDisplay();
    });
});

function readTrainingSelection() {
    try {
        const raw = localStorage.getItem('selectedSequence');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0)
                return parsed;
        }
    }
    catch (err) {  }
    return ['tap', 'swipe', 'scroll'];
}
updateInstructionDisplay();
function normalize(touch) {
    return {
        x: touch.clientX / window.innerWidth,
        y: touch.clientY / window.innerHeight,
    };
}
function start(e) {
    const t = e.touches[0];
    gesture = {
        type: getCurrentInstruction(),
        points: [],
    };
    add(t);
}
function move(e) {
    if (!gesture)
        return;
    add(e.touches[0]);
}
function end() {
    if (!gesture)
        return;
    const data = {
        timestamp: new Date().toISOString(),
        type: gesture.type,
        touch_position: gesture.points,
    };
    if (mode === 'training') {
        trainingRecords.push(data);

        trainingStepIndex++;
        if (trainingStepIndex >= trainingInstructionSet.length) {
            trainingStepIndex = 0;
            trainingCurrentRep++;
        }
        if (trainingCurrentRep >= trainingRepsTarget) {

            mode = 'idle';
            if (trainingStatus)
                trainingStatus.textContent = 'Training complete';
            if (stopTrainingBtn)
                stopTrainingBtn.style.display = 'none';
            if (startTrainingBtn)
                startTrainingBtn.style.display = '';

            try {
                const existingRaw = localStorage.getItem('trainingRecords');
                const existing = existingRaw ? JSON.parse(existingRaw) : [];
                existing.push({ user: JSON.parse(localStorage.getItem('user') || 'null'), records: trainingRecords });
                localStorage.setItem('trainingRecords', JSON.stringify(existing));
            }
            catch (err) {
                console.error('Failed to save training records', err);
            }
            try {
                const user = JSON.parse(localStorage.getItem('user') || 'null');
                const payload = {
                    user,
                    sequence: trainingInstructionSet,
                    records: trainingRecords,
                    meta: { completedAt: new Date().toISOString(), reps: trainingCurrentRep }
                };
                // TODO: send `payload` to your backend via fetch/POST
                console.log('Training payload to send to backend:', payload);
            }
            catch (err) {
                console.error('Failed to build training payload', err);
            }
        }
    }
    else {
        if (instructionSet.length > 0) {
            instructionIndex = (instructionIndex + 1) % instructionSet.length;
        }
        else {
            instructionIndex = 0;
        }
    }
    log(data);
    gesture = null;
    updateInstructionDisplay();
}
function add(touch) {
    if (!touch || !gesture) {
        return;
    }
    let p = normalize(touch);
    gesture.points.push({
        time: performance.now(),
        x: p.x,
        y: p.y,
        pressure: touch.force || 0,
    });
}
function log(data) {
    //console.debug('Gesture captured:', data);
}
surface?.addEventListener('touchstart', start, { passive: false });
surface?.addEventListener('touchmove', move, { passive: false });
surface?.addEventListener('touchend', end);
resetButton?.addEventListener('click', reset);
// initialize instruction radio listeners immediately in case DOM was already interactive
(function initInstructionRadios() {
    const selected = document.querySelector('input[name="instructions"]:checked');
    if (selected) {
        instructionSet = selected.value.split(',').map(s => s.trim());
        instructionIndex = 0;
        updateInstructionDisplay();
    }
})();
// Registration handling
if (registerForm) {
    registerForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const nameInput = document.getElementById('name');
        const ageInput = document.getElementById('age');
        if (!nameInput || !ageInput)
            return;
        const user = { name: nameInput.value.trim(), age: parseInt(ageInput.value, 10) };
        localStorage.setItem('user', JSON.stringify(user));
        if (registrationSection)
            registrationSection.style.display = 'none';
        if (postRegister)
            postRegister.style.display = '';
    });
}
// Post-register navigation
btnTraining?.addEventListener('click', () => {
    if (postRegister)
        postRegister.style.display = 'none';
    if (trainingSection)
        trainingSection.style.display = '';
});
btnEval?.addEventListener('click', () => {
    if (postRegister)
        postRegister.style.display = 'none';
    if (evalSection)
        evalSection.style.display = '';
});
backFromEval?.addEventListener('click', () => {
    if (evalSection)
        evalSection.style.display = 'none';
    if (postRegister)
        postRegister.style.display = '';
});
// Training flow
startTrainingBtn?.addEventListener('click', () => {
    trainingInstructionSet = readTrainingSelection();
    trainingStepIndex = 0;
    trainingCurrentRep = 0;
    trainingRecords = [];
    mode = 'training';
    if (startTrainingBtn)
        startTrainingBtn.style.display = 'none';
    if (stopTrainingBtn)
        stopTrainingBtn.style.display = '';
    updateInstructionDisplay();
});
stopTrainingBtn?.addEventListener('click', () => {
    // stop early
    mode = 'idle';
    if (trainingStatus)
        trainingStatus.textContent = 'Stopped';
    if (stopTrainingBtn)
        stopTrainingBtn.style.display = 'none';
    if (startTrainingBtn)
        startTrainingBtn.style.display = '';
    try {
        const existingRaw = localStorage.getItem('trainingRecords');
        const existing = existingRaw ? JSON.parse(existingRaw) : [];
        existing.push({ user: JSON.parse(localStorage.getItem('user') || 'null'), records: trainingRecords });
        localStorage.setItem('trainingRecords', JSON.stringify(existing));
    }
    catch (err) {
        console.error('Failed to save training records', err);
    }
    /*
    // log payload for early-stop so backend can receive partial data
    try {
        const user = JSON.parse(localStorage.getItem('user') || 'null');
        const payload = { user, sequence: trainingInstructionSet, records: trainingRecords, meta: { stoppedAt: new Date().toISOString(), reps: trainingCurrentRep } };
        // TODO: replace console.log with fetch POST to backend endpoint
        console.log('Training (stopped) payload to send to backend:', payload);
    } catch (err) {
        console.error('Failed to build training payload (stopped)', err);
    }*/
});
//# sourceMappingURL=index.js.map