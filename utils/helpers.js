// 通用辅助函数：ID、会话、缓存键
export const extractUserId = (from) => {
  if (typeof from === 'string') return from;
  if (from && typeof from === 'object' && from.userid) return from.userid;
  return 'unknown_user';
};

export const buildChatIdFromMessage = (messageData) => {
  const chatType = messageData.chattype || 'single';
  if (chatType === 'group') {
    const groupId = messageData.chatid || 'unknown_group';
    return `wechat_group_${groupId}`;
  }
  const userId = extractUserId(messageData.from);
  return `wechat_single_${userId}`;
};

export const generateCacheKey = (content, chatId) => {
  return `cache_${chatId}_${Buffer.from(content).toString('base64').substring(0, 32)}`;
};

export const createRequestId = () => {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};
