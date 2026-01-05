import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Message IDs to update
const MESSAGE_IDS = [
  '1454308028223590422',
  '1454308033432912033',
  '1454308036075065396'
];

// Channel ID (will be detected from first message)
let CHANNEL_ID = null;

client.once('ready', async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  
  try {
    // Get the first message to find the channel
    const channels = client.channels.cache;
    let targetChannel = null;
    
    for (const [channelId, channel] of channels) {
      if (channel.isTextBased()) {
        try {
          const message = await channel.messages.fetch(MESSAGE_IDS[0]);
          if (message) {
            targetChannel = channel;
            CHANNEL_ID = channelId;
            console.log(`✅ Found channel: ${channel.name} (${channelId})`);
            break;
          }
        } catch (err) {
          // Message not in this channel, continue
        }
      }
    }
    
    if (!targetChannel) {
      console.error('❌ Could not find the channel with these messages');
      process.exit(1);
    }
    
    // Fetch all messages
    const messages = [];
    for (const msgId of MESSAGE_IDS) {
      try {
        const msg = await targetChannel.messages.fetch(msgId);
        messages.push(msg);
        console.log(`✅ Fetched message ${msgId}`);
      } catch (error) {
        console.error(`❌ Failed to fetch message ${msgId}:`, error.message);
      }
    }
    
    if (messages.length === 0) {
      console.error('❌ No messages found to update');
      process.exit(1);
    }
    
    // Load distribution manager and get formatted distribution
    const sheets = await import('./src/sheets.js');
    const distribution = await import('./src/distribution.js');
    const { fetchPlayersDataWithDiscordNames, initializeSheetsClient } = sheets;
    const { DistributionManager } = distribution;
    
    console.log('🔧 Initializing Google Sheets client...');
    await initializeSheetsClient();
    
    console.log('📊 Fetching player data from Google Sheets...');
    const playersData = await fetchPlayersDataWithDiscordNames();
    console.log(`✅ Loaded ${playersData.length} players`);
    
    const distributionManager = new DistributionManager();
    distributionManager.distribute(playersData, 'Trophies');
    
    // Get formatted distribution as array
    const formattedMessages = distributionManager.getFormattedDistribution();
    console.log(`✅ Generated ${formattedMessages.length} messages`);
    
    // Update each message
    for (let i = 0; i < Math.min(messages.length, formattedMessages.length); i++) {
      try {
        await messages[i].edit({
          content: formattedMessages[i],
          allowedMentions: { parse: ['users'] }
        });
        console.log(`✅ Updated message ${i + 1}/${messages.length}`);
      } catch (error) {
        console.error(`❌ Failed to update message ${i + 1}:`, error.message);
      }
    }
    
    console.log('✅ All messages updated successfully!');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
});

client.login(process.env.DISCORD_TOKEN);
