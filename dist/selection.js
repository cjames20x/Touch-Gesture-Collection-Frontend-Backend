const info = document.getElementById('user-info');
const continueBtn = document.getElementById('to-eval');
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
continueBtn?.addEventListener('click', () => {
    const session = getSelectedSession();
    if (!session) {
        alert('Please select a session.');
        return;
    }
    localStorage.setItem('session', session);
    if (session === '1') {
        window.location.href = 'training.html?session=1';
    }
    else {
        window.location.href = 'eval.html?mode=authentication&session=3';
    }
});
function attachSessionCardListeners() {
    document.querySelectorAll('.session-card').forEach(card => {
        card.addEventListener('click', function () {
            document.querySelectorAll('.session-card').forEach(c => c.classList.remove('selected'));
            this.classList.add('selected');
            const input = this.querySelector('input[name="session"]');
            if (input)
                input.checked = true;
        });
    });
}
function selectSession(n) {
    [1, 3].forEach(i => {
        const el = document.getElementById('sess' + i);
        if (el) {
            el.classList.toggle('selected', i === n);
            const input = el.querySelector('input[name="session"]');
            if (input)
                input.checked = (i === n);
        }
    });
}
window.selectSession = selectSession;
attachSessionCardListeners();
renderUser();
export {};
//# sourceMappingURL=selection.js.map