let progressInterval = null;
let currentDuration = 0;
let startTime = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'showProgress') {
    showProgressBar(message.duration, message.remaining);
    sendResponse({ status: 'ok' });
  } 
  else if (message.action === 'updateProgress') {
    updateProgressBar(message.remaining);
    sendResponse({ status: 'ok' });
  }
  else if (message.action === 'hideProgress') {
    hideProgressBar();
    sendResponse({ status: 'ok' });
  }
  else if (message.action === 'showNextPreview') {
    showNextPreview(message.nextUrl, message.nextDuration, message.screenshot, message.isFirstRound);
    sendResponse({ status: 'ok' });
  }
  else if (message.action === 'updateNextPreview') {
    updateNextPreview(message.screenshot);
    sendResponse({ status: 'ok' });
  }
  else if (message.action === 'updateNextPreviewForUrl') {
    updateNextPreviewForUrl(message.url, message.screenshot);
    sendResponse({ status: 'ok' });
  }
  else if (message.action === 'hideNextPreview') {
    hideNextPreview();
    sendResponse({ status: 'ok' });
  }
});

function showProgressBar(duration, remaining = duration) {
  hideProgressBar();
  
  currentDuration = duration;
  startTime = Date.now() - ((duration - remaining) * 1000);
  
  const container = document.createElement('div');
  container.id = 'tab-rotate-progress-container';
  const bar = document.createElement('div');
  bar.id = 'tab-rotate-progress-bar';
  const timeText = document.createElement('div');
  timeText.id = 'tab-rotate-time-text';
  
  container.appendChild(bar);
  document.body.appendChild(container);
  document.body.appendChild(timeText);
  
  updateProgressBar(remaining);
  
  progressInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    const remainingTime = Math.max(0, currentDuration - elapsed);
    updateProgressBar(remainingTime);
    
    if (remainingTime <= 0) {
      hideProgressBar();
    }
  }, 100);
}

function updateProgressBar(remainingSeconds) {
  const bar = document.getElementById('tab-rotate-progress-bar');
  const timeText = document.getElementById('tab-rotate-time-text');
  
  if (!bar) return;
  
  const percent = remainingSeconds / currentDuration;
  bar.style.transform = `scaleX(${percent})`;
  
  if (remainingSeconds <= 10) {
    bar.style.background = 'linear-gradient(90deg, #FF6600, #FF3300, #FF0000)';
    bar.style.boxShadow = '0 0 8px rgba(255, 50, 0, 0.6)';
    bar.style.animation = 'fireGlow 0.15s ease-in-out infinite alternate';
  } else {
    bar.style.background = 'linear-gradient(90deg, #4CAF50, #2196F3)';
    bar.style.boxShadow = 'none';
    bar.style.animation = 'none';
  }
  
  if (timeText) {
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = Math.floor(remainingSeconds % 60);
    let timeStr = '';
    
    if (minutes > 0) {
      timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    } else {
      timeStr = `${seconds} sec`;
    }
    
    timeText.textContent = `⏱ ${timeStr}`;
    
    if (remainingSeconds <= 10) {
      timeText.style.backgroundColor = 'rgba(244, 67, 54, 0.9)';
      timeText.style.animation = 'blink 0.5s ease-in-out infinite';
      timeText.style.boxShadow = '0 0 12px rgba(244, 67, 54, 0.5)';
    } else {
      timeText.style.backgroundColor = 'rgba(0, 0, 0, 0.75)';
      timeText.style.animation = 'none';
      timeText.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.2)';
    }
    
    if (remainingSeconds <= 5) {
      timeText.style.backgroundColor = 'rgba(255, 0, 0, 1)';
      timeText.style.animation = 'blink 0.2s ease-in-out infinite';
      timeText.style.transform = 'scale(1.05)';
      timeText.style.boxShadow = '0 0 20px rgba(255, 0, 0, 0.8)';
    } else {
      timeText.style.transform = 'scale(1)';
    }
  }
}

