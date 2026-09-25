// V2 FIXED - Only copies actual conversation thread
console.log("[Lead Copier V2] Loaded");

const UI_BLACKLIST = new Set([
  "Messenger","Contacts","Campaigns","Workflows","New","Dialer","Calendar","Skiptrace","Reporting",
  "Inbox","All","Unread","Missed calls","Unreplied","Awaiting reply","Opted out","Deleted","Saved filters",
  "Follow up 1","Follow up 3","Follow up 6","Client","Low","Quick replies","Filters","Name","Conversations",
  "Date","Labels","SC","RK","AP","EG","FB","AM","MM","GB","LA","VH","WR","AC","WD","TS","RD","JM",
  "Searching Contact phone. Digits only, any part of the number works","Messages","Info","Notes","Send",
  "COPY FULL CHAT","1-Click","Copy to Clipboard","Copy + Send to Slack","Copy Formatted (for CRM)",
  "0 - 0 SMS","Follow ...","MAIN","RG"
]);

function isBlacklisted(text) {
  if (!text) return true;
  const t = text.trim();
  if (t.length < 2 && !/^[?!]$/.test(t)) return true;
  if (UI_BLACKLIST.has(t)) return true;
  // Check if starts with blacklisted + extra
  for (let b of UI_BLACKLIST) {
    if (t === b) return true;
  }
  // Just time like "10:43 AM"
  if (/^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(t)) return true;
  // Just initials
  if (/^[A-Z]{1,3}$/.test(t) && t.length <= 3) return true;
  // Campaign tag
  if (t.startsWith("Sent from campaign:")) return true;
  return false;
}

