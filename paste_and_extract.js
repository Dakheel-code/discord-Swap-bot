/**
 * Script to extract Discord IDs from pasted message content
 * 
 * INSTRUCTIONS:
 * 1. Copy the content of the DM message (1454413448195735618)
 * 2. Paste it below in the MESSAGE_CONTENT variable
 * 3. Run: node paste_and_extract.js
 */

import { Client, GatewayIntentBits } from 'discord.js';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

// PASTE THE MESSAGE CONTENT HERE (between the backticks):
const MESSAGE_CONTENT = `
PASTE YOUR MESSAGE CONTENT HERE
`;

const CHANNEL_ID = '1037060250701922405';
const MESSAGE_IDS = [
  '1454308028223590422',
  '1454308033432912033',
  '1454308036075065396'
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function extractMentionsAndNames() {
  console.log('📊 Extracting Discord IDs and player names...');
  
  const lines = MESSAGE_CONTENT.split('\n');
  const playerData = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('**') || trimmed.startsWith('─') || trimmed.startsWith('SWAP LIST')) continue;

    // Extract mention <@ID>
    const mentionMatch = trimmed.match(/<@!?(\d+)>/);
    if (mentionMatch) {
      const mention = mentionMatch[0];
      const userId = mentionMatch[1];
      
      // Extract name (everything after mention, before trophies)
      let afterMention = trimmed.replace(mention, '').trim();
      
      // Extract trophies (last number in the line)
      const trophiesMatch = afterMention.match(/(\d+)\s*$/);
      let trophies = null;
      let name = afterMention;
      
      if (trophiesMatch) {
        trophies = trophiesMatch[1];
        name = afterMention.replace(trophiesMatch[0], '').trim();
      }
      
      // Determine clan from context
      let clan = 'Unknown';
      if (trimmed.includes('RGR') || playerData.length < 16) clan = 'RGR';
      else if (trimmed.includes('OTL') || playerData.length < 34) clan = 'OTL';
      else clan = 'RND';
      
      playerData.push({
        mention: mention,
        userId: userId,
        name: name || 'Unknown',
        trophies: trophies,
        clan: clan
      });
    }
  }
  
  console.log(`✅ Extracted ${playerData.length} players with Discord IDs`);
  
  // Save to JSON
  fs.writeFileSync('./extracted_players.json', JSON.stringify(playerData, null, 2));
  console.log('💾 Saved to extracted_players.json');
  
  return playerData;
}

function buildMessagesWithMentions(playerData) {
  const rgrPlayers = playerData.filter(p => p.clan === 'RGR');
  const otlPlayers = playerData.filter(p => p.clan === 'OTL');
  const rndPlayers = playerData.filter(p => p.clan === 'RND');
  
  console.log(`\n📊 Distribution:`);
  console.log(`   RGR: ${rgrPlayers.length} players`);
  console.log(`   OTL: ${otlPlayers.length} players`);
  console.log(`   RND: ${rndPlayers.length} players`);
  
  // Message 1: RGR
  let msg1 = `**# <:RGR:1238937013940523008> SWAP LIST SEASON 158 <:RGR:1238937013940523008>**\n\n`;
  msg1 += `**## to RGR (${rgrPlayers.length})**\n`;
  rgrPlayers.forEach(p => {
    msg1 += `${p.mention}`;
    if (p.name && p.name !== 'Unknown') msg1 += ` ${p.name}`;
    if (p.trophies) msg1 += ` ${p.trophies}`;
    msg1 += '\n';
  });
  
  // Message 2: OTL
  let msg2 = `**## to OTL (${otlPlayers.length})**\n`;
  otlPlayers.forEach(p => {
    msg2 += `${p.mention}`;
    if (p.name && p.name !== 'Unknown') msg2 += ` ${p.name}`;
    if (p.trophies) msg2 += ` ${p.trophies}`;
    msg2 += '\n';
  });
  
  // Message 3: RND + Footer
  let msg3 = `**## to RND (${rndPlayers.length})**\n`;
  rndPlayers.forEach(p => {
    msg3 += `${p.mention}`;
    if (p.name && p.name !== 'Unknown') msg3 += ` ${p.name}`;
    if (p.trophies) msg3 += ` ${p.trophies}`;
    msg3 += '\n';
  });
  
  msg3 += '\n---\n\n';
  msg3 += 'Stop: ❌  Hold: ✋  Done: ✅\n\n';
  msg3 += '**IF SOMEONE IN __RGR OR OTL__ CAN\'T PLAY AT RESET, PLEASE CONTACT LEADERSHIP!**\n\n';
  msg3 += '**AND DON\'T FORGET TO HIT MANTICORE BEFORE YOU MOVE!**\n\n';
  msg3 += ':exclamation: **18-HOUR-RULE** :exclamation:\n';
  msg3 += '__Anyone on the swap list who hasn\'t moved within 18 hours after reset will be automatically kicked from their current clan, replaced and must apply on their own to RND.__\n';
  
  return [msg1, msg2, msg3];
}

async function updateMessages() {
  try {
    console.log('🔄 Starting extraction and update...\n');
    
    if (MESSAGE_CONTENT.includes('PASTE YOUR MESSAGE CONTENT HERE')) {
      console.error('❌ Please paste the message content first!');
      console.log('\n📝 Instructions:');
      console.log('1. Open paste_and_extract.js');
      console.log('2. Find MESSAGE_CONTENT variable');
      console.log('3. Replace "PASTE YOUR MESSAGE CONTENT HERE" with the actual message');
      console.log('4. Run: node paste_and_extract.js');
      process.exit(1);
    }
    
    const playerData = extractMentionsAndNames();
    
    if (playerData.length === 0) {
      console.error('❌ No players found in message content');
      process.exit(1);
    }
    
    const messages = buildMessagesWithMentions(playerData);
    
    console.log(`\n📝 Message sizes:`);
    console.log(`   Message 1 (RGR): ${messages[0].length} chars`);
    console.log(`   Message 2 (OTL): ${messages[1].length} chars`);
    console.log(`   Message 3 (RND): ${messages[2].length} chars`);
    
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) {
      console.error('❌ Could not fetch channel');
      process.exit(1);
    }
    
    for (let i = 0; i < 3; i++) {
      try {
        console.log(`\n📤 Updating message ${i + 1}/3...`);
        const msg = await channel.messages.fetch(MESSAGE_IDS[i]);
        await msg.edit({
          content: messages[i],
          allowedMentions: { parse: ['users'] }
        });
        console.log(`✅ Message ${i + 1} updated with proper Discord mentions`);
      } catch (error) {
        console.error(`❌ Failed to update message ${i + 1}:`, error.message);
      }
    }
    
    console.log('\n✅ Update completed!');
    console.log(`   Total players: ${playerData.length}`);
    console.log(`   All players now have proper Discord mentions`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

client.once('ready', async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  await updateMessages();
});

client.login(process.env.DISCORD_TOKEN);
