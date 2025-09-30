let config = null;
let currentTabIndex = 0;
let rotationInterval = null;
let reloadIntervals = {};
let isRotating = false;
let tabIds = [];
let configCheckInterval = null;

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

    config.websites.forEach((site, index) => {
      chrome.tabs.create({ url: site.url, active: index === currentTabIndex }, (tab) => {
        tabIds[index] = tab.id;
        if (!config.lazyLoadTabs) {
          setupReloadInterval(tab.id, site.tabReloadIntervalSeconds);
        }
      });
    });

    function rotateTabs() {
      if (!config || !config.websites.length || !isRotating) return;

      currentTabIndex = (currentTabIndex + 1) % config.websites.length;
      chrome.storage.local.set({ currentTabIndex: currentTabIndex });
      console.log(`Switching to tab ${currentTabIndex}: ${config.websites[currentTabIndex].url}`);

      const tabId = tabIds[currentTabIndex];

      if (tabId) {
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError || !tab) {
            chrome.tabs.create({ url: config.websites[currentTabIndex].url, active: true }, (newTab) => {
              tabIds[currentTabIndex] = newTab.id;
              if (!config.lazyLoadTabs) {
                setupReloadInterval(newTab.id, config.websites[currentTabIndex].tabReloadIntervalSeconds);
              }
              scheduleNextRotation();
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
                });
              }
              scheduleNextRotation();
            });
          }
        });
      } else {
        chrome.tabs.create({ url: config.websites[currentTabIndex].url, active: true }, (newTab) => {
          tabIds[currentTabIndex] = newTab.id;
          if (!config.lazyLoadTabs) {
            setupReloadInterval(newTab.id, config.websites[currentTabIndex].tabReloadIntervalSeconds);
          }
          scheduleNextRotation();
        });
      }
    }

    function scheduleNextRotation() {
      if (rotationInterval) {
        clearTimeout(rotationInterval);
      }
      if (isRotating) {
        rotationInterval = setTimeout(rotateTabs, config.websites[currentTabIndex].duration * 1000);
      }
    }

    scheduleNextRotation();

    if (!configCheckInterval) {
      configCheckInterval = setInterval(checkConfigChanges, 60000);
    }
  });
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
      config = newConfig;

      // بستن تمام تب‌های فعلی قبل از باز کردن تب‌های جدید
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => chrome.tabs.remove(tab.id));
      });

      // متوقف کردن چرخش فعلی و پاک‌سازی تمام حالات
      stopRotation();

      // شروع چرخش با کانفیگ جدید
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
  Object.values(reloadIntervals).forEach(interval => clearInterval(interval));
  reloadIntervals = {};
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
