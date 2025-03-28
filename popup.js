// 定义兼容性API层
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// 状态更新函数
function updateStatus(message, isError = false) {
  const statusDiv = document.getElementById('status');
  statusDiv.textContent = message;
  statusDiv.style.color = isError ? '#dc3545' : '#28a745';
  statusDiv.className = `status ${isError ? 'error' : 'success'}`;
}

// 检查content script是否已注入
async function checkContentScript(tabId) {
  try {
    await browserAPI.tabs.sendMessage(tabId, { action: 'ping' });
    return true;
  } catch (error) {
    return false;
  }
}

// 注入content script
async function injectContentScript(tabId) {
  try {
    // Firefox使用browser.tabs.executeScript，Chrome使用chrome.scripting.executeScript
    if (typeof browser !== 'undefined') {
      await browser.tabs.executeScript(tabId, {
        file: 'content.js'
      });
    } else {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
    }
    return true;
  } catch (error) {
    console.error('注入content script失败:', error);
    return false;
  }
}

// 获取选项设置
function getOptions() {
  return {
    includeImages: document.getElementById('includeImages')?.checked ?? true,
    includeLinks: document.getElementById('includeLinks')?.checked ?? true,
    includeTables: document.getElementById('includeTables')?.checked ?? true
  };
}

// 显示预览
function showPreview(markdown) {
  const previewContainer = document.getElementById('previewContainer');
  const preview = document.getElementById('preview');
  preview.textContent = markdown;
  previewContainer.style.display = 'block';
}

// 复制到剪贴板
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    updateStatus('已复制到剪贴板！');
  } catch (error) {
    console.error('复制失败:', error);
    // 使用备用方法
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    updateStatus('已复制到剪贴板！');
  }
}

// 下载文件
function downloadMarkdown(markdown, filename) {
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  updateStatus('文件已下载！');
}

// 主要转换函数
async function convertToMarkdown() {
  const convertBtn = document.getElementById('convertBtn');
  convertBtn.disabled = true;
  const previewContainer = document.getElementById('previewContainer');
  previewContainer.style.display = 'none';
  
  try {
    updateStatus('正在准备转换...');

    // 获取当前标签页
    const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
    // 安全地获取第一个标签页，避免在Firefox中出现Symbol.iterator错误
    const tab = tabs && tabs.length > 0 ? tabs[0] : null;
    if (!tab) {
      throw new Error('无法获取当前标签页信息');
    }

    // 检查URL是否合法
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:') || tab.url.startsWith('moz-extension://')) {
      throw new Error('无法在浏览器内部页面上运行此扩展');
    }

    // 检查content script是否已注入
    const isInjected = await checkContentScript(tab.id);
    if (!isInjected) {
      updateStatus('正在注入必要组件...');
      const injected = await injectContentScript(tab.id);
      if (!injected) {
        throw new Error('无法注入必要组件，请刷新页面后重试');
      }
      // 等待脚本加载
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // 发送转换请求
    updateStatus('正在转换内容...');
    const response = await browserAPI.tabs.sendMessage(tab.id, { 
      action: 'convertToMarkdown',
      options: getOptions()
    });
    
    if (response.success) {
      updateStatus('转换成功！');
      showPreview(response.markdown);

      // 存储markdown内容
      window.markdownContent = response.markdown;
      window.markdownFilename = `${tab.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
    } else {
      throw new Error(response.error || '转换失败，未知错误');
    }
  } catch (error) {
    console.error('转换错误:', error);
    let errorMessage = '转换失败: ';
    
    if (error.message.includes('Could not establish connection')) {
      errorMessage += '无法建立连接，请刷新页面后重试';
    } else if (error.message.includes('Cannot access')) {
      errorMessage += '无法访问页面内容，请检查页面权限';
    } else {
      errorMessage += error.message;
    }
    
    updateStatus(errorMessage, true);
  } finally {
    convertBtn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const convertBtn = document.getElementById('convertBtn');
  const copyBtn = document.getElementById('copyBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const previewContainer = document.getElementById('previewContainer');
  const preview = document.getElementById('preview');
  const status = document.getElementById('status');

  // 获取选项
  const includeImages = document.getElementById('includeImages');
  const includeLinks = document.getElementById('includeLinks');
  const includeTables = document.getElementById('includeTables');

  let currentMarkdown = '';

  function showStatus(message, isError = false) {
    status.textContent = message;
    status.className = 'status' + (isError ? ' error' : '');
  }

  function showPreview(markdown) {
    preview.textContent = markdown;
    previewContainer.style.display = 'block';
    currentMarkdown = markdown;
  }

  async function convertCurrentTab() {
    try {
      showStatus('正在转换...');
      previewContainer.style.display = 'none';

      // 获取当前标签页
      const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
      // 安全地获取第一个标签页，避免在Firefox中出现Symbol.iterator错误
      const tab = tabs && tabs.length > 0 ? tabs[0] : null;
      if (!tab) throw new Error('无法获取当前标签页');

      // 检查content script是否已注入
      try {
        const response = await browserAPI.tabs.sendMessage(tab.id, { action: 'ping' });
        if (!response) throw new Error('无法连接到页面');
      } catch (error) {
        // 如果content script未注入，先注入它
        // 使用兼容性方式注入content script
        if (typeof browser !== 'undefined') {
          await browser.tabs.executeScript(tab.id, {
            file: 'content.js'
          });
        } else {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
        }
      }

      // 发送转换请求
      const options = {
        includeImages: includeImages.checked,
        includeLinks: includeLinks.checked,
        includeTables: includeTables.checked
      };

      const response = await new Promise((resolve, reject) => {
        browserAPI.tabs.sendMessage(tab.id, { action: 'convert', options }, response => {
          // 检查运行时错误，Firefox和Chrome的处理方式不同
          const runtimeError = browserAPI.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message || '运行时错误'));
          } else if (!response) {
            reject(new Error('无法获取响应'));
          } else if (!response.success) {
            reject(new Error(response.error || '转换失败'));
          } else {
            resolve(response);
          }
        });
      });

      showStatus('转换成功！');
      showPreview(response.markdown);
    } catch (error) {
      console.error('转换错误:', error);
      showStatus(`转换失败: ${error.message}`, true);
    }
  }

  // 复制到剪贴板
  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(currentMarkdown);
      showStatus('已复制到剪贴板！');
    } catch (error) {
      showStatus('复制失败: ' + error.message, true);
    }
  }

  // 下载Markdown文件
  function downloadMarkdown() {
    try {
      const blob = new Blob([currentMarkdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'article.md';
      a.click();
      URL.revokeObjectURL(url);
      showStatus('文件已开始下载！');
    } catch (error) {
      showStatus('下载失败: ' + error.message, true);
    }
  }

  // 绑定事件
  convertBtn.addEventListener('click', convertCurrentTab);
  copyBtn.addEventListener('click', copyToClipboard);
  downloadBtn.addEventListener('click', downloadMarkdown);
});

// 检查当前页面是否支持转换
browserAPI.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  // 安全地获取第一个标签页，避免在Firefox中出现Symbol.iterator错误
  const tab = tabs && tabs.length > 0 ? tabs[0] : null;
  if (tab && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:') || tab.url.startsWith('moz-extension://'))) {
    updateStatus('此页面不支持转换', true);
    if (convertBtn) {
      convertBtn.disabled = true;
    }
  }
});
