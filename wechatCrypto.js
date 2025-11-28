import crypto from 'crypto';

class WechatCrypto {
  constructor(token, aesKey, corpId) {
    this.token = token;
    this.aesKey = Buffer.from(aesKey + '=', 'base64');
    this.corpId = corpId;
  }

  // 验证签名
  verifySignature(signature, timestamp, nonce, echostr) {
    const tmpArr = [this.token, timestamp, nonce, echostr].sort();
    const tmpStr = tmpArr.join('');
    const sha1 = crypto.createHash('sha1');
    sha1.update(tmpStr);
    return sha1.digest('hex') === signature;
  }

  // 解密消息
  decrypt(encryptedMsg) {
    try {
      const cipher = crypto.createDecipheriv('aes-256-cbc', this.aesKey, this.aesKey.slice(0, 16));
      cipher.setAutoPadding(false);
      
      let decrypted = cipher.update(encryptedMsg, 'base64', 'binary');
      decrypted += cipher.final('binary');
      
      const content = Buffer.from(decrypted, 'binary');
      
      // 去除随机字符串（前16字节）
      const msgLen = content.readUInt32BE(16);
      const msg = content.slice(20, 20 + msgLen).toString('utf8');
      const receiveid = content.slice(20 + msgLen).toString('utf8');
      
      return {
        message: msg,
        receiveid: receiveid
      };
    } catch (error) {
      console.error('解密失败:', error);
      throw error;
    }
  }

  // 加密消息
  encrypt(message, timestamp, nonce) {
    try {
      const random = crypto.randomBytes(16);
      const msgBuffer = Buffer.from(message, 'utf8');
      const msgLen = Buffer.alloc(4);
      msgLen.writeUInt32BE(msgBuffer.length, 0);
      const corpIdBuffer = Buffer.from(this.corpId, 'utf8');
      
      const content = Buffer.concat([random, msgLen, msgBuffer, corpIdBuffer]);
      
      // PKCS7 填充
      const blockSize = 32;
      const padLength = blockSize - (content.length % blockSize);
      const padding = Buffer.alloc(padLength, padLength);
      const paddedContent = Buffer.concat([content, padding]);
      
      const cipher = crypto.createCipheriv('aes-256-cbc', this.aesKey, this.aesKey.slice(0, 16));
      cipher.setAutoPadding(false);
      
      let encrypted = cipher.update(paddedContent, 'binary', 'base64');
      encrypted += cipher.final('base64');
      
      // 生成签名
      const signature = this.generateSignature(encrypted, timestamp, nonce);
      
      return {
        encrypt: encrypted,
        msgsignature: signature,
        timestamp: parseInt(timestamp),
        nonce: nonce
      };
    } catch (error) {
      console.error('加密失败:', error);
      throw error;
    }
  }

  // 生成签名
  generateSignature(encrypt, timestamp, nonce) {
    const tmpArr = [this.token, timestamp, nonce, encrypt].sort();
    const tmpStr = tmpArr.join('');
    const sha1 = crypto.createHash('sha1');
    sha1.update(tmpStr);
    return sha1.digest('hex');
  }

  // 验证URL有效性
  verifyUrl(signature, timestamp, nonce, echostr) {
    if (this.verifySignature(signature, timestamp, nonce, echostr)) {
      const decrypted = this.decrypt(echostr);
      return decrypted.message;
    }
    throw new Error('URL验证失败');
  }
}

export default WechatCrypto;