function showNextPreview(nextUrl, nextDuration, screenshot, isFirstRound) {
  hideNextPreview();
  
  const preview = document.createElement('div');
  preview.id = 'tab-rotate-next-preview';
  preview.setAttribute('data-url', nextUrl);
  
  let imageContent = '';
  
  if (screenshot) {
    imageContent = `<img src="${screenshot}" alt="Next Tab Preview">`;
  } else if (isFirstRound) {
    imageContent = `
      <div class="next-preview-loading">
        <div class="loading-spinner"></div>
        <span>Loading...</span>
      </div>
    `;
  } else {
    imageContent = `
      <div class="next-preview-loading">
        <div class="loading-spinner"></div>
        <span>Loading...</span>
      </div>
    `;
  }
  
  preview.innerHTML = `
    <div class="next-preview-container">
      <div class="next-preview-image">
        ${imageContent}
        <div class="next-preview-overlay"></div>
      </div>
      <div class="next-preview-label">NEXT</div>
    </div>
  `;
  
  document.body.appendChild(preview);
  
  setTimeout(() => {
    preview.classList.add('visible');
  }, 10);
}

function updateNextPreview(screenshot) {
  const preview = document.getElementById('tab-rotate-next-preview');
  if (!preview) return;
  
  const imageContainer = preview.querySelector('.next-preview-image');
  if (imageContainer && screenshot) {
    imageContainer.innerHTML = `
      <img src="${screenshot}" alt="Next Tab Preview">
      <div class="next-preview-overlay"></div>
    `;
  }
}

function updateNextPreviewForUrl(url, screenshot) {
  const preview = document.getElementById('tab-rotate-next-preview');
  if (!preview) return;
  
  const previewUrl = preview.getAttribute('data-url');
  if (previewUrl === url && screenshot) {
    const imageContainer = preview.querySelector('.next-preview-image');
    if (imageContainer) {
      imageContainer.innerHTML = `
        <img src="${screenshot}" alt="Next Tab Preview">
        <div class="next-preview-overlay"></div>
      `;
    }
  }
}

function hideNextPreview() {
  const preview = document.getElementById('tab-rotate-next-preview');
  if (preview) {
    preview.classList.remove('visible');
    setTimeout(() => {
      if (preview.parentNode) preview.remove();
    }, 300);
  }
}

function hideProgressBar() {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
  const container = document.getElementById('tab-rotate-progress-container');
  const timeText = document.getElementById('tab-rotate-time-text');
  if (container) container.remove();
  if (timeText) timeText.remove();
}

const style = document.createElement('style');
style.textContent = `
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
  
  @keyframes fireGlow {
    0% { filter: brightness(1); }
    100% { filter: brightness(1.2) drop-shadow(0 0 4px orange); }
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  #tab-rotate-next-preview {
    position: fixed;
    bottom: 30px;
    right: 20px;
    z-index: 999998;
    opacity: 0;
    transform: translateX(50px);
    transition: all 0.3s ease-out;
  }
  
  #tab-rotate-next-preview.visible {
    opacity: 1;
    transform: translateX(0);
  }
  
  .next-preview-container {
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(10px);
    border-radius: 20px;
    padding: 14px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.2);
    text-align: center;
    min-width: 160px;
  }
  
  .next-preview-image {
    width: 150px;
    height: 100px;
    border-radius: 12px;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.5);
    position: relative;
  }
  
  .next-preview-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  
  .next-preview-loading {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: white;
    font-size: 12px;
  }
  
  .loading-spinner {
    width: 30px;
    height: 30px;
    border: 3px solid rgba(255, 255, 255, 0.3);
    border-top-color: #4CAF50;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  
  .next-preview-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, rgba(33, 150, 243, 0.3), rgba(76, 175, 80, 0.3));
    pointer-events: none;
  }
  
  .next-preview-label {
    margin-top: 10px;
    font-size: 14px;
    font-weight: bold;
    color: white;
    text-shadow: 0 1px 2px black;
    letter-spacing: 1px;
    background: linear-gradient(90deg, #4CAF50, #2196F3);
    padding: 6px 18px;
    border-radius: 25px;
    display: inline-block;
    font-family: monospace;
  }
`;
document.head.appendChild(style);