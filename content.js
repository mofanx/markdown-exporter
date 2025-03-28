// 使用兼容性API处理
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// 监听来自popup的消息
browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ success: true });
    return true;
  }
  
  if (request.action === 'convert') {
    convertToMarkdown(request.options)
      .then(markdown => {
        sendResponse({ success: true, markdown });
      })
      .catch(error => {
        console.error('转换错误:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // 保持消息通道开放
  }
});

// 主转换函数
async function convertToMarkdown(options = {}) {
  try {
    // 获取当前可见的内容
    const visibleContent = document.documentElement.outerHTML;
    const parser = new DOMParser();
    const doc = parser.parseFromString(visibleContent, 'text/html');

    // 获取标题
    const title = extractTitle(doc);
    
    // 获取封面图片
    const coverImage = options.includeImages ? await handleImage(doc.querySelector('.TitleImage img')) : '';
    
    // 获取主要内容
    const mainContent = extractMainContent(doc);
    if (!mainContent) {
      throw new Error('无法找到文章内容，请确保页面已完全加载');
    }
    
    // 清理内容
    const cleanedContent = cleanDOM(mainContent);
    
    // 开始生成Markdown
    let markdown = '';
    
    // 添加标题
    if (title) {
      markdown += `# ${title}\n\n`;
    }
    
    // 添加封面图片
    if (coverImage) {
      markdown += coverImage;
    }
    
    // 转换主要内容
    markdown += await convertNodeToMarkdown(cleanedContent, options);
    
    // 清理markdown文本
    return cleanMarkdown(markdown);
  } catch (error) {
    console.error('转换过程中出错:', error);
    throw new Error(`转换失败: ${error.message}`);
  }
}

// 转换节点为Markdown
async function convertNodeToMarkdown(node, options = {}) {
  let markdown = '';
  
  // 处理文本节点
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent.trim();
    if (text) {
      markdown += text + ' ';
    }
    return markdown;
  }
  
  if (node.nodeType !== Node.ELEMENT_NODE) return markdown;
  
  const tagName = node.tagName.toLowerCase();
  
  // 处理其他元素
  switch(tagName) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      const level = tagName.charAt(1);
      markdown += `\n\n${'#'.repeat(level)} ${node.textContent.trim()}\n\n`;
      break;

    case 'p':
      markdown += '\n\n';
      for (const child of node.childNodes) {
        markdown += await convertNodeToMarkdown(child, options);
      }
      markdown += '\n\n';
      break;

    case 'br':
      markdown += '\n';
      break;

    case 'strong':
    case 'b':
      markdown += '**' + node.textContent.trim() + '**';
      break;

    case 'em':
    case 'i':
      markdown += '_' + node.textContent.trim() + '_';
      break;

    case 'blockquote':
      markdown += '\n\n> ' + node.textContent.trim().split('\n').join('\n> ') + '\n\n';
      break;

    case 'a':
      if (options.includeLinks !== false) {
        const href = node.getAttribute('href');
        const text = node.textContent.trim();
        if (href && !href.startsWith('#') && !href.startsWith('javascript:') && text) {
          try {
            const absoluteHref = new URL(href, window.location.href).href;
            markdown += `[${text}](${absoluteHref})`;
          } catch (e) {
            markdown += text;
          }
        } else {
          markdown += text;
        }
      } else {
        markdown += node.textContent.trim();
      }
      break;

    case 'img':
      if (options.includeImages !== false) {
        markdown += await handleImage(node);
      }
      break;

    case 'pre':
    case 'code':
      if (isCodeBlock(node)) {
        const codeText = extractCodeContent(node);
        const language = detectCodeLanguage(node);
        markdown += formatCodeBlock(codeText, language);
      } else {
        for (const child of node.childNodes) {
          markdown += await convertNodeToMarkdown(child, options);
        }
      }
      break;

    case 'ul':
    case 'ol':
      markdown += '\n\n';
      for (const [index, li] of Array.from(node.children).entries()) {
        const text = li.textContent.trim();
        if (text) {
          const bullet = tagName === 'ol' ? `${index + 1}.` : '-';
          markdown += `${bullet} ${text}\n`;
        }
      }
      markdown += '\n';
      break;

    case 'table':
      if (options.includeTables !== false) {
        markdown += await convertTableToMarkdown(node);
      }
      break;

    default:
      for (const child of node.childNodes) {
        markdown += await convertNodeToMarkdown(child, options);
      }
  }
  
  return markdown;
}

