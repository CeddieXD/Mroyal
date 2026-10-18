// js/intro.js — attract-loop animation
export function playIntro(onComplete) {
    const introLayer = document.getElementById('intro');
    const frameElement = introLayer.querySelector('#frame');
    const totalFrames = 37;
    let currentFrame = 1;

    introLayer.classList.remove('hidden');

    // Any tap during intro skips to next screen
    const skip = () => {
        introLayer.removeEventListener('click', skip);
        clearInterval(interval);
        introLayer.classList.add('hidden');
        onComplete();
    };
    introLayer.addEventListener('click', skip);

    const interval = setInterval(() => {
        currentFrame++;
        if (currentFrame > totalFrames) {
            introLayer.removeEventListener('click', skip);
            clearInterval(interval);
            introLayer.classList.add('hidden');
            onComplete();
            return;
        }
        const frameNum = String(currentFrame).padStart(3, '0');
        frameElement.src = `assets/img/frames/ezgif-frame-${frameNum}.png`;
    }, 60);
}
