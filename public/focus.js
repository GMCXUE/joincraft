// Text fields keep their resting appearance for pointer and automatic focus.
// Browsers consider text inputs :focus-visible even after a mouse click, so
// keyboard navigation is tracked explicitly instead of relying on that alone.
const root=document.documentElement;
root.dataset.focusMode='pointer';
document.addEventListener('pointerdown',()=>{root.dataset.focusMode='pointer';},true);
document.addEventListener('keydown',event=>{if(event.key==='Tab')root.dataset.focusMode='keyboard';},true);
