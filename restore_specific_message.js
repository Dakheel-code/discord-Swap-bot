/**
 * Script to restore a specific distribution message and split it into 3 messages
 * With the modification: TNT stays in RND, Meadows moves to OTL
 */

import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

const CHANNEL_ID = '1037060250701922405';
const MESSAGE_IDS = [
  '1454308028223590422', // Message 1: RGR
  '1454308033432912033', // Message 2: OTL
  '1454308036075065396'  // Message 3: RND + WILDCARDS
];

const SEASON_NUMBER = 158;

// The distribution data
const distribution = {
  RGR: [
    { mention: '@Dakheel  ᴿᴳᴿ', trophies: '7480' },
    { mention: '@jules', trophies: '7410' },
    { mention: '@HardLuckᴿᴳᴿ', trophies: '7408' },
    { mention: '@RAGE', trophies: '7401' },
    { mention: '@Crashtestdummy (C)/ CRaSH', trophies: '7401' },
    { mention: '@Unique', trophies: '7390' },
    { mention: '@PointyTactic★', trophies: '7377' },
    { mention: '@🪦ᴿʸᶠᴳ R.I.P ᴿᴳᴿ🪦', trophies: '7370' },
    { mention: '@•••ALEX•••RGR•••', trophies: '7362' },
    { mention: '@mannu', trophies: '7354' },
    { mention: '@ZenEnso', trophies: '7351' },
    { mention: '<@ᴿʸᶠᴳF.Krugerᴿᴳᴿ>', trophies: '7305' },
    { mention: '@RUS Urbanᴿᴳᴿ', trophies: '7300' },
    { mention: '@Chipalas', trophies: '7300' },
    { mention: '@PåtRîöT★', trophies: '7297' },
    { mention: '@VladCJ', trophies: '7296' }
  ],
  OTL: [
    { mention: '@こぶCob', trophies: '7291' },
    { mention: '@Vis ★', trophies: '7282' },
    { mention: '@vessel29', trophies: '7277' },
    { mention: '@UwUssassin', trophies: '7276' },
    { mention: '@Mantza ★', trophies: '7275' },
    { mention: '@Big Papi  RGR', trophies: '7274' },
    { mention: '@Spearmint', trophies: '7266' },
    { mention: '@Ritzkraken', trophies: '7259' },
    { mention: '@Dr. Jay', trophies: '7231' },
    { mention: '@_vuongquang_', trophies: '7226' },
    { mention: '@kdubya44 (Kenny)', trophies: '7224' },
    { mention: '@pedropenduko8878', trophies: '7071' },
    { mention: '@Falcon ᴿᴳᴿ', trophies: '7064' },
    { mention: '@vycmar', trophies: '7029' },
    { mention: '@Patrick', trophies: '6998' },
    { mention: '@SmoothieChew ᴿᴳᴿ', trophies: '6992' },
    { mention: '@Shadowburn', trophies: '6960' },
    // Modified: Meadows moves to OTL instead of RND
    { mention: '<@Meadowsᴿᴳᴿ>', trophies: '6915' }
  ],
  RND: [
    { mention: '@SpaceM', trophies: '6861' },
    { mention: '@Brain', trophies: '6835' },
    { mention: '@Boandlkramer ᴿᴳᴿ', trophies: '6800' },
    { mention: '@Chris', trophies: '6771' },
    { mention: '@Glennieboy', trophies: '6685' },
    { mention: '@𝐢𝐞𝐧𝐜𝐢', trophies: '6609' },
    { mention: '@Tejimon 🍎 RGR', trophies: '3585' }
  ],
  WILDCARDS: [
    { mention: '@jon snow', action: 'stays in OTL' },
    { mention: '@Haíry J', action: 'stays in RND' },
    { mention: '@Armando', action: 'stays in RND' },
    { mention: '@DeadmanWalking', action: 'moves to RND' },
    { mention: '<@NO MERCY ᴿᴳᴿ>', action: 'stays in RND' },
    { mention: '@Ben Dover', action: 'stays in RND' },
    // Modified: TNT stays in RND instead of moving to OTL
    { mention: '@TNT ᴿᴳᴿ ★', action: 'stays in RND' }
  ]
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function buildMessage1() {
  let msg = `**# <:RGR:1238937013940523008> SWAP LIST SEASON ${SEASON_NUMBER} <:RGR:1238937013940523008>**\n\n`;
  msg += `**## to RGR (${distribution.RGR.length})**\n`;
  
  distribution.RGR.forEach(player => {
    msg += `${player.mention} ${player.trophies}\n`;
  });
  
  return msg;
}

function buildMessage2() {
  let msg = `**## to OTL (${distribution.OTL.length})**\n`;
  
  distribution.OTL.forEach(player => {
    msg += `${player.mention} ${player.trophies}\n`;
  });
  
  return msg;
}

function buildMessage3() {
  let msg = `**## to RND (${distribution.RND.length})**\n`;
  
  distribution.RND.forEach(player => {
    msg += `${player.mention} ${player.trophies}\n`;
  });
  
  msg += '\n';
  msg += `**# WILDCARDS (${distribution.WILDCARDS.length})**\n`;
  
  distribution.WILDCARDS.forEach(player => {
    msg += `${player.mention} ${player.action}\n`;
  });
  
  msg += '\n---\n\n';
  msg += 'Stop: ❌  Hold: ✋  Done: ✅\n\n';
  msg += '**IF SOMEONE IN __RGR OR OTL__ CAN\'T PLAY AT RESET, PLEASE CONTACT LEADERSHIP!**\n\n';
  msg += '**AND DON\'T FORGET TO HIT MANTICORE BEFORE YOU MOVE!**\n\n';
  msg += ':exclamation: **18-HOUR-RULE** :exclamation:\n';
  msg += '__Anyone on the swap list who hasn\'t moved within 18 hours after reset will be automatically kicked from their current clan, replaced and must apply on their own to RND.__\n';
  
  return msg;
}

async function restoreMessages() {
  try {
    console.log('🔄 Starting restore with modifications...');
    console.log('   - TNT stays in RND (added to WILDCARDS)');
    console.log('   - Meadows moves to OTL (moved from RND)');

    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel) {
      console.error('❌ Could not fetch channel');
      process.exit(1);
    }

    const messages = [
      buildMessage1(),
      buildMessage2(),
      buildMessage3()
    ];

    console.log('\n📝 Message sizes:');
    console.log(`   Message 1 (RGR): ${messages[0].length} chars`);
    console.log(`   Message 2 (OTL): ${messages[1].length} chars`);
    console.log(`   Message 3 (RND+WILDCARDS): ${messages[2].length} chars`);

    console.log('\n📊 Distribution:');
    console.log(`   RGR: ${distribution.RGR.length} players`);
    console.log(`   OTL: ${distribution.OTL.length} players`);
    console.log(`   RND: ${distribution.RND.length} players`);
    console.log(`   WILDCARDS: ${distribution.WILDCARDS.length} players`);

    for (let i = 0; i < 3; i++) {
      try {
        console.log(`\n📤 Updating message ${i + 1}/3...`);
        const msg = await channel.messages.fetch(MESSAGE_IDS[i]);
        await msg.edit({
          content: messages[i],
          allowedMentions: { parse: ['users'] }
        });
        console.log(`✅ Message ${i + 1} updated successfully`);
      } catch (error) {
        console.error(`❌ Failed to update message ${i + 1}:`, error.message);
      }
    }

    console.log('\n✅ Restore completed!');
    console.log('   Total players: ' + (distribution.RGR.length + distribution.OTL.length + distribution.RND.length + distribution.WILDCARDS.length));
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during restore:', error);
    process.exit(1);
  }
}

client.once('ready', async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  await restoreMessages();
});

client.login(process.env.DISCORD_TOKEN);
