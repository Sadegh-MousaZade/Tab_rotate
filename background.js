let config = null;
let currentTabIndex = 0;
let rotationInterval = null;
let reloadIntervals = {};
let isRotating = false;
let tabIds = []; // Track tab IDs for each URL

// Keep-alive to prevent Service Worker from terminating
function keepAlive() {
  setInterval(() => {
    if (isRotating) {
      chrome.runtime.getPlatformInfo(() => {});
    }
  }, 20000); // Every 20 seconds
}

// Initialize context menu on extension install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "openOptions",
    title: "Open Tab Rotate Options",
    contexts: ["action"]
  });
});

// Handle icon click to toggle rotation
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
          keepAlive(); // Start keep-alive
        });
      } else {
        console.error('No config URL set');
      }
    });
  }
});

// Load and start rotation when message received
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
      keepAlive(); // Start keep-alive
    });
    return true; // Keep message channel open for async response
  } else if (message.action === 'stopRotation') {
    stopRotation();
    chrome.action.setIcon({ path: 'icon.png' });
    isRotating = false;
    chrome.storage.local.set({ isRotating: false, currentTabIndex: 0 });
    sendResponse({ status: 'stopped' });
  }
});

// Fetch and validate config, then start rotation
async function fetchConfigAndStart(configUrl, sendResponse) {
  try {
    const response = await fetch(configUrl);
    const newConfig = await response.json();
    if (!validateConfig(newConfig)) {
      sendResponse({ status: 'error', error: 'Invalid config format' });
      return;
    }

    // Check if config has changed
    const configChanged = JSON.stringify(config) !== JSON.stringify(newConfig);
    config = newConfig;

    // Only recreate tabs if config has changed or rotation is not active
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

// Validate config
function validateConfig(config) {
  return config && config.websites && Array.isArray(config.websites) &&
    config.websites.every(site => 
      site.url && typeof site.url === 'string' &&
      site.duration && typeof site.duration === 'number' &&
      site.tabReloadIntervalSeconds && typeof site.tabReloadIntervalSeconds === 'number'
    );
}

// Start tab rotation
function startRotation() {
  if (!config || !config.websites.length) return;

  // Load saved state
  chrome.storage.local.get(['currentTabIndex'], (result) => {
    if (result.currentTabIndex) {
      currentTabIndex = result.currentTabIndex;
    }

    // Clear previous tab IDs
    tabIds = [];

    // Open initial tabs and store their IDs
    config.websites.forEach((site, index) => {
      chrome.tabs.create({ url: site.url, active: index === currentTabIndex }, (tab) => {
        tabIds[index] = tab.id; // Store tab ID
        if (!config.lazyLoadTabs) {
          setupReloadInterval(tab.id, site.tabReloadIntervalSeconds);
        }
      });
    });

    // Start rotation
    function rotateTabs() {
      if (!config || !config.websites.length || !isRotating) return;

      currentTabIndex = (currentTabIndex + 1) % config.websites.length;
      chrome.storage.local.set({ currentTabIndex: currentTabIndex });
      console.log(`Switching to tab ${currentTabIndex}: ${config.websites[currentTabIndex].url}`);

      const tabId = tabIds[currentTabIndex];

      if (tabId) {
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError || !tab) {
            // Tab might have been closed, recreate it
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
                // Recreate tab if update fails
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
        // Tab ID not found, recreate tab
        chrome.tabs.create({ url: config.websites[currentTabIndex].url, active: true }, (newTab) => {
          tabIds[currentTabIndex] = newTab.id;
          if (!config.lazyLoadTabs) {
            setupReloadInterval(newTab.id, config.websites[currentTabIndex].tabReloadIntervalSeconds);
          }
          scheduleNextRotation();
        });
      }
    }

    // Schedule next rotation based on current tab's duration
    function scheduleNextRotation() {
      if (rotationInterval) {
        clearTimeout(rotationInterval);
      }
      if (isRotating) {
        rotationInterval = setTimeout(rotateTabs, config.websites[currentTabIndex].duration * 1000);
      }
    }

    // Start the first rotation
    scheduleNextRotation();
  });
}

// Setup reload interval for a tab
function setupReloadInterval(tabId, intervalSeconds) {
  if (reloadIntervals[tabId]) {
    clearInterval(reloadIntervals[tabId]);
  }
  reloadIntervals[tabId] = setInterval(() => {
    // Only reload if tab is not active
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

// Stop rotation
function stopRotation() {
  if (rotationInterval) {
    clearTimeout(rotationInterval);
    rotationInterval = null;
  }
  Object.values(reloadIntervals).forEach(interval => clearInterval(interval));
  reloadIntervals = {};
  tabIds = [];
}

// Clean up intervals when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (reloadIntervals[tabId]) {
    clearInterval(reloadIntervals[tabId]);
    delete reloadIntervals[tabId];
  }
  // Update tabIds if a tab is closed
  const index = tabIds.indexOf(tabId);
  if (index !== -1) {
    tabIds[index] = null;
  }
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "openOptions") {
    chrome.runtime.openOptionsPage();
  }
});