// 清理markdown文本
function cleanMarkdown(markdown) {
  return markdown
    .replace(/\n{3,}/g, '\n\n')           // 最多保留两个连续换行
    .replace(/\s+$/gm, '')                // 移除行尾空白
    .replace(/^\s+/gm, '')                // 移除行首空白
    .replace(/ +/g, ' ')                  // 将多个空格替换为单个空格
    .replace(/!\[.*?\]\(data:.*?\)/g, '') // 移除base64图片
    .replace(/\[([^\]]+)\]\(javascript:.*?\)/g, '$1') // 移除javascript链接
    .trim();
}

// 转换表格为Markdown
async function convertTableToMarkdown(tableElement) {
  let markdown = '\n\n';
  const rows = Array.from(tableElement.rows);
  
  if (rows.length === 0) return markdown;
  
  // 处理表头
  const headerCells = Array.from(rows[0].cells);
  markdown += '| ' + headerCells.map(cell => cell.textContent.trim()).join(' | ') + ' |\n';
  markdown += '| ' + headerCells.map(() => '---').join(' | ') + ' |\n';
  
  // 处理数据行
  for (let i = 1; i < rows.length; i++) {
    const cells = Array.from(rows[i].cells);
    markdown += '| ' + cells.map(cell => cell.textContent.trim()).join(' | ') + ' |\n';
  }
  
  markdown += '\n';
  return markdown;
}

// 获取主要内容
function extractMainContent(doc) {
  const domain = window.location.hostname;
  const platformConfig = PLATFORM_CONFIG[Object.keys(PLATFORM_CONFIG)
    .find(key => domain.includes(key))];

  // 首先尝试使用平台特定的选择器
  if (platformConfig?.contentSelectors) {
    for (const selector of platformConfig.contentSelectors) {
      const element = doc.querySelector(selector);
      if (element) {
        return element;
      }
    }
  }

  // 然后尝试通用选择器
  for (const selector of CONTENT_CONFIG.contentSelectors) {
    const element = doc.querySelector(selector);
    if (element) {
      return element;
    }
  }

  // 如果找不到特定容器，返回body
  return doc.body;
}

// 清理DOM，移除不需要的元素
function cleanDOM(element) {
  // 创建副本以避免修改原始DOM
  const cleanedElement = element.cloneNode(true);
  
  // 移除脚本和样式
  const removeElements = cleanedElement.querySelectorAll('script, style');
  removeElements.forEach(el => el.remove());
  
  // 获取当前域名
  const domain = window.location.hostname;
  const platformConfig = PLATFORM_CONFIG[Object.keys(PLATFORM_CONFIG)
    .find(key => domain.includes(key))];
  
  // 移除平台特定的干扰元素
  if (platformConfig?.removeSelectors) {
    platformConfig.removeSelectors.forEach(selector => {
      const elements = cleanedElement.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    });
  }
  
  // 移除通用干扰元素
  CONTENT_CONFIG.removeSelectors.forEach(selector => {
    const elements = cleanedElement.querySelectorAll(selector);
    elements.forEach(el => el.remove());
  });
  
  // 移除空元素
  removeEmptyElements(cleanedElement);
  
  return cleanedElement;
}

// 获取文章标题
function extractTitle(document) {
  const domain = window.location.hostname;
  const platformConfig = PLATFORM_CONFIG[Object.keys(PLATFORM_CONFIG)
    .find(key => domain.includes(key))];

  // 首先尝试使用平台特定的选择器
  if (platformConfig?.titleSelectors) {
    for (const selector of platformConfig.titleSelectors) {
      const titleElement = document.querySelector(selector);
      if (titleElement && titleElement.textContent.trim()) {
        return titleElement.textContent.trim();
      }
    }
  }

  // 然后尝试通用选择器
  for (const selector of CONTENT_CONFIG.titleSelectors) {
    const titleElement = document.querySelector(selector);
    if (titleElement && titleElement.textContent.trim()) {
      return titleElement.textContent.trim();
    }
  }

  // 如果没有找到，尝试使用document.title
  const docTitle = document.title.split(' - ')[0].trim();
  if (docTitle) {
    return docTitle;
  }

  // 最后尝试使用h1标签
  const h1 = document.querySelector('h1');
  return h1 ? h1.textContent.trim() : '';
}

