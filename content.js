// content.js - نوار پیشرفت با حرکت از راست به چپ
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
  
  // محاسبه درصد (از راست به چپ)
  const percent = remainingSeconds / currentDuration;
  bar.style.transform = `scaleX(${percent})`;
  
  if (timeText) {
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = Math.floor(remainingSeconds % 60);
    let timeStr = '';
    
    if (minutes > 0) {
      timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    } else {
      timeStr = `${seconds} ثانیه`;
    }
    
    timeText.textContent = `⏱ ${timeStr}`;
    
    // تغییر رنگ در 5 ثانیه آخر
    if (remainingSeconds <= 5) {
      timeText.style.backgroundColor = 'rgba(244, 67, 54, 0.9)';
      timeText.style.animation = 'blink 0.5s ease-in-out infinite';
    } else {
      timeText.style.backgroundColor = 'rgba(0, 0, 0, 0.75)';
      timeText.style.animation = 'none';
    }
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

// اضافه کردن انیمیشن blink به صفحه
const style = document.createElement('style');
style.textContent = `
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
`;
document.head.appendChild(style);