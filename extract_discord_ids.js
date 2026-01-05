/**
 * Script to extract Discord IDs from a DM message and create proper mentions
 */

import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

const DM_MESSAGE_ID = '1454413448195735618';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: ['CHANNEL', 'MESSAGE']
});

async function extractDiscordIds() {
  try {
    console.log('🔄 Fetching DM message...');

    // Get the DM channel
    const dmChannels = await client.channels.fetch();
    
    // Try to find the message in DM channels
    let foundMessage = null;
    
    for (const [channelId, channel] of client.channels.cache) {
      if (channel.isDMBased()) {
        try {
          const message = await channel.messages.fetch(DM_MESSAGE_ID);
          if (message) {
            foundMessage = message;
            console.log(`✅ Found message in DM with ${channel.recipient?.tag || 'Unknown'}`);
            break;
          }
        } catch (error) {
          // Message not in this DM channel, continue
        }
      }
    }

    if (!foundMessage) {
      console.error('❌ Could not find DM message. Trying user DM...');
      
      // Alternative: Get user's DM channel directly
      const user = await client.users.fetch(client.user.id);
      const dmChannel = await user.createDM();
      
      try {
        foundMessage = await dmChannel.messages.fetch(DM_MESSAGE_ID);
        console.log('✅ Found message in user DM');
      } catch (error) {
        console.error('❌ Could not find message:', error.message);
        process.exit(1);
      }
    }

    console.log('\n📊 Message content:');
    console.log('─'.repeat(50));
    console.log(foundMessage.content);
    console.log('─'.repeat(50));

    // Extract all Discord mentions from the message
    const mentions = foundMessage.content.match(/<@!?(\d+)>/g) || [];
    const uniqueMentions = [...new Set(mentions)];

    console.log(`\n✅ Found ${uniqueMentions.length} unique Discord mentions:`);
    
    const playerMentions = [];
    
    for (const mention of uniqueMentions) {
      const userId = mention.match(/\d+/)[0];
      try {
        const user = await client.users.fetch(userId);
        console.log(`   ${mention} → ${user.tag}`);
        playerMentions.push({
          mention: mention,
          userId: userId,
          username: user.username,
          tag: user.tag
        });
      } catch (error) {
        console.log(`   ${mention} → (Could not fetch user)`);
        playerMentions.push({
          mention: mention,
          userId: userId,
          username: 'Unknown',
          tag: 'Unknown'
        });
      }
    }

    // Save to JSON file
    const fs = await import('fs');
    fs.writeFileSync('./discord_mentions.json', JSON.stringify(playerMentions, null, 2));
    console.log('\n💾 Saved to discord_mentions.json');

    // Also extract player names and create mapping
    console.log('\n📋 Creating player name to mention mapping...');
    const lines = foundMessage.content.split('\n');
    const playerMapping = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('**') || trimmed.startsWith('─')) continue;

      // Extract mention and name from line
      const mentionMatch = trimmed.match(/<@!?(\d+)>/);
      if (mentionMatch) {
        const mention = mentionMatch[0];
        // Extract name (everything after mention, before trophies/clan info)
        let name = trimmed.replace(mention, '').trim();
        // Remove trophies (numbers at the end)
        name = name.replace(/\d+\s*$/, '').trim();
        
        playerMapping.push({
          name: name,
          mention: mention,
          userId: mentionMatch[1]
        });
      }
    }

    fs.writeFileSync('./player_mention_mapping.json', JSON.stringify(playerMapping, null, 2));
    console.log(`✅ Created mapping for ${playerMapping.length} players`);
    console.log('💾 Saved to player_mention_mapping.json');

    console.log('\n✅ Extraction completed!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during extraction:', error);
    process.exit(1);
  }
}

client.once('ready', async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  await extractDiscordIds();
});

client.login(process.env.DISCORD_TOKEN);
