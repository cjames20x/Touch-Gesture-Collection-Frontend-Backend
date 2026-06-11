const saveBtn = document.getElementById('save-seq');
saveBtn.addEventListener('click', () => {
    const checked = document.querySelector('input[name="seq"]:checked');
    if (!checked) {
        alert('Please select a sequence first.');
        return;
    }
    // e.g. "tap,swipe,scroll"
    localStorage.setItem('sequence', checked.value);
    // Carry the session param forward if it's in the URL
    const session = new URLSearchParams(window.location.search).get('session') ?? '1';
    window.location.href = `training.html?session=${session}`;
});
export {};
//# sourceMappingURL=sequence.js.map