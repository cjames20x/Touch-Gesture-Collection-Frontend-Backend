// ── Init (deferred so all DOM elements exist before we query them) ─────────────
document.addEventListener('DOMContentLoaded', () => {
  const form      = document.getElementById('register-form')  as HTMLFormElement | null;

  // FIX: log clearly if the form element is missing so HTML ID mismatches surface immediately
  if (!form) {
    console.error('[register] #register-form not found — check your HTML id attribute.');
    return;
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();

    const nameEl   = document.getElementById('name')           as HTMLInputElement | null;
    const pidEl    = document.getElementById('participant-id') as HTMLInputElement | null;

    const name          = nameEl?.value.trim()  ?? '';
    // participantId is optional — derive from name when left blank
    const rawPid        = pidEl?.value.trim()   ?? '';
    const participantId = rawPid || name.replace(/\s+/g, '_').toLowerCase();

    if (!name) {
      alert('Please enter your name.');
      return;
    }

    localStorage.setItem('user', JSON.stringify({ name, participantId }));
    window.location.href = './consent.html';
  });
});