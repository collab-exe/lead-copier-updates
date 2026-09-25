async function run(action) {
  const s = document.getElementById('status');
  s.textContent = "Working...";
  s.className = "status show success";
  try {
    const tabs = await chrome.tabs.query({active:true, currentWindow:true});
    const tab = tabs[0];
    if (!tab?.id) throw new Error("No active tab.");
    let res;
    try {
      res = await chrome.tabs.sendMessage(tab.id, {action:"copyChat", mode: action});
    } catch (_) {
      await chrome.scripting.executeScript({target:{tabId:tab.id}, files:["content.js"]});
      await chrome.scripting.insertCSS({target:{tabId:tab.id}, files:["styles.css"]});
      await new Promise(r => setTimeout(r, 150));
      res = await chrome.tabs.sendMessage(tab.id, {action:"copyChat", mode: action});
    }
    if (!res?.success) throw new Error(res?.error || "No conversation messages were found.");
    s.textContent = action === "preview"
      ? res.formatted
      : `Copied ${res.count} messages.\n\n${res.formatted.substring(0,500)}${res.formatted.length > 500 ? "..." : ""}`;
    s.className = "status show success";
    s.style.maxHeight = "240px";
    s.style.overflow = "auto";
  } catch (err) {
    s.textContent = `Failed: ${err?.message || err}`;
    s.className = "status show error";
  }
}

document.getElementById('copyNow').addEventListener('click', () => run('copy'));
document.getElementById('previewNow').addEventListener('click', () => run('preview'));
