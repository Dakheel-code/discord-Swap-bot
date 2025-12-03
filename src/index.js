import { config, validateConfig } from './config.js';
import { initializeSheetsClient } from './sheets.js';
import { DiscordBot } from './bot.js';

/**
 * Main entry point
 */
async function main() {
  console.log('🚀 Starting Discord Player Distribution Bot...\n');

  // Validate configuration
  if (!validateConfig()) {
    console.error('\n❌ Configuration validation failed. Please check your .env file.');
    process.exit(1);
  }

  // Initialize Google Sheets
  const sheetsInitialized = await initializeSheetsClient();
  if (!sheetsInitialized) {
    console.error('\n❌ Failed to initialize Google Sheets. Please check your credentials.');
    process.exit(1);
  }

  // Start Discord bot
  const bot = new DiscordBot();
  await bot.start();
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled promise rejection:', error);
});

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down bot...');
  process.exit(0);
});

// Start the application
main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