// 处理图片
async function handleImage(imgNode) {
  if (!imgNode) return '';
  
  try {
    // 获取图片URL
    let imgUrl = imgNode.getAttribute('src') || imgNode.getAttribute('data-src');
    if (!imgUrl) return '';

    // 如果是相对路径，转换为绝对路径
    if (imgUrl.startsWith('/')) {
      imgUrl = new URL(imgUrl, window.location.origin).href;
    }

    // 如果是base64图片，跳过
    if (imgUrl.startsWith('data:')) {
      return '';
    }

    // 获取alt文本
    const altText = imgNode.getAttribute('alt') || '';
    
    return `\n\n![${altText}](${imgUrl})\n\n`;
  } catch (error) {
    console.error('处理图片时出错:', error);
    return '';
  }
}

// 检查是否是代码块
function isCodeBlock(node) {
  // 检查是否有代码块相关的类名
  const hasCodeClass = node.className.split(' ').some(cls => 
    cls.includes('code') || 
    cls.includes('prettyprint') || 
    cls.startsWith('language-') ||
    cls.includes('hljs')
  );

  // 检查是否是pre或code标签
  const isPreOrCode = node.tagName.toLowerCase() === 'pre' || 
                     node.tagName.toLowerCase() === 'code';

  // 检查是否是列表形式的代码块
  const isListCode = node.tagName.toLowerCase() === 'li' && 
                    (node.parentElement?.classList.contains('code-list') ||
                     node.classList.contains('code-line'));

  return hasCodeClass || isPreOrCode || isListCode;
}

// 提取代码内容
function extractCodeContent(node) {
  // 克隆节点以避免修改原始DOM
  const clonedNode = node.cloneNode(true);
  let codeText = '';
  
  // 处理highlight.js的代码块
  if (node.classList.contains('hljs') || node.querySelector('.hljs-ln')) {
    const codeLines = Array.from(node.querySelectorAll('.hljs-ln-line'))
      .filter(line => !line.classList.contains('hljs-ln-n')) // 排除行号
      .map(line => {
        // 获取纯文本内容，移除所有HTML标签但保留空格
        let text = '';
        for (const node of line.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent;
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            text += node.textContent;
          }
        }
        return text;
      });
    return normalizeCodeText(codeLines.join('\n'), false);
  }
  
  // 处理列表形式的代码块
  if (node.tagName.toLowerCase() === 'li') {
    const codeLines = Array.from(node.parentElement.children)
      .map(li => {
        // 尝试获取代码内容div
        const codeDiv = li.querySelector('.hljs-ln-code, .code-content');
        if (codeDiv) {
          return codeDiv.textContent.replace(/^\d+[.:]?\s*/, '');
        }
        return li.textContent.replace(/^\d+[.:]?\s*/, '');
      });
    return normalizeCodeText(codeLines.join('\n'), false);
  }
  
  // 处理微信公众号的特殊情况
  if (window.location.hostname.includes('mp.weixin.qq.com')) {
    // 将<br>标签替换为换行符
    const brs = clonedNode.getElementsByTagName('br');
    Array.from(brs).forEach(br => br.replaceWith('\n'));
    
    // 处理可能存在的code标签
    const codeElement = clonedNode.querySelector('code');
    codeText = codeElement ? codeElement.innerHTML : clonedNode.innerHTML;
    
    // 处理HTML实体和特殊字符
    return normalizeCodeText(codeText, true);
  }
  
  // 处理标准代码块
  const codeElement = clonedNode.querySelector('code');
  if (codeElement) {
    // 检查是否有高亮处理
    if (codeElement.classList.contains('hljs')) {
      codeText = Array.from(codeElement.childNodes)
        .map(node => {
          if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent;
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            return node.textContent;
          }
          return '';
        })
        .join('');
    } else {
      codeText = codeElement.textContent;
    }
  } else {
    codeText = clonedNode.textContent;
  }
  
  return normalizeCodeText(codeText, false);
}

