document.addEventListener('DOMContentLoaded', () => {
  const configUrlInput = document.getElementById('configUrl');
  const testUrlButton = document.getElementById('testUrl');
  const startButton = document.getElementById('startRotation');
  const stopButton = document.getElementById('stopRotation');
  const statusDiv = document.getElementById('status');
  const errorDiv = document.getElementById('error');

  // Load saved config URL
  chrome.storage.local.get(['configUrl'], (result) => {
    if (result.configUrl) {
      configUrlInput.value = result.configUrl;
    }
  });

  // Test URL button
  testUrlButton.addEventListener('click', () => {
    const url = configUrlInput.value;
    if (!url) {
      errorDiv.textContent = 'Please enter a valid URL';
      return;
    }

    fetch(url)
      .then(response => response.json())
      .then(config => {
        if (validateConfig(config)) {
          statusDiv.textContent = 'Valid config loaded!';
          errorDiv.textContent = '';
          chrome.storage.local.set({ configUrl: url });
        } else {
          errorDiv.textContent = 'Invalid config format';
        }
      })
      .catch(err => {
        errorDiv.textContent = 'Error loading config: ' + err.message;
      });
  });

  // Start rotation
  startButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'startRotation' }, (response) => {
      if (response.status === 'started') {
        statusDiv.textContent = 'Rotation started!';
        errorDiv.textContent = '';
      } else {
        errorDiv.textContent = response.error || 'Failed to start rotation';
      }
    });
  });

  // Stop rotation
  stopButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'stopRotation' }, (response) => {
      statusDiv.textContent = 'Rotation stopped!';
      errorDiv.textContent = '';
    });
  });

  // Validate JSON config
  function validateConfig(config) {
    if (!config || !config.websites || !Array.isArray(config.websites)) {
      return false;
    }
    return config.websites.every(site => 
      site.url && typeof site.url === 'string' &&
      site.duration && typeof site.duration === 'number' &&
      site.tabReloadIntervalSeconds && typeof site.tabReloadIntervalSeconds === 'number'
    );
  }
});