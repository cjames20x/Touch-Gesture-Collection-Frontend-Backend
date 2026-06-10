const info = document.getElementById('user-info');
const toEval = document.getElementById('to-eval');

function getSelectedSession() {
    return document.querySelector('input[name="session"]:checked')?.value ?? null;
}

function renderUser() {
    try {
        const raw = localStorage.getItem('user');
        if (!raw) {
            if (info)
                info.textContent = 'No user found. Please register first.';
            return;
        }
        const user = JSON.parse(raw);
        if (info)
            info.innerHTML = `<p><strong>${user.name}</strong> — ${user.age} years old (${user.gender})</p>`;
    }
    catch {
        if (info)
            info.textContent = 'Error reading user info.';
    }
}

toEval?.addEventListener('click', () => {
    const session = getSelectedSession();
    if (!session) {
        alert('Please select a session.');
        return;
    }
    
    const sessionMap = {
        '1': 'training',
        '3': 'authentication'
    };
    
    const mode = sessionMap[session];
    localStorage.setItem('session', session);
    window.location.href = `eval.html?mode=${mode}`;
});

function selectSession(n) {
    [1, 3].forEach(i => {
        const el = document.getElementById('sess' + i);
        el?.classList.toggle('selected', i === n);
        const input = el?.querySelector('input');
        if (input)
            input.checked = (i === n);
    });
}

window.selectSession = selectSession;
renderUser();
export {};