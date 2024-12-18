// 监听来自content script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'convertToMarkdown') {
    // 处理转换请求
    sendResponse({ success: true });
  }
});
