/**
 * Temporary /done command - Direct message editing with fixed IDs
 * This script provides a temporary solution to mark players as done
 * by directly editing the 3 distribution messages
 */

import { Client, GatewayIntentBits, StringSelectMenuBuilder, ActionRowBuilder } from 'discord.js';
import { config } from './src/config.js';
import { fetchPlayersDataWithDiscordNames } from './src/sheets.js';
import { DistributionManager } from './src/distribution.js';
import dotenv from 'dotenv';

dotenv.config();

// FIXED MESSAGE IDs - Update these with your actual message IDs
const CHANNEL_ID = '1037060250701922405';
const MESSAGE_IDS = [
  '1454308028223590422', // Message 1: RGR
  '1454308033432912033', // Message 2: OTL
  '1454308036075065396'  // Message 3: RND + WILDCARDS
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const distributionManager = new DistributionManager();
let playersData = [];

client.once('ready', async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  console.log('🔄 Loading player data...');
  
  try {
    playersData = await fetchPlayersDataWithDiscordNames();
    distributionManager.distribute(playersData, 'Trophies', 158);
    console.log(`✅ Loaded ${playersData.length} players`);
    console.log('\n📝 Temporary /done is ready!');
    console.log('Use the bot in Discord to mark players as done.');
  } catch (error) {
    console.error('❌ Failed to load data:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  if (interaction.commandName === 'done_temp') {
    await handleDoneTemp(interaction);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  
  if (interaction.customId.startsWith('select_temp_')) {
    await handleSelectTemp(interaction);
  }
});

async function handleDoneTemp(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  try {
    // Get all players from distribution
    const playersByClans = {
      RGR: [],
      OTL: [],
      RND: [],
      WILDCARDS: []
    };
    
    ['RGR', 'OTL', 'RND', 'WILDCARDS'].forEach(groupName => {
      if (distributionManager.groups[groupName]) {
        distributionManager.groups[groupName].forEach(player => {
          const identifier = distributionManager.getPlayerIdentifier(player);
          const originalName = player.OriginalName || player.Name || identifier;
          const isDone = distributionManager.completedPlayers.has(identifier) ||
                        (player.DiscordName && distributionManager.completedPlayers.has(player.DiscordName));
          
          let label = isDone ? `✅ ${originalName}` : originalName;
          if (label.length > 100) {
            label = label.substring(0, 97) + '...';
          }
          
          playersByClans[groupName].push({
            name: label,
            identifier: identifier,
            originalName: originalName,
            discordName: player.DiscordName,
            isDone: isDone,
            clan: groupName
          });
        });
      }
    });
    
    // Create select menus
    const components = [];
    
    // RGR
    if (playersByClans.RGR.length > 0) {
      const rgrRemaining = playersByClans.RGR.filter(p => !p.isDone).length;
      const rgrOptions = playersByClans.RGR.slice(0, 25).map(p => ({
        label: p.name,
        value: `RGR:${p.identifier}`
      }));
      
      const rgrMenu = new StringSelectMenuBuilder()
        .setCustomId('select_temp_rgr')
        .setPlaceholder(`RGR (${rgrRemaining} remaining)`)
        .setMinValues(0)
        .setMaxValues(Math.min(rgrOptions.length, 25))
        .addOptions(rgrOptions);
      
      components.push(new ActionRowBuilder().addComponents(rgrMenu));
    }
    
    // OTL
    if (playersByClans.OTL.length > 0) {
      const otlRemaining = playersByClans.OTL.filter(p => !p.isDone).length;
      const otlOptions = playersByClans.OTL.slice(0, 25).map(p => ({
        label: p.name,
        value: `OTL:${p.identifier}`
      }));
      
      const otlMenu = new StringSelectMenuBuilder()
        .setCustomId('select_temp_otl')
        .setPlaceholder(`OTL (${otlRemaining} remaining)`)
        .setMinValues(0)
        .setMaxValues(Math.min(otlOptions.length, 25))
        .addOptions(otlOptions);
      
      components.push(new ActionRowBuilder().addComponents(otlMenu));
    }
    
    // RND
    if (playersByClans.RND.length > 0) {
      const rndRemaining = playersByClans.RND.filter(p => !p.isDone).length;
      const rndOptions = playersByClans.RND.slice(0, 25).map(p => ({
        label: p.name,
        value: `RND:${p.identifier}`
      }));
      
      const rndMenu = new StringSelectMenuBuilder()
        .setCustomId('select_temp_rnd')
        .setPlaceholder(`RND (${rndRemaining} remaining)`)
        .setMinValues(0)
        .setMaxValues(Math.min(rndOptions.length, 25))
        .addOptions(rndOptions);
      
      components.push(new ActionRowBuilder().addComponents(rndMenu));
    }
    
    // WILDCARDS
    if (playersByClans.WILDCARDS.length > 0) {
      const wildRemaining = playersByClans.WILDCARDS.filter(p => !p.isDone).length;
      const wildOptions = playersByClans.WILDCARDS.slice(0, 25).map(p => ({
        label: p.name,
        value: `WILDCARDS:${p.identifier}`
      }));
      
      const wildMenu = new StringSelectMenuBuilder()
        .setCustomId('select_temp_wildcards')
        .setPlaceholder(`WILDCARDS (${wildRemaining} remaining)`)
        .setMinValues(0)
        .setMaxValues(Math.min(wildOptions.length, 25))
        .addOptions(wildOptions);
      
      components.push(new ActionRowBuilder().addComponents(wildMenu));
    }
    
    await interaction.editReply({
      content: 'Select players to mark as done (temporary solution):',
      components: components.slice(0, 5)
    });
    
  } catch (error) {
    console.error('❌ Error in handleDoneTemp:', error);
    await interaction.editReply('❌ Failed to load players');
  }
}

async function handleSelectTemp(interaction) {
  await interaction.deferReply({ ephemeral: true });
  
  try {
    const selectedValues = interaction.values;
    
    if (!selectedValues || selectedValues.length === 0) {
      await interaction.editReply('ℹ️ No players selected');
      return;
    }
    
    let markedCount = 0;
    let unmarkedCount = 0;
    
    // Toggle players
    selectedValues.forEach(value => {
      const [clan, identifier] = value.split(':');
      
      const isMarked = distributionManager.completedPlayers.has(identifier);
      
      if (isMarked) {
        distributionManager.completedPlayers.delete(identifier);
        unmarkedCount++;
      } else {
        distributionManager.completedPlayers.add(identifier);
        markedCount++;
      }
    });
    
    // Update the 3 messages
    await updateThreeMessages();
    
    let responseMsg = '';
    if (markedCount > 0) {
      responseMsg += `✅ Marked ${markedCount} player(s) as done`;
    }
    if (unmarkedCount > 0) {
      if (responseMsg) responseMsg += '\n';
      responseMsg += `❌ Unmarked ${unmarkedCount} player(s)`;
    }
    
    await interaction.editReply(responseMsg || '⚠️ No changes made');
    
  } catch (error) {
    console.error('❌ Error in handleSelectTemp:', error);
    await interaction.editReply('❌ Failed to update messages');
  }
}

async function updateThreeMessages() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    const formattedText = distributionManager.getFormattedDistribution();
    
    // Split into 3 messages
    const messages = splitIntoThreeMessages(formattedText);
    
    console.log('📝 Updating 3 messages...');
    
    for (let i = 0; i < 3; i++) {
      try {
        const message = await channel.messages.fetch(MESSAGE_IDS[i]);
        await message.edit({ content: messages[i], allowedMentions: { parse: ['users'] } });
        console.log(`✅ Updated message ${i + 1}/3`);
      } catch (error) {
        console.error(`❌ Failed to update message ${i + 1}:`, error.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Error updating messages:', error);
  }
}

function splitIntoThreeMessages(text) {
  const messages = [];
  
  const rgrStart = text.indexOf('**# ');
  const otlStart = text.indexOf('**## to OTL');
  const rndStart = text.indexOf('**## to RND');
  
  if (rgrStart === -1 || otlStart === -1 || rndStart === -1) {
    console.warn('⚠️ Could not find section markers');
    return [text, '', ''];
  }
  
  // Message 1: Title + RGR
  messages.push(text.slice(rgrStart, otlStart).trim());
  
  // Message 2: OTL only
  messages.push(text.slice(otlStart, rndStart).trim());
  
  // Message 3: RND + WILDCARDS + Footer
  messages.push(text.slice(rndStart).trim());
  
  return messages;
}

// Login
client.login(process.env.DISCORD_TOKEN);
