/**
 * Manual script to restore the 3 fixed distribution messages
 * by extracting data from the current message content (not Google Sheets)
 */

import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

// FIXED MESSAGE IDs
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

function extractPlayersFromMessage(content, targetClan) {
  const players = [];
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip headers, empty lines, and footer
    if (!trimmed || 
        trimmed.startsWith('**#') || 
        trimmed.startsWith('**##') ||
        trimmed.startsWith('---') ||
        trimmed.startsWith('Done:') ||
        trimmed.startsWith('IF SOMEONE') ||
        trimmed.startsWith('**IF SOMEONE') ||
        trimmed.startsWith(':exclamation:') ||
        trimmed.startsWith('__Anyone') ||
        trimmed.includes('18-HOUR-RULE') ||
        trimmed === '_No players_') {
      continue;
    }
    
    // Main list format: "› @mention • Name • **value** ✅"
    if (trimmed.startsWith('›')) {
      const isDone = trimmed.includes('✅');
      let mention = null;
      let name = 'Unknown';
      let trophies = null;
      
      // Extract mention
      const mentionMatch = trimmed.match(/<@!?(\d+)>/);
      if (mentionMatch) {
        mention = mentionMatch[0];
      }
      
      // Extract name and trophies
      const parts = trimmed.replace(/^›\s*/, '').split('•').map(p => p.trim());
      
      for (const part of parts) {
        if (!part) continue;
        if (part.startsWith('<@')) continue; // Skip mention
        if (part.startsWith('**') && part.endsWith('**')) {
          // This is trophies
          trophies = part.replace(/\*\*/g, '').replace(/✅/g, '').trim();
        } else {
          // This is name
          name = part.replace(/✅/g, '').trim();
        }
      }
      
      players.push({
        mention,
        name,
        trophies,
        targetClan,
        isDone
      });
    }
    // Wildcards format: "@mention •Name• moves to CLAN ✅" or "•Name• stays in CLAN ✅"
    else if (trimmed.includes('•') && (trimmed.includes('moves to') || trimmed.includes('stays in'))) {
      const isDone = trimmed.includes('✅');
      let mention = null;
      let name = 'Unknown';
      let actualClan = targetClan;
      
      // Extract mention
      const mentionMatch = trimmed.match(/<@!?(\d+)>/);
      if (mentionMatch) {
        mention = mentionMatch[0];
      }
      
      // Extract name between •
      const nameMatch = trimmed.match(/•([^•]+)•/);
      if (nameMatch) {
        name = nameMatch[1].trim();
      }
      
      // Extract target clan
      if (trimmed.includes('moves to **RGR**')) actualClan = 'RGR';
      else if (trimmed.includes('moves to **OTL**')) actualClan = 'OTL';
      else if (trimmed.includes('moves to **RND**')) actualClan = 'RND';
      else if (trimmed.includes('stays in **RGR**')) actualClan = 'RGR';
      else if (trimmed.includes('stays in **OTL**')) actualClan = 'OTL';
      else if (trimmed.includes('stays in **RND**')) actualClan = 'RND';
      
      players.push({
        mention,
        name,
        trophies: null,
        targetClan: actualClan,
        isDone,
        isWildcard: true
      });
    }
  }
  
  return players;
}

function rebuildMessage(players, clanName, seasonNumber, isFirstMessage = false, isLastMessage = false) {
  let output = '';
  
  if (isFirstMessage) {
    output += `**# <:RGR:1238937013940523008> SWAP LIST SEASON ${seasonNumber} <:RGR:1238937013940523008>**\n\n`;
  }
  
  output += `**## to ${clanName}**\n`;
  
  const clanPlayers = players.filter(p => p.targetClan === clanName && !p.isWildcard);
  
  if (clanPlayers.length === 0) {
    output += '_No players_\n\n';
  } else {
    clanPlayers.forEach(player => {
      let line = '› ';
      if (player.mention) {
        line += `${player.mention} • ${player.name}`;
      } else {
        line += player.name;
      }
      if (player.trophies) {
        line += ` • **${player.trophies}**`;
      }
      if (player.isDone) {
        line += ' ✅';
      }
      output += line + '\n';
    });
    output += '\n';
  }
  
  // Add wildcards in last message
  if (isLastMessage) {
    const wildcards = players.filter(p => p.isWildcard);
    if (wildcards.length > 0) {
      output += `**# WILDCARDS (${wildcards.length})**\n`;
      wildcards.forEach(player => {
        let line = '';
        if (player.mention) {
          line += `${player.mention} •${player.name}•`;
        } else {
          line += `•${player.name}•`;
        }
        line += ` moves to **${player.targetClan}**`;
        if (player.isDone) {
          line += ' ✅';
        }
        output += line + '\n';
      });
      output += '\n';
    }
    
    // Add footer
    output += '---\n\n';
    output += 'Done: ✅\n\n';
    output += '**IF SOMEONE IN __RGR OR OTL__ CAN\'T PLAY AT RESET, PLEASE CONTACT LEADERSHIP!**\n\n';
    output += ':exclamation: **| 18-HOUR-RULE |** :exclamation:\n';
    output += '__Anyone on the swap list who hasn\'t moved within 18 hours after reset will be automatically kicked from their current clan, replaced and must apply on their own to RND.__\n';
  }
  
  return output;
}