function findConversationContainer() {
  // Strategy 1: Find the pane that has "Messages | Info | Notes" tabs
  const allElements = Array.from(document.querySelectorAll('div'));
  let bestContainer = null;
  let maxScore = 0;

  for (let el of allElements) {
    const text = el.innerText || "";
    // Look for element that contains Messages + Info + Notes in close proximity and has reasonable size
    if (text.includes("Messages") && text.includes("Info") && text.includes("Notes") && text.length < 200) {
      // This is the tab header, go up 2-3 levels to find container
      let container = el.parentElement?.parentElement?.parentElement;
      if (container) {
        // Score this container: should have many messages inside, should be on right side
        const rect = container.getBoundingClientRect();
        const hasMessages = container.innerText.includes("Hi") || container.innerText.includes("selling") || container.innerText.includes("property");
        const score = (rect.width > 300 ? 10 : 0) + (rect.left > 400 ? 10 : 0) + (hasMessages ? 20 : 0) + (rect.height > 400 ? 10 : 0);
        if (score > maxScore) {
          maxScore = score;
          bestContainer = container;
        }
      }
    }
  }

  if (bestContainer) {
    console.log("[V2] Found container via tabs", bestContainer);
    return bestContainer;
  }

  // Strategy 2: Find by looking for date separators like "Tuesday, September 22, 2026" which only exist in chat thread
  const dateRegex = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+September|October|November|December|January|February|March|April|May|June|July|August/i;
  for (let el of allElements) {
    if (dateRegex.test(el.innerText) && el.innerText.length < 100) {
      // Found date separator, its parent likely is chat thread
      let container = el.closest('div[class*="conversation"], div[class*="message-list"], div[style*="overflow"]') || el.parentElement?.parentElement?.parentElement;
      if (container) {
        const rect = container.getBoundingClientRect();
        if (rect.width > 300 && rect.height > 300) {
          console.log("[V2] Found container via date separator", container);
          return container;
        }
      }
    }
  }

  // Strategy 3: Find rightmost large scrollable container (Smarter Contact layout: 3 columns, chat is rightmost)
  const candidates = Array.from(document.querySelectorAll('div')).filter(d => {
    const style = window.getComputedStyle(d);
    const rect = d.getBoundingClientRect();
    return rect.width > 350 && rect.width < 800 && rect.height > 500 && rect.left > 600 && (style.overflowY === 'auto' || style.overflow === 'auto' || d.scrollHeight > rect.height);
  }).sort((a,b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left);

  if (candidates.length > 0) {
    console.log("[V2] Found container via rightmost scrollable", candidates[0]);
    return candidates[0];
  }

  // Fallback: use document body but we'll filter heavily
  console.log("[V2] Fallback to body");
  return document.body;
}

function normalizeText(text) {
  return String(text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function isDateText(text) {
  const t = normalizeText(text);
  return /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}$/i.test(t);
}

function isTimeText(text) {
  return /^(?:0?\d|1\d|2[0-3]):[0-5]\d\s*(?:AM|PM)$/i.test(normalizeText(text));
}

function extractTime(text) {
  const m = normalizeText(text).match(/\b(?:0?\d|1\d|2[0-3]):[0-5]\d\s*(?:AM|PM)\b/i);
  return m ? m[0].replace(/\s+/g, ' ').toUpperCase() : '';
}

function cleanMessageText(text) {
  let t = normalizeText(text);
  // Remove standalone time tokens that belong to the message row.
  t = t.replace(/\b(?:0?\d|1\d|2[0-3]):[0-5]\d\s*(?:AM|PM)\b/gi, ' ');
  t = t.replace(/\b(?:Messages|Info|Notes|Send)\b/g, ' ');
  t = t.replace(/\s*Sent from campaign:\s*.*$/i, '');
  return normalizeText(t);
}

function looksLikeMessageCandidate(text) {
  const t = normalizeText(text);
  if (!t || (t.length < 2 && !/^[?!]$/.test(t)) || t.length > 4000) return false;
  if (isDateText(t) || isTimeText(t) || isBlacklisted(t)) return false;
  if (/^\d+\s*-\s*\d+\s+SMS$/i.test(t)) return false;
  if (/^(Messages|Info|Notes|Send|Preview|Run Task)$/i.test(t)) return false;
  if (/^Sent from campaign:/i.test(t)) return false;
  if (/^[A-Z]{1,3}$/.test(t)) return false;
  return true;
}

function findMessageRow(el, container) {
  let node = el;
  let best = null;
  // Walk upward only while the ancestor still represents exactly one timestamp.
  for (let depth = 0; node && node !== container && depth < 7; depth++, node = node.parentElement) {
    const txt = normalizeText(node.innerText || '');
    if (!txt || txt.length > 4500) continue;
    const times = txt.match(/\b(?:0?\d|1\d|2[0-3]):[0-5]\d\s*(?:AM|PM)\b/gi) || [];
    if (times.length !== 1) continue;
    const cleaned = cleanMessageText(txt);
    if (!looksLikeMessageCandidate(cleaned)) continue;
    best = node;
    // Prefer the smallest ancestor that contains both the timestamp and message.
    if (node.children.length <= 8) break;
  }
  return best;
}

function getElementOrder(el) {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left };
}

function getMessagesTabButton(){return [...document.querySelectorAll('button,[role=tab],a,div,span')].find(e=>normalizeText(e.innerText)==='Messages'&&e.getBoundingClientRect().width>0)}
function getInfoTabButton(){return [...document.querySelectorAll('button,[role=tab],a,div,span')].find(e=>normalizeText(e.innerText)==='Info'&&e.getBoundingClientRect().width>0)}
function phoneFrom(s){const m=normalizeText(s).match(/(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/);return m?m[0]:''}
function infoField(label){
  const labels=[...document.querySelectorAll('label,div,span,p,strong,b')].filter(e=>normalizeText(e.textContent).toLowerCase()===label.toLowerCase());
  for(const l of labels){let n=l;for(let i=0;i<5&&n;i++,n=n.parentElement){
    for(const x of n.querySelectorAll('input,textarea,[contenteditable="true"]')){const v=normalizeText(x.value||x.textContent||x.getAttribute('aria-label'));if(v&&v.toLowerCase()!==label.toLowerCase())return v;}
    const t=normalizeText(n.innerText);const re=new RegExp('(?:^|\\s)'+label.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')+'\\s+([^\\n]+)','i');const m=t.match(re);if(m&&normalizeText(m[1]).toLowerCase()!==label.toLowerCase())return normalizeText(m[1]);
  }}return '';
}
async function leadInfo(){
  const ib=getInfoTabButton(),mb=getMessagesTabButton();
  if(!ib)return {name:'Unknown Lead',phone:'Unknown Phone'};
  try{ib.click();await new Promise(r=>setTimeout(r,400));
    let first=infoField('First name'),last=infoField('Last name'),phone=infoField('Phone number');
    if(!phone){for(const x of document.querySelectorAll('input,textarea')){const v=normalizeText(x.value);if(phoneFrom(v)){phone=phoneFrom(v);break;}}}
    if(!first||!last||!phone){await new Promise(r=>setTimeout(r,300));first=first||infoField('First name');last=last||infoField('Last name');phone=phone||infoField('Phone number');}
    return {name:normalizeText(`${first} ${last}`)||'Unknown Lead',phone:phoneFrom(phone)||phone||'Unknown Phone'};
  }finally{if(mb){mb.click();await new Promise(r=>setTimeout(r,150));}}
}

function extractChatV2() {
  const container = findConversationContainer();
  const sequence = [];
  const seenMessageRows = new Set();
  const seenDates = new Set();

  // First collect date separators from their exact text nodes.
  const all = Array.from(container.querySelectorAll('*'));
  for (const el of all) {
    const own = normalizeText(el.innerText || '');
    if (!isDateText(own)) continue;
    const childDates = Array.from(el.children).filter(c => isDateText(c.innerText || ''));
    if (childDates.length) continue;
    const key = own.toLowerCase();
    if (seenDates.has(key)) continue;
    const pos = getElementOrder(el);
    sequence.push({ text: own, isDate: true, isOutbound: false, pos });
    seenDates.add(key);
  }

  // Collect each SMS from the smallest DOM row containing one time + one message.
  const messageEls = [];
  for (const el of all) {
    const txt = normalizeText(el.innerText || '');
    if (!txt || !/\b(?:0?\d|1\d|2[0-3]):[0-5]\d\s*(?:AM|PM)\b/i.test(txt)) continue;
    const row = findMessageRow(el, container);
    if (!row) continue;
    const raw = normalizeText(row.innerText || '');
    const message = cleanMessageText(raw);
    if (!looksLikeMessageCandidate(message)) continue;
    // Don't allow UI/header/contact blocks to pass as a message.
    if (/^(JD|TP|SC|RK|AP|EG|FB|AM|MM|GB|LA|VH|WR|AC|WD|TS|RD|JM)$/i.test(message)) continue;
    if (/^\d+\s*-\s*\d+\s+SMS$/i.test(message)) continue;
    // IMPORTANT: do not dedupe by message text alone. Leads often send the
    // same short message multiple times (e.g. "Sure"), and that used to
    // cause later messages with identical text to disappear from the copy.
    // Deduplicate only repeated DOM references to the same message row.
    if (seenMessageRows.has(row)) continue;
    seenMessageRows.add(row);

    const cls = `${String(row.className || '')} ${String(el.className || '')}`.toLowerCase();
    const rowStyle = getComputedStyle(row);
    const outbound = cls.includes('outbound') || cls.includes('sent') ||
      row.closest('[class*="outbound"],[class*="sent"]') !== null ||
      rowStyle.justifyContent === 'flex-end' ||
      rowStyle.textAlign === 'right' ||
      row.getAttribute('data-sender') === 'agent';

    const pos = getElementOrder(row);
    messageEls.push({ text: message, time: extractTime(raw), isDate: false, isOutbound: outbound, pos, row });

  }

  // Keep DOM order as the default output order.
  sequence.push(...messageEls);
  sequence.sort((a, b) => {
    if (Math.abs(a.pos.top - b.pos.top) > 2) return a.pos.top - b.pos.top;
    return a.pos.left - b.pos.left;
  });

  // Remove accidental duplicate rows caused by responsive/virtualized copies.
  const unique = [];
  const keys = new Set();
  for (const item of sequence) {
    const key = item.isDate
      ? `date:${item.text.toLowerCase()}`
      : `msg:${item.text.toLowerCase()}|${(item.time || '').toLowerCase()}|${Math.round(item.pos.top)}|${Math.round(item.pos.left)}`;
    if (keys.has(key)) continue;
    keys.add(key);
    unique.push(item);
  }

  // Drop UI/date artifacts at the ends and collapse adjacent duplicate dates.
  const finalItems = [];
  for (const item of unique) {
    if (item.isDate && finalItems.some(x => x.isDate && x.text === item.text)) continue;
    finalItems.push(item);
  }

  return {
    leadName: 'Unknown Lead',
    leadPhone: 'Unknown Phone',
    messages: finalItems.map(({ text, time, isDate, isOutbound }) => ({ text, time: time || "", isDate, isOutbound })),
    platform: getPlatform()
  };
}

function getPlatform() {
  const host = window.location.hostname;
  if (host.includes("smartercontact")) return "Smarter Contact";
  if (host.includes("launchcontrol")) return "Launch Control";
  return "Unknown";
}

// The chat is formatted oldest -> newest by default in formatChatForCopy().
function getOutputData(data) { return data; }

function formatChatForCopy(data) {
  const out = [];
  out.push(`Lead Name: ${data.leadName || 'Unknown Lead'}`);
  out.push(`Phone: ${data.leadPhone || 'Unknown Phone'}`);
  out.push('');
  out.push('----------------------------');
  out.push('');
  // Keep the site's extracted sequence in chronological order: oldest -> newest.
  const orderedMessages = [...data.messages];
  for (const msg of orderedMessages) {
    if (msg.isDate) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      out.push(msg.text);
      out.push('');
      continue;
    }
    const sender = msg.isOutbound ? 'YOU' : 'LEAD';
    out.push(`${msg.time ? msg.time + '  ' : ''}[${sender}]: ${msg.text}`);
    out.push('');
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    return true;
  }
}

function createTaskForm() {
  // Intentionally disabled: Ctrl + Shift + S now copies directly.
  // The extension toolbar popup remains available for Preview.
}

async function copyLeadDirectly() {
  try {
    const rawData = extractChatV2();
    const info = await leadInfo();
    const data = { ...rawData, leadName: info.name, leadPhone: info.phone };
    const formatted = formatChatForCopy(data);

    if (!formatted.trim()) {
      showCopyAnimation("No chat found", "error");
      return { success: false };
    }

    const ok = await copyToClipboard(formatted);
    if (ok) {
      showCopyAnimation("✓ Copied!", "success");
    } else {
      showCopyAnimation("Copy failed", "error");
    }
    return { success: !!ok, count: data.messages.filter(m => !m.isDate).length };
  } catch (err) {
    console.error("[Lead Copier V2] Direct copy failed", err);
    showCopyAnimation("Copy failed", "error");
    return { success: false, error: err?.message || String(err) };
  }
}

function openTaskForm() {
  // Kept for compatibility with older background messages.
  // Do not open a page overlay from the shortcut.
}

let selectionMode = false;
function enableManualSelection() {
  selectionMode = true;
  showToast("Click the part of the chat you want to copy (messages only).", "info");
  document.body.style.cursor = "crosshair";

  function onClick(e) {
    if (!selectionMode) return;
    e.preventDefault();
    e.stopPropagation();
    
    const clickedEl = e.target;
    // Find a suitable container around clicked element
    let container = clickedEl.closest('div[class*="conversation"], div[class*="message-list"], div[style*="overflow"]') || clickedEl.parentElement?.parentElement;
    
    if (container) {
      // Highlight it
      container.style.outline = "3px solid #667eea";
      container.style.background = "rgba(102, 126, 234, 0.05)";
      
      // Extract from this specific container
      const messages = [];
      const nodes = container.querySelectorAll('div, span');
      for (let el of nodes) {
        const text = el.innerText?.trim();
        if (!text || text.length < 15 || text.length > 2000) continue;
        if (isBlacklisted(text)) continue;
        if (text.split(' ').length < 3) continue;
        messages.push({ text, isOutbound: false });
      }
      
      const data = {
        leadName: "Selected Lead",
        leadPhone: "Unknown",
        messages: [...new Set(messages.map(m=>m.text))].map(t=>({text:t, isOutbound:false})),
        platform: getPlatform()
      };
      
      const formatted = formatChatForCopy(data);
      copyToClipboard(formatted);
      showToast(`Copied ${data.messages.length} messages from the selected area.`, "success");
      
      // Save this selector for future
      const selector = generateSelector(container);
      chrome.storage.sync.set({ customSelector: selector });
      
      setTimeout(() => {
        container.style.outline = "";
        container.style.background = "";
      }, 2000);
    }
    
    selectionMode = false;
    document.body.style.cursor = "";
    document.removeEventListener("click", onClick, true);
  }

  document.addEventListener("click", onClick, true);
  
  // Cancel on ESC
  function onKey(e) {
    if (e.key === "Escape") {
      selectionMode = false;
      document.body.style.cursor = "";
      showToast("Selection cancelled.", "error");
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey);
    }
  }
  document.addEventListener("keydown", onKey);
}

function generateSelector(el) {
  // Simple selector generator
  if (el.id) return `#${el.id}`;
  if (el.className) return `.${el.className.split(' ')[0]}`;
  return el.tagName;
}

function showCopyAnimation(message = "✓ Copied!", type = "success") {
  let el = document.getElementById("lead-copier-copy-animation");
  if (!el) {
    el = document.createElement("div");
    el.id = "lead-copier-copy-animation";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `lc-copy-animation ${type}`;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(window.__leadCopierCopyAnimationTimer);
  window.__leadCopierCopyAnimationTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 1300);
}

// Keep the existing helper available for manual-selection code.
function showToast(message, type = "success") {
  showCopyAnimation(message, type);
}

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "s") {
    e.preventDefault();
    e.stopPropagation();
    copyLeadDirectly();
  }
}, true);