// 规范化代码文本
function normalizeCodeText(codeText, isHtml = false) {
  let text = codeText;
  
  if (isHtml) {
    // 处理HTML实体
    text = text
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<br\s*\/?>/gi, '\n')  // 处理任何形式的<br>标签
      .replace(/<[^>]+>/g, '');       // 移除其他HTML标签
  }
  
  // 通用处理
  text = text
    .replace(/\u00a0/g, ' ')     // 替换 non-breaking space
    .replace(/\u200b/g, '')      // 替换零宽空格
    .replace(/\t/g, '    ')      // 将tab替换为4个空格
    .replace(/\r\n/g, '\n')      // 统一换行符
    .replace(/\r/g, '\n')        // 统一换行符
    .replace(/^\s*\d+[.:]\s*/gm, '') // 移除行号
    .replace(/\n{3,}/g, '\n\n'); // 最多保留两个连续换行
    
  // 处理每一行，保持缩进
  const lines = text.split('\n').map(line => {
    // 保留行首空格（缩进）但移除行尾空白
    return line.replace(/\s+$/, '');
  });
  
  // 移除开头和结尾的空行
  while (lines.length > 0 && !lines[0].trim()) lines.shift();
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  
  // 重新组合代码，保持原有的换行和缩进
  return lines.join('\n');
}

// 检测代码语言
function detectCodeLanguage(node) {
  // 处理微信公众号的特殊情况
  if (window.location.hostname.includes('mp.weixin.qq.com')) {
    // 检查微信特有的类名
    if (node.classList.contains('js_darkmode__3')) return 'javascript';
    // 尝试从父元素获取语言信息
    const parent = node.closest('[data-lang]');
    if (parent) {
      const lang = parent.getAttribute('data-lang');
      if (lang) return lang.toLowerCase();
    }
  }
  
  // 从class名称中提取语言
  const classes = node.className.split(' ');
  for (const cls of classes) {
    if (cls.startsWith('language-')) {
      return cls.replace('language-', '');
    }
    // 处理常见的语言类名
    if (cls.match(/^(html|css|javascript|python|java|cpp|csharp|php|ruby|swift|go|rust|kotlin|typescript)$/i)) {
      return cls.toLowerCase();
    }
  }
  
  // 从data属性中提取
  const lang = node.getAttribute('data-lang') || 
               node.getAttribute('data-language') || 
               node.parentElement?.getAttribute('data-lang') ||
               node.parentElement?.getAttribute('data-language');
               
  if (lang) return lang.toLowerCase();
  
  // 尝试从代码内容推测语言
  const codeText = node.textContent.trim().toLowerCase();
  if (codeText.startsWith('<?php')) return 'php';
  if (codeText.includes('<!doctype html') || codeText.includes('<html')) return 'html';
  if (codeText.includes('import ') && codeText.includes('from ')) return 'python';
  if (codeText.includes('function') && codeText.includes('{')) return 'javascript';
  
  // 默认返回普通文本
  return '';
}

// 格式化代码块
function formatCodeBlock(codeText, language = '') {
  if (!codeText.trim()) return '';
  
  // 检查是否是单行代码
  const isSingleLine = !codeText.includes('\n') && codeText.length < 100;
  
  if (isSingleLine) {
    // 使用单个反引号
    return ` \`${codeText.trim()}\` `;
  } else {
    // 使用三个反引号
    language = language.toLowerCase();
    return `\n\n\`\`\`${language}\n${codeText}\n\`\`\`\n\n`;
  }
}

