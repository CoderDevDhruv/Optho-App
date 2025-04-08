import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import { execSync } from 'child_process';
const { Client, LocalAuth, MessageMedia } = pkg;

// ======================
// Chromium Path Resolution
// ======================
async function getExactChromiumPath() {
  try {
    // Method 1: Query Nix store directly
    try {
      const nixPath = execSync(
        'nix-store --query --references $(which chromium) | grep chromium | head -1',
        { stdio: ['pipe', 'pipe', 'ignore'] }
      ).toString().trim() + '/bin/chromium';
      
      await fs.access(nixPath);
      return nixPath;
    } catch {}

    // Method 2: Find in standard Nix locations
    try {
      const findPath = execSync(
        'find /nix/store -path "*-chromium-*/bin/chromium" -type f -executable 2>/dev/null | head -1',
        { stdio: ['pipe', 'pipe', 'ignore'] }
      ).toString().trim();
      
      if (findPath) {
        await fs.access(findPath);
        return findPath;
      }
    } catch {}

    // Fallback to environment variable or default
    return process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
  } catch (error) {
    console.error('Chromium detection error:', error);
    return '/usr/bin/chromium';
  }
}

const chromiumPath = await getExactChromiumPath();
console.log('Using Chromium at:', chromiumPath);

// ======================
// Global Configurations
// ======================
export const qrCodeEmitter = new EventEmitter();
export let qrCodeUrl = '';
let isClientReady = false;
let retryCount = 0;
const MAX_RETRIES = 3;

// ======================
// WhatsApp Client Setup
// ======================
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './sessions',
    clientId: "client-1"  // Added for multi-session support
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
    ]
  },
  takeoverOnConflict: true,
  restartOnAuthFail: true
});

// ======================
// Event Handlers
// ======================
client.on('qr', async (qr) => {
  qrcode.generate(qr, { small: true });
  console.log('📲 Scan the QR code above to log in.');

  qrCodeUrl = await QRCode.toDataURL(qr);
  qrCodeEmitter.emit('qrCodeGenerated', qrCodeUrl);
});

client.on('authenticated', async (session) => {
  console.log('🔑 Authentication successful!');
  qrCodeUrl = '';
  // Backup session
  await fs.writeFile('/tmp/session-backup.json', JSON.stringify(session));
});

client.on('ready', () => {
  isClientReady = true;
  retryCount = 0;
  console.log('🚀 Client is ready!');
  console.log('Memory usage:', process.memoryUsage());
});

client.on('auth_failure', (msg) => {
  console.error('❌ Authentication failed:', msg);
});

client.on('disconnected', async (reason) => {
  console.log('Disconnected:', reason);
  if (reason === 'NAVIGATION_ERROR') {
    await client.destroy();
    process.exit(1);
  }
});

client.on('puppeteer_error', (error) => {
  console.error('🛠️ Puppeteer error:', error);
  client.destroy().then(() => client.initialize());
});

// ======================
// Core Functions
// ======================
export const initializeClient = async () => {
  try {
    // Verify chromium exists
    try {
      await fs.access(chromiumPath);
    } catch (err) {
      console.error('Chromium not found at:', chromiumPath);
      throw new Error('Chromium executable not found');
    }

    await client.initialize();
  } catch (error) {
    console.error('❌ Initialization error:', error);
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      console.log(`Retrying in 5 seconds (attempt ${retryCount}/${MAX_RETRIES})`);
      setTimeout(initializeClient, 5000);
    } else {
      console.error('Max retries reached. Exiting...');
      process.exit(1);
    }
  }
};

export const sendMessage = async (
  phoneNumber, 
  message = "Your Report", 
  fileInput = null,
  fileName = "file.pdf"
) => {
  try {
    if (!isClientReady) {
      throw new Error("WhatsApp client is not ready yet!");
    }

    const chatId = `${phoneNumber}@c.us`;
    
    if (fileInput) {
      let media;
      
      if (Buffer.isBuffer(fileInput)) {
        media = new MessageMedia(
          'application/pdf',
          fileInput.toString('base64'),
          fileName
        );
      } 
      else if (typeof fileInput === 'string') {
        const fileBuffer = await fs.readFile(fileInput);
        const fileExtension = fileInput.split('.').pop() || 'pdf';
        media = new MessageMedia(
          `application/${fileExtension}`,
          fileBuffer.toString('base64'),
          fileInput.split('/').pop() || fileName
        );
      } else {
        throw new Error("Invalid file input: must be Buffer or file path");
      }

      await client.sendMessage(chatId, media, { caption: message });
      console.log(`📁 File sent to ${phoneNumber}`);
    } else {
      await client.sendMessage(chatId, message);
      console.log(`✉️ Message sent to ${phoneNumber}`);
    }
  } catch (error) {
    console.error(`❌ Error sending to ${phoneNumber}:`, error.message);
    
    if (error.message.includes('Evaluation failed')) {
      console.log('🔄 Restarting client due to evaluation error...');
      await client.destroy();
      await initializeClient();
    }
    
    throw error;
  }
};

// ======================
// Process Management
// ======================
process.on('SIGINT', async () => {
  console.log('🛑 Shutting down gracefully...');
  await client.destroy();
  process.exit(0);
});

process.on('unhandledRejection', (error) => {
  console.error('⚠️ Unhandled rejection:', error);
});

// Initialize the client when this module is loaded
initializeClient().catch(console.error);

// ======================
// Module Exports
// ======================
export default {
  initializeClient,
  sendMessage,
  qrCodeEmitter,
  getClientStatus: () => ({ isReady: isClientReady, retryCount }),
};
