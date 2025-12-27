/**
 * Script to clear BotState and force fresh /swap
 * Run this to reset the bot's saved messages
 */

import fs from 'fs';

const messagesFilePath = './distribution_messages.json';

console.log('🗑️ Clearing BotState...');

// Delete local file
if (fs.existsSync(messagesFilePath)) {
  fs.unlinkSync(messagesFilePath);
  console.log('✅ Deleted distribution_messages.json');
} else {
  console.log('ℹ️ No local distribution_messages.json found');
}

console.log('\n✅ BotState cleared!');
console.log('\n📝 Next steps:');
console.log('1. Restart the bot (or wait for Railway to restart)');
console.log('2. Run /swap in Discord to create NEW 3-message distribution');
console.log('3. Then /done will work correctly with the 3 messages');
