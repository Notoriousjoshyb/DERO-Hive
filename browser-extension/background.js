chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'dero-hive:selected-text' || typeof message.text !== 'string') return;
  chrome.storage.session.set({ deroHivePickedText: {
    text: message.text.slice(0, 12000),
    title: message.title || sender.tab?.title || 'Selected text',
    url: message.url || sender.tab?.url || ''
  } }).catch(() => {});
});