// 平台特定的处理配置
const PLATFORM_CONFIG = {
  // 知乎
  'zhihu.com': {
    removeSelectors: [
      '.ContentItem-time',           // 发布时间
      '.IPItem',                     // IP信息
      '.ContentItem-actions',        // 点赞、评论等操作区
      '.FollowButton',              // 关注按钮
      '.RichContent-actions',       // 文章底部操作区
      '.Post-topicsAndReviewer',    // 话题和审核信息
      '.Post-SideActions',          // 侧边操作栏
      '.Reward',                    // 赞赏区域
      '.CornerButtons',            // 角落按钮
      '.Recommendations-Main',     // 推荐阅读
      '.ContentItem-time',         // 编辑时间
      '.ContentItem-meta',         // 元信息（包含编辑时间和IP）
      '.Post-Footer',              // 文章底部信息
      '.Post-NormalMain > div > div:last-child',  // 底部额外信息
      '.Post-NormalSub',           // 侧边信息
      '.Reward',                   // 赞赏
      '.FollowButton',            // 关注按钮
      '.ContentItem-actions',     // 文章操作栏
      '.Post-topicsAndReviewer'   // 话题和审核者信息
    ],
    contentSelectors: [
      '.Post-RichText',
      '.RichContent-inner'
    ],
    titleSelectors: [
      '.Post-Title',
      'h1.QuestionHeader-title'
    ]
  },
  
  // 微信公众号
  'mp.weixin.qq.com': {
    removeSelectors: [
      '#js_pc_qr_code',            // 二维码
      '#js_profile_qrcode',        // 个人二维码
      '#js_sponsor_ad_area',       // 广告区
      '#js_share_friend',          // 分享给朋友
      '#js_share_moments',         // 分享到朋友圈
      '.rich_media_area_primary',  // 点赞区域
      '.rich_media_area_extra',    // 额外信息区域
      '.discuss_container',        // 评论区
      '.qr_code_pc_outer',        // 二维码外层
      '.tool_area',               // 工具栏
    ],
    contentSelectors: [
      '#js_content',
      '.rich_media_content'
    ],
    titleSelectors: [
      '#activity-name',
      '.rich_media_title'
    ]
  }
};

// 主要内容提取配置
const CONTENT_CONFIG = {
  // 需要移除的选择器
  removeSelectors: [
    // 通用
    '.advertisement', '.social-share', '.comment-section', '.related-posts',
    'nav', 'header', 'footer', '.sidebar', '.menu', '.toolbar', '.share',
    '[role="complementary"]', '[role="navigation"]',
    
    // 知乎特定
    '.ColumnPageHeader', '.Sticky', '.RichContent-actions', '.ContentItem-actions',
    '.CornerButtons', '.Reward', '.FollowButton', '.AuthorInfo',
    '.Post-SideActions', '.Recommendations-Main',
    
    // 微信特定
    '#js_pc_qr_code', '#js_profile_qrcode', '#js_sponsor_ad_area',
    '#js_share_friend', '#js_share_moments',
    
    // 其他平台可以继续添加
  ],
  
  // 文章主要内容选择器
  contentSelectors: [
    // 通用
    'article',
    '[role="main"]',
    '.post-content',
    '.article-content',
    '.entry-content',
    
    // 知乎特定
    '.Post-RichText',
    '.RichContent-inner',
    
    // 微信特定
    '#js_content',
    
    // 其他平台可以继续添加
  ],
  
  // 标题选择器
  titleSelectors: [
    // 通用
    'h1.title',
    'h1.post-title',
    'article h1',
    
    // 知乎特定
    '.Post-Title',
    'h1.QuestionHeader-title',
    
    // 微信特定
    '#activity-name',
    
    // 其他平台可以继续添加
  ],
  
  // 封面图片选择器
  coverImageSelectors: [
    // 通用
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    '.post-cover img',
    'article img:first-of-type',
    
    // 知乎特定
    '.TitleImage',
    
    // 微信特定
    '#js_cover',
    
    // 其他平台可以继续添加
  ]
};

// 移除空元素
function removeEmptyElements(element) {
  const isElementEmpty = node => {
    const text = node.textContent.trim();
    const hasImages = node.querySelector('img');
    const hasIframes = node.querySelector('iframe');
    return !text && !hasImages && !hasIframes;
  };

  const walk = node => {
    const childNodes = Array.from(node.children);
    childNodes.forEach(child => {
      walk(child);
      if (isElementEmpty(child) && !['img', 'iframe', 'br'].includes(child.tagName.toLowerCase())) {
        child.remove();
      }
    });
  };

  walk(element);
}

// 用于检查content script是否已注入
// 注意：此处已在文件顶部定义了browserAPI变量，所以此处直接使用
browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ success: true });
    return true;
  }
  
  if (request.action === 'convertToMarkdown') {
    try {
      const markdown = convertToMarkdown(request.options);
      sendResponse({ 
        success: true, 
        markdown: markdown 
      });
    } catch (error) {
      console.error('Markdown转换错误:', error);
      sendResponse({ 
        success: false, 
        error: error.message || '转换过程中发生未知错误'
      });
    }
  }
  return true; // 保持消息通道开放
});