async function restoreMessages() {
  try {
    console.log('🔄 Starting restore from message content...');

    // 1. Fetch Discord channel and messages
    console.log('🔍 Fetching Discord channel and messages...');
    const channel = await client.channels.fetch(CHANNEL_ID);
    
    if (!channel) {
      console.error('❌ Could not fetch channel');
      process.exit(1);
    }

    const messages = [];
    for (const messageId of MESSAGE_IDS) {
      try {
        const msg = await channel.messages.fetch(messageId);
        messages.push(msg);
        console.log(`✅ Fetched message ${messages.length}/3`);
      } catch (error) {
        console.error(`❌ Failed to fetch message ${messageId}:`, error.message);
        process.exit(1);
      }
    }

    // 2. Extract season number from first message
    const firstContent = messages[0].content;
    const seasonMatch = firstContent.match(/SEASON (\d+)/);
    const seasonNumber = seasonMatch ? parseInt(seasonMatch[1]) : 158;
    console.log(`\n📅 Detected season: ${seasonNumber}`);

    // 3. Extract all players from all 3 messages
    console.log('\n📊 Extracting players from messages...');
    const allPlayers = [];
    
    allPlayers.push(...extractPlayersFromMessage(messages[0].content, 'RGR'));
    allPlayers.push(...extractPlayersFromMessage(messages[1].content, 'OTL'));
    allPlayers.push(...extractPlayersFromMessage(messages[2].content, 'RND'));
    
    console.log(`✅ Extracted ${allPlayers.length} players total`);
    console.log(`   RGR: ${allPlayers.filter(p => p.targetClan === 'RGR' && !p.isWildcard).length}`);
    console.log(`   OTL: ${allPlayers.filter(p => p.targetClan === 'OTL' && !p.isWildcard).length}`);
    console.log(`   RND: ${allPlayers.filter(p => p.targetClan === 'RND' && !p.isWildcard).length}`);
    console.log(`   WILDCARDS: ${allPlayers.filter(p => p.isWildcard).length}`);
    console.log(`   With ✅: ${allPlayers.filter(p => p.isDone).length}`);

    // 4. Rebuild the 3 messages
    console.log('\n🔨 Rebuilding messages...');
    const newMessages = [
      rebuildMessage(allPlayers, 'RGR', seasonNumber, true, false),
      rebuildMessage(allPlayers, 'OTL', seasonNumber, false, false),
      rebuildMessage(allPlayers, 'RND', seasonNumber, false, true)
    ];

    console.log(`\n📝 New message sizes:`);
    console.log(`   Message 1 (RGR): ${newMessages[0].length} chars`);
    console.log(`   Message 2 (OTL): ${newMessages[1].length} chars`);
    console.log(`   Message 3 (RND+Footer): ${newMessages[2].length} chars`);

    // 5. Update the 3 messages
    for (let i = 0; i < 3; i++) {
      try {
        console.log(`\n📤 Updating message ${i + 1}/3...`);
        await messages[i].edit({
          content: newMessages[i],
          allowedMentions: { parse: ['users'] }
        });
        console.log(`✅ Message ${i + 1} updated successfully`);
      } catch (error) {
        console.error(`❌ Failed to update message ${i + 1}:`, error.message);
      }
    }

    const doneCount = allPlayers.filter(p => p.isDone).length;
    console.log('\n✅ Restore completed!');
    console.log(`   Total players: ${allPlayers.length}`);
    console.log(`   Preserved checkmarks: ${doneCount}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during restore:', error);
    process.exit(1);
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

// Login and run
client.once('ready', async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  await restoreMessages();
});

client.login(process.env.DISCORD_TOKEN);
