async function sendMessageToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (e) {
    showStatus("❌ Inactive, Try Refreshing [F5]", "error"); 
    throw e;
  }
}

function showStatus(message, type, duration = 2000) {
  const statusBlob = document.getElementById("statusBlob");
  
  // Update blob color
  statusBlob.className = `status-blob ${type === 'error' ? 'inactive' : 'active'}`;
  
  if (duration === 0) {
    return; 
  }
  
  if (type !== "error") {
    setTimeout(() => {
      statusBlob.className = "status-blob active";
    }, duration);
  }
}



function updateEyeIcon(isEnabled) {
  const toggleBtn = document.getElementById("toggleBtn");
  if (isEnabled) {
    // Open eye
    toggleBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  } else {
    // Closed eye
    toggleBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const similaritySlider = document.getElementById("similaritySlider");
  const similarityValue = document.getElementById("similarityValue");
  const toggleBtn = document.getElementById("toggleBtn");
  const presetButtons = document.querySelectorAll(".preset-btn");
  const problemCount = document.getElementById("problemCount");
  const lastResults = document.getElementById("lastResults");

  // Load problem count from background script or storage
  async function loadProblemCount() {
    try {
      const data = await chrome.runtime.sendMessage({ action: "getProblemCountFromBackground" });
      if (data?.count && data.count > 0) {
        problemCount.textContent = data.count.toLocaleString();
        return;
      }
    } catch (e) {
    }
    
    // Fallback: get from storage
    try {
      const data = await chrome.storage.local.get(["leetcodeData"]);
      if (data.leetcodeData && data.leetcodeData.length > 0) {
        problemCount.textContent = data.leetcodeData.length.toLocaleString();
        return;
      }
    } catch (e) {
    }
    
    problemCount.textContent = "Loading...";
    
    // If still not available, retry after a delay
    setTimeout(async () => {
      try {
        const data = await chrome.runtime.sendMessage({ action: "getProblemCountFromBackground" });
        if (data?.count && data.count > 0) {
          problemCount.textContent = data.count.toLocaleString();
        }
      } catch (e) {
        problemCount.textContent = "—";
      }
    }, 1000);
  }
  
  loadProblemCount();

  // Load last search results from storage
  try {
    const data = await chrome.storage.local.get(["lastSearchResults"]);
    if (data.lastSearchResults !== undefined) {
      lastResults.textContent = data.lastSearchResults.toString();
    }
  } catch (e) {
    lastResults.textContent = "—";
  }

  // Load similarity threshold from background script
  try {
    const response = await chrome.runtime.sendMessage({ action: "getSimilarityThreshold" });
    if (response && typeof response.value === "number") {
      similaritySlider.value = response.value.toString();
      similarityValue.textContent = response.value.toString();
      updatePresetButtons(response.value);
    }
  } catch (e) {
    // Fallback to default
    similaritySlider.value = "0.4";
    similarityValue.textContent = "0.4";
  }

  // Load initial toggle state
  try {
    const response = await sendMessageToActiveTab({ action: "getToggleState" });
    updateEyeIcon(response?.enabled !== false);
  } catch (e) {
    updateEyeIcon(true);
  }

  try {
    await chrome.runtime.sendMessage({ action: "getLeetCodeData" });
    showStatus("Extension ready!", "success");
  } catch (error) {
    showStatus("Error loading data", "error");
  }

  // Preset button handlers
  presetButtons.forEach(btn => {
    btn.addEventListener("click", async () => {
      const value = parseFloat(btn.dataset.value);
      similaritySlider.value = value.toString();
      similarityValue.textContent = value.toString();
      updatePresetButtons(value);
      
      try {
        await chrome.runtime.sendMessage({ action: "setSimilarityThreshold", value });
        // Also update on active tab
        try {
          await sendMessageToActiveTab({ action: "setSimilarityThreshold", value });
        } catch (e) {
        }
        showStatus("Threshold updated!", "success");
      } catch (e) {
      }
    });
  });

  toggleBtn.addEventListener("click", async () => {
    try {
      const response = await sendMessageToActiveTab({ action: "toggle" });
      updateEyeIcon(response?.visible !== false);
      showStatus("Toggled!", "success");
    } catch (e) {
    }
  });

  similaritySlider.addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    similarityValue.textContent = value.toString();
    updatePresetButtons(value);
  });

  similaritySlider.addEventListener("change", async (e) => {
    const value = parseFloat(e.target.value);
    try {
      await chrome.runtime.sendMessage({ action: "setSimilarityThreshold", value });
      // Also update on active tab
      try {
        await sendMessageToActiveTab({ action: "setSimilarityThreshold", value });
      } catch (e2) {
      }
      showStatus("Threshold updated!", "success");
    } catch (e) {
    }
  });
});

function updatePresetButtons(value) {
  const presetButtons = document.querySelectorAll(".preset-btn");
  presetButtons.forEach(btn => {
    const btnValue = parseFloat(btn.dataset.value);
    if (Math.abs(btnValue - value) < 0.01) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}
