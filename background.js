let config = null;
let currentTabIndex = 0;
let rotationInterval = null;
let reloadIntervals = {};
let isRotating = false;
let tabIds = [];
let configCheckInterval = null;
let progressUpdater = null;
let screenshotCache = {};
let isFirstRound = true;

function keepAlive() {
  setInterval(() => {
    if (isRotating) {
      chrome.runtime.getPlatformInfo(() => {});
    }
  }, 20000);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "openOptions",
    title: "Open Tab Rotate Options",
    contexts: ["action"]
  });
});

chrome.action.onClicked.addListener(() => {
  if (isRotating) {
    stopRotation();
    chrome.action.setIcon({ path: 'icon.png' });
    isRotating = false;
    chrome.storage.local.set({ isRotating: false, currentTabIndex: 0 });
  } else {
    chrome.storage.local.get(['configUrl'], (result) => {
      if (result.configUrl) {
        fetchConfigAndStart(result.configUrl, () => {
          chrome.action.setIcon({ path: 'icon-active.png' });
          isRotating = true;
          chrome.storage.local.set({ isRotating: true });
          keepAlive();
        });
      } else {
        console.error('No config URL set');
      }
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startRotation') {
    chrome.storage.local.get(['configUrl'], (result) => {
      if (!result.configUrl) {
        sendResponse({ status: 'error', error: 'No config URL set' });
        return;
      }
      fetchConfigAndStart(result.configUrl, sendResponse);
      chrome.action.setIcon({ path: 'icon-active.png' });
      isRotating = true;
      chrome.storage.local.set({ isRotating: true });
      keepAlive();
    });
    return true;
  } else if (message.action === 'stopRotation') {
    stopRotation();
    chrome.action.setIcon({ path: 'icon.png' });
    isRotating = false;
    chrome.storage.local.set({ isRotating: false, currentTabIndex: 0 });
    sendResponse({ status: 'stopped' });
  }
});

async function fetchConfigAndStart(configUrl, sendResponse) {
  try {
    const response = await fetch(configUrl);
    const newConfig = await response.json();
    if (!validateConfig(newConfig)) {
      sendResponse({ status: 'error', error: 'Invalid config format' });
      return;
    }

    const configChanged = JSON.stringify(config) !== JSON.stringify(newConfig);
    
    if (configChanged) {
      screenshotCache = {};
      isFirstRound = true;
      console.log('Config changed, cache cleared, starting fresh round');
    }
    
    config = newConfig;

    if (configChanged || !isRotating) {
      if (config.closeExistingTabs) {
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(tab => chrome.tabs.remove(tab.id));
        });
      }
      if (config.autoStart || isRotating) {
        startRotation();
      }
    }

    sendResponse({ status: 'started' });
  } catch (err) {
    sendResponse({ status: 'error', error: err.message });
  }
}

function validateConfig(config) {
  return config && config.websites && Array.isArray(config.websites) &&
    config.websites.every(site => 
      site.url && typeof site.url === 'string' &&
      site.duration && typeof site.duration === 'number' &&
      site.tabReloadIntervalSeconds && typeof site.tabReloadIntervalSeconds === 'number'
    );
}

function startRotation() {
  if (!config || !config.websites.length) return;

  chrome.storage.local.get(['currentTabIndex'], (result) => {
    if (result.currentTabIndex) {
      currentTabIndex = result.currentTabIndex;
    }

    tabIds = [];
    let tabsCreated = 0;

    config.websites.forEach((site, index) => {
      chrome.tabs.create({ url: site.url, active: index === currentTabIndex }, (tab) => {
        tabIds[index] = tab.id;
        if (!config.lazyLoadTabs) {
          setupReloadInterval(tab.id, site.tabReloadIntervalSeconds);
        }
        tabsCreated++;
        
        if (tabsCreated === config.websites.length) {
          setTimeout(() => {
            if (isRotating) {
              scheduleNextRotation();
            }
          }, 1000);
        }
      });
    });

    if (!configCheckInterval) {
      configCheckInterval = setInterval(checkConfigChanges, 60000);
    }
  });
}

