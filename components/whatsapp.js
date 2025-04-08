import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import { execSync } from 'child_process';
const { Client, LocalAuth, MessageMedia } = pkg;

// ======================
// Your Working Chromium Path Resolution
// ======================
async function getChromiumPath() {
  try {
    // Method 1: Try Nix store path first
    const path = execSync('find /nix/store -name chromium -type f -executable | head -n 1').toString().trim();
    if (path) {
      await fs.access(path);
      console.log('Using Chromium at:', path);
      return path;
    }
  } catch (error) {
    console.log('Nix store chromium not found, trying alternatives...');
  }

  // Fallback paths
  const fallbackPaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome'
  ];

  for (const path of fallbackPaths) {
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
const MAX_RETRIES = 5;

// Initialize Chromium path first
let chromiumPath;
try {
  chromiumPath = await getChromiumPath();
} catch (error) {
  console.error('Chromium detection failed:', error.message);
  chromiumPath = '/usr/bin/chromium'; // Final fallback
  console.log('Using default Chromium path:', chromiumPath);
}

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
      '--disable-gpu'
    ],
    timeout: 30000 // Increased timeout
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
    console.error('QR Code URL generation failed:', e);
  }
});

client.on('authenticated', () => {
  console.log('🔑 Authenticated successfully');
  qrCodeUrl = '';
});

client.on('ready', () => {
  isClientReady = true;
  retryCount = 0;
  console.log('🚀 Client is READY');
  console.log('System status:', {
    chromiumPath,
    memory: process.memoryUsage().rss / (1024 * 1024) + 'MB'
  });
});

client.on('auth_failure', (msg) => {
  console.error('❌ Authentication failed:', msg);
});

client.on('disconnected', async (reason) => {
  console.log('⚠️ Disconnected:', reason);
  isClientReady = false;
  if (retryCount < MAX_RETRIES) {
    console.log('Attempting to reconnect...');
    await initializeClient();
  }
});

// ======================
// Core Initialization
// ======================
export async function initializeClient() {
  if (retryCount >= MAX_RETRIES) {
    console.error('🚨 Maximum retry attempts reached');
    return;
  }

  try {
    console.log(`Initializing client (attempt ${retryCount + 1}/${MAX_RETRIES})`);
    
    // Verify Chromium exists
    try {
      await fs.access(chromiumPath);
    } catch (err) {
      console.error('Chromium access failed:', err.message);
      throw err;
    }

    await client.initialize();
  } catch (error) {
    console.error('Initialization failed:', error.message);
    retryCount++;
    
    if (retryCount < MAX_RETRIES) {
      const delay = Math.min(5000 * retryCount, 30000);
      console.log(`Retrying in ${delay/1000} seconds...`);
      setTimeout(initializeClient, delay);
    } else {
      console.error('Maximum initialization attempts reached');
    }
  }
}

// ======================
// Message Sending (Unchanged)
// ======================
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
    throw error;
  }
};

// ======================
// Process Management
// ======================
process.on('SIGINT', async () => {
  console.log('\n🛑 Graceful shutdown initiated');
  try {
    await client.destroy();
    console.log('Client destroyed successfully');
    process.exit(0);
  } catch (e) {
    console.error('Shutdown error:', e);
    process.exit(1);
  }
});

// Start initialization
initializeClient().catch(e => console.error('Initial startup failed:', e));

// ======================
// Module Exports
// ======================
export default {
  initializeClient,
  sendMessage,
  qrCodeEmitter,
  getClientStatus: () => ({
    isReady: isClientReady,
    retryCount,
    maxRetries: MAX_RETRIES,
    chromiumPath
  })
};
