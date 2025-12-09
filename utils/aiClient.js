// AI客户端与请求封装
import axios from 'axios';

export const buildFastGPTRequestData = (chatId, content, stream, attachments = []) => {
  const messageContent = [];
  
  if (content) {
      messageContent.push({ type: 'text', text: content });
  }

  if (Array.isArray(attachments)) {
    attachments.forEach(item => {
      if (item.type === 'image') {
        messageContent.push({
          type: 'image_url',
          image_url: {
            url: item.url
          }
        });
      } else if (item.type === 'file') {
        messageContent.push({
          type: 'file_url',
          name: item.name,
          url: item.url
        });
      }
    });
  } else if (typeof attachments === 'string') {
    // Backward compatibility for imageUrl as string
    messageContent.push({
      type: 'image_url',
      image_url: {
        url: attachments
      }
    });
  }



  const messages = [
    {
      role: 'user',
      content: messageContent
    }
  ];

  return {
    chatId,
    stream: !!stream,
    messages
  };
};

export const buildAxiosConfig = (aiApiKey, requestTimeout, stream) => {
  const base = {
    headers: {
      Authorization: `Bearer ${aiApiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'WeChat-AI-Bot/1.0'
    },
    timeout: requestTimeout,
    maxRedirects: 0,
    validateStatus: (status) => status >= 200 && status < 500
  };
  return stream ? { ...base, responseType: 'stream' } : base;
};

// Log detailed curl command for debugging
const logCurlCommand = (aiApiUrl, requestData, config) => {
    const headers = Object.entries(config.headers)
        .map(([key, value]) => `--header '${key}: ${value}'`)
        .join(' \\\n');
    
    const body = JSON.stringify(requestData, null, 2);
    
    const curlCommand = `curl --location --request POST '${aiApiUrl}' \\
${headers} \\
--data-raw '${body}'`;

    console.log('\n--- FastGPT API Request (cURL) ---');
    console.log(curlCommand);
    console.log('----------------------------------\n');
};

export const handleRegularRequest = async (aiApiUrl, requestData, config, retryAttempts, retryDelay, log, requestId) => {
  logCurlCommand(aiApiUrl, requestData, config);
  let lastError;
  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      const response = await axios.post(aiApiUrl, requestData, config);
      if (response.status === 200 && response.data?.choices?.[0]?.message?.content) {
        return response.data.choices[0].message.content;
      }
      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error) {
      lastError = error;
      if (attempt < retryAttempts) {
        log('warn', `重试AI请求 (${attempt}/${retryAttempts})`, { requestId, error: error.message });
        await new Promise((r) => setTimeout(r, retryDelay * attempt));
        continue;
      }
    }
  }
  throw lastError;
};

export const handleStreamRequest = async (aiApiUrl, requestData, config, streamCallback, requestId, log, activeStreams) => {
  logCurlCommand(aiApiUrl, requestData, config);
  const streamConfig = { ...config, responseType: 'stream' };
  try {
    const response = await axios.post(aiApiUrl, requestData, streamConfig);
    if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    activeStreams.set(requestId, { startTime: Date.now(), userId: requestData.chatId });
    let fullContent = '';
    let buffer = '';
    
    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        try {
          buffer += chunk.toString();
          // 检查buffer中是否包含完整的行
          let newlineIndex;
          while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') {
                activeStreams.delete(requestId);
                streamCallback('', true);
                resolve(fullContent);
                return;
              }
              try {
                const parsed = JSON.parse(data);
                if (parsed.choices?.[0]?.delta?.content) {
                  const content = parsed.choices[0].delta.content;
                  fullContent += content;
                  streamCallback(content, false);
                }
              } catch (e) {
                // JSON解析失败通常是因为数据不完整，这种情况下我们不应该丢弃数据
                // 但在SSE协议中，一行应该是一个完整的JSON
                // 如果这里解析失败，可能是因为收到的不是JSON，或者是FastGPT特有的错误格式
                log('warn', 'JSON parse warning', { requestId, data: data.substring(0, 50), error: e.message });
              }
            }
          }
        } catch (error) {
          log('error', '流式处理错误', { requestId, error: error.message });
        }
      });
      response.data.on('end', () => {
        // 处理剩余的 buffer
        if (buffer.length > 0 && buffer.startsWith('data: ')) {
             // 尝试处理最后可能残留的数据
             try {
                 const data = buffer.slice(6).trim();
                 if (data !== '[DONE]') {
                     const parsed = JSON.parse(data);
                     if (parsed.choices?.[0]?.delta?.content) {
                         const content = parsed.choices[0].delta.content;
                         fullContent += content;
                         streamCallback(content, false);
                     }
                 }
             } catch (e) {
                 // ignore
             }
        }
        
        activeStreams.delete(requestId);
        streamCallback('', true);
        resolve(fullContent);
      });
      response.data.on('error', (error) => {
        activeStreams.delete(requestId);
        log('error', '流式响应错误', { requestId, error: error.message });
        reject(error);
      });
    });
  } catch (error) {
    activeStreams.delete(requestId);
    const code = error.code || (error.response && error.response.status);
    throw error;
  }
};