// ========================================
// === گرفتن اسکرین‌شات از تب فعلی (بدون جابجایی) ===
// ========================================
async function captureCurrentTabScreenshot(tabId, url) {
  if (screenshotCache[url]) {
    return screenshotCache[url];
  }
  
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.windowId) return null;
    
    //直接从当前标签页截图，不需要切换
    const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 50
    });
    
    screenshotCache[url] = screenshot;
    console.log(`Captured screenshot for current tab: ${url.substring(0, 50)}`);
    
    // به تمام تب‌های دیگه اطلاع بده که اسکرین‌شات این تب آپدیت شده
    for (let i = 0; i < tabIds.length; i++) {
      const otherTabId = tabIds[i];
      if (otherTabId && otherTabId !== tabId) {
        sendProgressToTab(otherTabId, 'updateNextPreviewForUrl', {
          url: url,
          screenshot: screenshot
        });
      }
    }
    
    return screenshot;
  } catch (err) {
    console.log(`Failed to capture screenshot for: ${url.substring(0, 50)}`);
    return null;
  }
}

// ========================================
// === در دور اول، از تب فعلی اسکرین‌شات بگیر ===
// ========================================
async function captureScreenshotForCurrentTab() {
  const currentSite = config.websites[currentTabIndex];
  const currentTabId = tabIds[currentTabIndex];
  
  if (!screenshotCache[currentSite.url] && isFirstRound && currentTabId) {
    console.log(`First round: capturing screenshot for current tab: ${currentSite.url.substring(0, 50)}`);
    await captureCurrentTabScreenshot(currentTabId, currentSite.url);
  }
}

function rotateTabs() {
  if (!config || !config.websites.length || !isRotating) return;

  const oldTabId = tabIds[currentTabIndex];
  if (oldTabId) {
    sendProgressToTab(oldTabId, 'hideProgress');
    sendProgressToTab(oldTabId, 'hideNextPreview');
  }

  currentTabIndex = (currentTabIndex + 1) % config.websites.length;
  chrome.storage.local.set({ currentTabIndex: currentTabIndex });
  console.log(`Switching to tab ${currentTabIndex}: ${config.websites[currentTabIndex].url}`);

  const tabId = tabIds[currentTabIndex];
  
  if (currentTabIndex === 0 && isFirstRound) {
    console.log('=== FIRST ROUND COMPLETED ===');
    isFirstRound = false;
  }

  if (tabId) {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        chrome.tabs.create({ url: config.websites[currentTabIndex].url, active: true }, (newTab) => {
          tabIds[currentTabIndex] = newTab.id;
          if (!config.lazyLoadTabs) {
            setupReloadInterval(newTab.id, config.websites[currentTabIndex].tabReloadIntervalSeconds);
          }
          setTimeout(() => {
            if (isRotating) {
              scheduleNextRotation();
            }
          }, 500);
        });
      } else {
        chrome.tabs.update(tabId, { active: true }, () => {
          if (chrome.runtime.lastError) {
            console.error('Error activating tab:', chrome.runtime.lastError.message);
            chrome.tabs.create({ url: config.websites[currentTabIndex].url, active: true }, (newTab) => {
              tabIds[currentTabIndex] = newTab.id;
              if (!config.lazyLoadTabs) {
                setupReloadInterval(newTab.id, config.websites[currentTabIndex].tabReloadIntervalSeconds);
              }
              setTimeout(() => {
                if (isRotating) scheduleNextRotation();
              }, 500);
            });
          } else {
            scheduleNextRotation();
          }
        });
      }
    });
  } else {
    chrome.tabs.create({ url: config.websites[currentTabIndex].url, active: true }, (newTab) => {
      tabIds[currentTabIndex] = newTab.id;
      if (!config.lazyLoadTabs) {
        setupReloadInterval(newTab.id, config.websites[currentTabIndex].tabReloadIntervalSeconds);
      }
      setTimeout(() => {
        if (isRotating) scheduleNextRotation();
      }, 500);
    });
  }
}

