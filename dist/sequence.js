const saveBtn = document.getElementById('save-seq');
function getSelected() {
    const sel = document.querySelector('input[name="seq"]:checked');
    return sel ? sel.value.split(',').map(s => s.trim()) : ['tap', 'swipe', 'scroll'];
}
saveBtn?.addEventListener('click', () => {
    const seq = getSelected();
    localStorage.setItem('selectedSequence', JSON.stringify(seq));
    // navigate to training page
    window.location.href = 'training.html';
});
export {};
//# sourceMappingURL=sequence.js.map