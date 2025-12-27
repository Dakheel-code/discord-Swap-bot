/**
 * Script to restore messages using the backup BotState
 * Run this to restore the 3 messages with all checkmarks
 */

import { Client, GatewayIntentBits } from 'discord.js';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

async function restoreFromBackup() {
  try {
    console.log('🔄 Starting restore from backup BotState...');

    // 1. Load backup BotState
    const backupData = JSON.parse(fs.readFileSync('./restore_botstate.json', 'utf8'));
    console.log(`✅ Loaded backup with ${backupData.completedPlayers.length} completed players`);

    // 2. Fetch Discord channel and messages
    const channel = await client.channels.fetch(backupData.channelId);
    if (!channel) {
      console.error('❌ Could not fetch channel');
      process.exit(1);
    }

    const messages = [];
    for (const messageId of backupData.distributionMessageIds) {
      try {
        const msg = await channel.messages.fetch(messageId);
        messages.push(msg);
        console.log(`✅ Fetched message ${messages.length}/3`);
      } catch (error) {
        console.error(`❌ Failed to fetch message ${messageId}`);
        process.exit(1);
      }
    }

    // 3. Extract players from messages and apply checkmarks
    console.log('\n📊 Extracting and updating players...');
    
    const completedSet = new Set(backupData.completedPlayers);
    const updatedMessages = [];

    for (let i = 0; i < messages.length; i++) {
      const content = messages[i].content;
      const lines = content.split('\n');
      const newLines = [];

      for (const line of lines) {
        let newLine = line;
        
        // Remove existing checkmarks first
        newLine = newLine.replace(/\s*✅\s*$/g, '');
        
        // Check if this line contains a player
        if (newLine.trim().startsWith('›') || (newLine.includes('•') && (newLine.includes('moves to') || newLine.includes('stays in')))) {
          // Extract name from line
          let playerName = null;
          
          if (newLine.includes('•')) {
            const parts = newLine.split('•').map(p => p.trim()).filter(Boolean);
            for (const part of parts) {
              if (part.startsWith('<@')) continue;
              if (part.startsWith('**')) continue;
              if (part.includes('moves') || part.includes('stays')) continue;
              if (part && part !== 'Unknown') {
                playerName = part;
                break;
              }
            }
          }
          
          // Check if this player should have a checkmark
          if (playerName) {
            for (const completed of completedSet) {
              if (completed.includes(playerName) || playerName.includes(completed)) {
                newLine += ' ✅';
                break;
              }
            }
          }
        }
        
        newLines.push(newLine);
      }
      
      updatedMessages.push(newLines.join('\n'));
    }

    // 4. Update the 3 messages
    console.log('\n📤 Updating messages...');
    for (let i = 0; i < 3; i++) {
      try {
        await messages[i].edit({
          content: updatedMessages[i],
          allowedMentions: { parse: ['users'] }
        });
        console.log(`✅ Message ${i + 1}/3 updated`);
      } catch (error) {
        console.error(`❌ Failed to update message ${i + 1}:`, error.message);
      }
    }

    console.log('\n✅ Restore completed!');
    console.log(`   Restored ${backupData.completedPlayers.length} checkmarks`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during restore:', error);
    process.exit(1);
  }
}

client.once('ready', async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  await restoreFromBackup();
});

client.login(process.env.DISCORD_TOKEN);
