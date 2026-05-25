// ── Helpers ───────────────────────────────────────────────────────────────────
function selectGender(g: string): void {
  document.getElementById('gender-male')?.classList.toggle('selected', g === 'male');
  document.getElementById('gender-female')?.classList.toggle('selected', g === 'female');
  const radio = document.querySelector(
    `input[name="gender"][value="${g}"]`
  ) as HTMLInputElement | null;
  if (radio) radio.checked = true;
}

// ── Init (deferred so all DOM elements exist before we query them) ─────────────
document.addEventListener('DOMContentLoaded', () => {
  const form      = document.getElementById('register-form')  as HTMLFormElement | null;
  const maleBtn   = document.getElementById('gender-male');
  const femaleBtn = document.getElementById('gender-female');

  // FIX: log clearly if the form element is missing so HTML ID mismatches surface immediately
  if (!form) {
    console.error('[register] #register-form not found — check your HTML id attribute.');
    return;
  }

  maleBtn?.addEventListener('click',   () => selectGender('male'));
  femaleBtn?.addEventListener('click', () => selectGender('female'));

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();

    const nameEl   = document.getElementById('name')           as HTMLInputElement | null;
    const ageEl    = document.getElementById('age')            as HTMLInputElement | null;
    const pidEl    = document.getElementById('participant-id') as HTMLInputElement | null;
    const genderEl = document.querySelector(
      'input[name="gender"]:checked'
    ) as HTMLInputElement | null;

    const name          = nameEl?.value.trim()  ?? '';
    const age           = parseInt(ageEl?.value ?? '', 10);
    const gender        = genderEl?.value       ?? '';
    // participantId is optional — derive from name when left blank
    const rawPid        = pidEl?.value.trim()   ?? '';
    const participantId = rawPid || name.replace(/\s+/g, '_').toLowerCase();

    if (!name || isNaN(age)) {
      alert('Please enter your name and age.');
      return;
    }
    if (!gender) {
      alert('Please select a gender.');
      return;
    }

    localStorage.setItem('user', JSON.stringify({ name, age, gender, participantId }));
    window.location.href = './consent.html';
  });
});