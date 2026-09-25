chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open-task-form") return;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { action: "copyChat", mode: "copy" });
  } catch (e) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["styles.css"] });
      await new Promise(r => setTimeout(r, 150));
      await chrome.tabs.sendMessage(tab.id, { action: "copyChat", mode: "copy" });
    } catch (_) {}
  }
});
