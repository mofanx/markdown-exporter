// 监听来自content script的消息
// 使用兼容性API处理
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'convertToMarkdown') {
    // 处理转换请求
    sendResponse({ success: true });
  }
});
