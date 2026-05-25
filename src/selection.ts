const info       = document.getElementById('user-info');
const toTraining = document.getElementById('to-training');
const toEval     = document.getElementById('to-eval');

function getSelectedSession(): string | null {
    return (document.querySelector('input[name="session"]:checked') as HTMLInputElement | null)?.value ?? null;
}

function renderUser() {
    try {
        const raw = localStorage.getItem('user');
        if (!raw) {
            if (info) info.textContent = 'No user found. Please register first.';
            return;
        }
        const user = JSON.parse(raw) as { name: string; age: number; gender: string; participantId: string };
        if (info) info.innerHTML = `<p><strong>${user.name}</strong> — ${user.age} years old (${user.gender})</p>`;
    } catch {
        if (info) info.textContent = 'Error reading user info.';
    }
}

toTraining?.addEventListener('click', () => {
    const session = getSelectedSession();
    if (!session) {
        alert('Please select a session.');
        return;
    }
    localStorage.setItem('session', session);
    window.location.href = 'sequence.html';
});

toEval?.addEventListener('click', () => {
    const session = getSelectedSession();
    if (!session) {
        alert('Please select a session.');
        return;
    }
    localStorage.setItem('session', session);
    window.location.href = 'eval.html';
});

function selectSession(n: number) {
    [1, 2, 3].forEach(i => {
        const el = document.getElementById('session' + i);
        if (el) {
            el.classList.toggle('selected', i === n);
            const input = el.querySelector('input[name="session"]') as HTMLInputElement | null;
            if (input) input.checked = (i === n);
        }
    });
}

(window as any).selectSession = selectSession;

renderUser();