function scheduleNextRotation() {
  if (rotationInterval) {
    clearTimeout(rotationInterval);
  }
  if (progressUpdater) {
    clearInterval(progressUpdater);
    progressUpdater = null;
  }
  
  if (!isRotating) return;
  
  const currentSite = config.websites[currentTabIndex];
  const currentTabId = tabIds[currentTabIndex];
  const duration = currentSite.duration;
  
  if (currentTabId) {
    chrome.tabs.get(currentTabId, (tab) => {
      if (!chrome.runtime.lastError && tab && tab.active) {
        sendProgressToTab(currentTabId, 'showProgress', {
          duration: duration,
          remaining: duration
        });
        
        const nextIndex = (currentTabIndex + 1) % config.websites.length;
        const nextSite = config.websites[nextIndex];
        
        if (nextSite) {
          const cachedScreenshot = screenshotCache[nextSite.url];
          
          sendProgressToTab(currentTabId, 'showNextPreview', {
            nextUrl: nextSite.url,
            nextDuration: nextSite.duration,
            screenshot: cachedScreenshot || null,
            isFirstRound: isFirstRound
          });
        }
        
        // ========================================
        // === در دور اول، در میانه زمان نمایش، از تب فعلی اسکرین‌شات بگیر ===
        // ========================================
        if (isFirstRound && !screenshotCache[currentSite.url]) {
          const captureDelay = (duration * 1000) / 2;
          setTimeout(() => {
            captureScreenshotForCurrentTab();
          }, captureDelay);
        }
      }
    });
  }
  
  rotationInterval = setTimeout(() => {
    if (isRotating) {
      rotateTabs();
    }
  }, duration * 1000);
  
  const startTime = Date.now();
  progressUpdater = setInterval(() => {
    if (!isRotating) {
      if (progressUpdater) clearInterval(progressUpdater);
      return;
    }
    
    const elapsed = (Date.now() - startTime) / 1000;
    const remaining = Math.max(0, duration - elapsed);
    const tabId = tabIds[currentTabIndex];
    
    if (tabId) {
      sendProgressToTab(tabId, 'updateProgress', { remaining: remaining });
    }
    
    if (remaining <= 0) {
      if (progressUpdater) clearInterval(progressUpdater);
      progressUpdater = null;
    }
  }, 100);
}

function sendProgressToTab(tabId, action, data = {}) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, { action, ...data }).catch(() => {});
}

async function checkConfigChanges() {
  if (!isRotating) return;

  try {
    const result = await new Promise(resolve => chrome.storage.local.get(['configUrl'], resolve));
    if (!result.configUrl) return;

    const response = await fetch(result.configUrl);
    const newConfig = await response.json();

    if (validateConfig(newConfig) && JSON.stringify(config) !== JSON.stringify(newConfig)) {
      console.log('Config changed, updating rotation');
      screenshotCache = {};
      isFirstRound = true;
      config = newConfig;

      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => chrome.tabs.remove(tab.id));
      });

      stopRotation();
      startRotation();
    }
  } catch (err) {
    console.error('Error checking config:', err.message);
  }
}

function setupReloadInterval(tabId, intervalSeconds) {
  if (reloadIntervals[tabId]) {
    clearInterval(reloadIntervals[tabId]);
  }
  reloadIntervals[tabId] = setInterval(() => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) return;
      if (!tab.active) {
        chrome.tabs.reload(tabId, {}, () => {
          if (chrome.runtime.lastError) {
            console.error('Error reloading tab:', chrome.runtime.lastError.message);
          }
        });
      }
    });
  }, intervalSeconds * 1000);
}

function stopRotation() {
  if (rotationInterval) {
    clearTimeout(rotationInterval);
    rotationInterval = null;
  }
  if (configCheckInterval) {
    clearInterval(configCheckInterval);
    configCheckInterval = null;
  }
  if (progressUpdater) {
    clearInterval(progressUpdater);
    progressUpdater = null;
  }
  Object.values(reloadIntervals).forEach(interval => clearInterval(interval));
  reloadIntervals = {};
  
  tabIds.forEach(tabId => {
    if (tabId) {
      sendProgressToTab(tabId, 'hideProgress');
      sendProgressToTab(tabId, 'hideNextPreview');
    }
  });
  tabIds = [];
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (reloadIntervals[tabId]) {
    clearInterval(reloadIntervals[tabId]);
    delete reloadIntervals[tabId];
  }
  const index = tabIds.indexOf(tabId);
  if (index !== -1) {
    tabIds[index] = null;
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "openOptions") {
    chrome.runtime.openOptionsPage();
  }
});