function addCopyLeadButton() {
  const existing = document.getElementById("lead-copier-nav-copy");
  if (existing && document.body.contains(existing)) return true;

  const reporting = [...document.querySelectorAll('a,button,[role="button"],nav li,nav a,div,span')]
    .find(el => normalizeText(el.textContent) === "Reporting" && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0);
  if (!reporting) return false;

  // Put Copy Lead directly next to the Reporting navigation item.
  let host = reporting.parentElement;
  if (!host) return false;
  const hostStyle = getComputedStyle(host);
  if (!/flex|inline-flex/i.test(hostStyle.display)) {
    const parent = host.parentElement;
    if (parent && /flex|inline-flex/i.test(getComputedStyle(parent).display)) host = parent;
  }

  const btn = document.createElement("button");
  btn.id = "lead-copier-nav-copy";
  btn.type = "button";
  btn.title = "Copy current lead conversation";
  btn.setAttribute("aria-label", "Copy Lead");
  btn.textContent = "Copy Lead";
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await copyLeadDirectly();
  }, true);

  // Match the existing navigation controls without changing the site's layout.
  const sample = reporting.closest('a,button,[role="button"]') || reporting;
  const cs = getComputedStyle(sample);
  btn.style.cssText = `
    display:inline-flex;align-items:center;justify-content:center;gap:6px;
    box-sizing:border-box;min-height:${Math.max(30, parseFloat(cs.height)||36)}px;
    padding:0 12px;margin-left:8px;border:1px solid #2563eb;
    border-radius:8px;background:#2563eb;
    color:#fff;font:600 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    cursor:pointer;white-space:nowrap;vertical-align:middle;box-shadow:none;
  `;
  btn.onmouseenter = () => { btn.style.background = "#1d4ed8"; };
  btn.onmouseleave = () => { btn.style.background = "#2563eb"; };

  // Insert immediately to the right of the Reporting option itself.
  const target = reporting.closest('a,button,[role="button"]') || reporting;
  const parent = target.parentElement || host;
  parent.insertBefore(btn, target.nextSibling);
  return true;
}

function init() {
  addCopyLeadButton();
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
    }
    addCopyLeadButton();
  }).observe(document, { subtree: true, childList: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
setTimeout(init, 2000);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "copyChat") {
    (async () => {
      try {
        const rawData = extractChatV2();
        const info = await leadInfo();
        const data = { ...rawData, leadName: info.name, leadPhone: info.phone };
        const formatted = formatChatForCopy(data);
        const shouldCopy = request.mode !== "preview";
        const ok = shouldCopy ? await copyToClipboard(formatted) : true;
        if (shouldCopy) showCopyAnimation(ok ? "✓ Copied!" : "Copy failed", ok ? "success" : "error");
        sendResponse({success:!!ok && !!formatted.trim(),count:data.messages.filter(m=>!m.isDate).length,data,formatted,error:formatted.trim()?null:"No conversation messages were found."});
      } catch (err) {
        sendResponse({success:false,count:0,data:null,formatted:"",error:err?.message||String(err)});
      }
    })();
    return true;
  }
  if (request.action === "openTaskForm") { openTaskForm(); sendResponse({success:true}); }
});
