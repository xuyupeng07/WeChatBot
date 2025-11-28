// Webhook 消息发送
import axios from 'axios';

export const sendWebhookMessage = async (webhookUrl, content, log) => {
  try {
    if (!webhookUrl) {
      log('warn', 'Webhook URL未配置');
      return false;
    }
    await axios.post(
      webhookUrl,
      { msgtype: 'text', text: { content } },
      { headers: { 'Content-Type': 'application/json' }, timeout: 5000 }
    );
    log('info', 'Webhook消息发送成功', { contentLength: content.length });
    return true;
  } catch (error) {
    log('error', 'Webhook消息发送失败', { error: error.message });
    return false;
  }
};
