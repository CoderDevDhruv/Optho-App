import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import { execSync } from 'child_process';
const { Client, LocalAuth, MessageMedia } = pkg;

// ======================
// Enhanced Chromium Path Resolution
// ======================
async function getChromiumPath() {
  const pathsToTry = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    ...execSync('find /nix/store -name chromium -type f -executable 2>/dev/null || echo ""')
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
  ];

  for (const path of pathsToTry) {
    if (!path) continue;
    try {
      await fs.access(path);
      console.log('Using Chromium at:', path);
      return path;
    } catch (e) {
      continue;
    }
  }
  throw new Error('Chromium not found in any standard location');
}

// ======================
// Client Configuration
// ======================
export const qrCodeEmitter = new EventEmitter();
export let qrCodeUrl = '';
let isClientReady = false;
let retryCount = 0;
const MAX_RETRIES = 5;  // Increased retry attempts

const chromiumPath = await getChromiumPath().catch(() => '/usr/bin/chromium');

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './sessions',
    clientId: "main-client"
  }),
  puppeteer: {
    executablePath: chromiumPath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--remote-debugging-port=9222'
    ]
  },
  takeoverOnConflict: true,
  restartOnAuthFail: true
});

// ======================
// Enhanced Event Handlers
// ======================
client.on('qr', async (qr) => {
  qrcode.generate(qr, { small: true });
  console.log('📲 QR Code generated, please scan');
  
  try {
    qrCodeUrl = await QRCode.toDataURL(qr);
    qrCodeEmitter.emit('qrCodeGenerated', qrCodeUrl);
  } catch (e) {
    console.error('QR Code generation error:', e);
  }
});

client.on('authenticated', () => {
  console.log('🔑 Authenticated successfully');
  qrCodeUrl = '';
});

client.on('ready', () => {
  isClientReady = true;
  retryCount = 0;
  console.log('🚀 Client is fully ready and operational');
  console.log('System stats:', {
    memory: process.memoryUsage(),
    chromium: chromiumPath
  });
});

client.on('auth_failure', (msg) => {
  console.error('❌ Auth failure:', msg);
  if (retryCount < MAX_RETRIES) {
    retryCount++;
    console.log(`Retrying authentication (${retryCount}/${MAX_RETRIES})`);
  }
});

client.on('disconnected', async (reason) => {
  console.log('🔌 Disconnected:', reason);
  if (isClientReady) {
    console.log('Attempting to reconnect...');
    await initializeClient();
  }
});

// ======================
// Core Functions with Enhanced Error Handling
// ======================
export const initializeClient = async () => {
  try {
    if (client.pupPage?.()?.isClosed() === false) {
      console.log('Client already active');
      return;
    }

    console.log('Initializing WhatsApp client...');
    await client.initialize();
  } catch (error) {
    console.error('Initialization error:', error.message);
    
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      console.log(`Retrying in 5s (${retryCount}/${MAX_RETRIES})`);
      setTimeout(initializeClient, 5000);
    } else {
      console.error('Max retries reached. Needs manual intervention.');
    }
  }
};

export const sendMessage = async (phoneNumber, message = "Your Report", fileInput = null, fileName = null) => {
  if (!isClientReady) {
    throw new Error("Client not ready. Current status: " + client.info);
  }

  const chatId = `${phoneNumber}@c.us`;
  
  try {
    if (fileInput) {
      const media = Buffer.isBuffer(fileInput)
        ? new MessageMedia('application/pdf', fileInput.toString('base64'), fileName || 'file.pdf')
        : new MessageMedia(
            `application/${fileInput.split('.').pop() || 'pdf'}`,
            (await fs.readFile(fileInput)).toString('base64'),
            fileInput.split('/').pop() || fileName || 'file.pdf'
          );
      
      await client.sendMessage(chatId, media, { caption: message });
      console.log(`📁 Sent file to ${phoneNumber}`);
    } else {
      await client.sendMessage(chatId, message);
      console.log(`✉️ Sent message to ${phoneNumber}`);
    }
    return true;
  } catch (error) {
    console.error(`Send failed to ${phoneNumber}:`, error.message);
    
    // Special handling for connection issues
    if (error.message.includes('not connected')) {
      isClientReady = false;
      await initializeClient();
    }
    
    throw error;
  }
};

// ======================
// Process Management
// ======================
process.on('SIGINT', async () => {
  console.log('🛑 Graceful shutdown initiated');
  try {
    await client.destroy();
    console.log('Client destroyed successfully');
    process.exit(0);
  } catch (e) {
    console.error('Shutdown error:', e);
    process.exit(1);
  }
});

// Start the client
initializeClient().catch(e => console.error('Initialization failed:', e));

export default {
  initializeClient,
  sendMessage,
  qrCodeEmitter,
  getClientStatus: () => ({
    isReady: isClientReady,
    retryCount,
    chromiumPath,
    memoryUsage: process.memoryUsage()
  })
};
