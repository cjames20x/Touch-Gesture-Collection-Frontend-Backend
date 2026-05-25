const form = document.getElementById('register-form');

function selectGender(g) {
    document.getElementById('gender-male')?.classList.toggle('selected', g === 'male');
    document.getElementById('gender-female')?.classList.toggle('selected', g === 'female');
    const radio = document.getElementById(g === 'male' ? 'radio-male' : 'radio-female');
    if (radio) radio.checked = true;
}

document.getElementById('gender-male')?.addEventListener('click', () => {
    selectGender('male');
});
document.getElementById('gender-female')?.addEventListener('click', () => {
    selectGender('female');
});

if (form) {
    form.addEventListener('submit', (ev) => {
        ev.preventDefault();

        const name          = document.getElementById('name').value.trim();
        const age           = parseInt(document.getElementById('age').value, 10);
        const gender        = document.querySelector('input[name="gender"]:checked')?.value ?? '';
        const participantId = document.getElementById('participant-id').value.trim();

        if (!name || isNaN(age)) {
            alert('Please enter your name and age.');
            return;
        }
        if (!gender) {
            alert('Please select a gender.');
            return;
        }

        localStorage.setItem('user', JSON.stringify({ name, age, gender, participantId }));
        window.location.href = 'consent.html';
    });
}

export {};
//# sourceMappingURL=register.js.map