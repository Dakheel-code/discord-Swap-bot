/**
 * Final restore script with real Discord IDs
 * Modifications: TNT stays in RND, Meadows moves to OTL
 */

import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

const CHANNEL_ID = '1037060250701922405';
const MESSAGE_IDS = [
  '1454308028223590422',
  '1454308033432912033',
  '1454308036075065396'
];

const distribution = {
  RGR: [
    { mention: '<@691802404244422688>', trophies: '7480' },
    { mention: '<@858753170934333452>', trophies: '7410' },
    { mention: '<@782304608780812299>', trophies: '7408' },
    { mention: '<@942383653269430323>', trophies: '7401' },
    { mention: '<@796401163611799583>', trophies: '7401' },
    { mention: '<@1069730891536011265>', trophies: '7390' },
    { mention: '<@1007800520288776233>', trophies: '7377' },
    { mention: '<@767810845035593748>', trophies: '7370' },
    { mention: '<@788139332032135228>', trophies: '7362' },
    { mention: '<@800411701673328740>', trophies: '7354' },
    { mention: '<@934898291764776960>', trophies: '7351' },
    { mention: '<@723500619532599318>', trophies: '7300' },
    { mention: '<@730866031442264105>', trophies: '7300' },
    { mention: '<@408666607880110090>', trophies: '7297' },
    { mention: '<@834801274909229057>', trophies: '7296' }
  ],
  OTL: [
    { mention: '<@850677075969835030>', trophies: '7291' },
    { mention: '<@731336517003509830>', trophies: '7282' },
    { mention: '<@912487695211692032>', trophies: '7277' },
    { mention: '<@1124179496241733643>', trophies: '7276' },
    { mention: '<@785520433172185108>', trophies: '7275' },
    { mention: '<@894747151089930251>', trophies: '7274' },
    { mention: '<@860212893105520660>', trophies: '7266' },
    { mention: '<@772256730176159754>', trophies: '7259' },
    { mention: '<@714399683426123777>', trophies: '7231' },
    { mention: '<@785415411955925004>', trophies: '7226' },
    { mention: '<@867013014208905216>', trophies: '7224' },
    { mention: '<@780549187946807318>', trophies: '7071' },
    { mention: '<@831152550597099570>', trophies: '7064' },
    { mention: '<@1011535836686340096>', trophies: '7029' },
    { mention: '<@873289660598726686>', trophies: '6998' },
    { mention: '<@1131177358041284629>', trophies: '6992' },
    { mention: '<@147857664775290880>', trophies: '6960' }
  ],
  RND: [
    { mention: '<@922239894061993985>', trophies: '6861' },
    { mention: '<@768933039820111882>', trophies: '6835' },
    { mention: '<@876510202818609212>', trophies: '6800' },
    { mention: '<@860307204930011146>', trophies: '6771' },
    { mention: '<@627066456181440522>', trophies: '6685' },
    { mention: '<@438315524552654859>', trophies: '6609' },
    { mention: '<@913037835823632394>', trophies: '3585' }
  ],
  WILDCARDS: [
    { mention: '<@742461440371458148>', action: 'stays in OTL' },
    { mention: '<@911688686188499005>', action: 'stays in RND' },
    { mention: '<@789673654987915266>', action: 'stays in RND' },
    { mention: '<@863540237778550785>', action: 'moves to RND' },
    { mention: '<@810199363259072552>', action: 'stays in RND' },
    { mention: '<@830482933030584341>', action: 'stays in RND' } // TNT stays in RND
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
  let msg = `**# <:RGR:1238937013940523008> SWAP LIST SEASON 158 <:RGR:1238937013940523008>**\n\n`;
  msg += `**## to RGR (${distribution.RGR.length})**\n`;
  distribution.RGR.forEach(player => {
    msg += `• ${player.mention} ${player.trophies}\n`;
  });
  return msg;
}

function buildMessage2() {
  let msg = `**## to OTL (${distribution.OTL.length})**\n`;
  distribution.OTL.forEach(player => {
    msg += `• ${player.mention} ${player.trophies}\n`;
  });
  return msg;
}

function buildMessage3() {
  let msg = `**## to RND (${distribution.RND.length})**\n`;
  distribution.RND.forEach(player => {
    msg += `• ${player.mention} ${player.trophies}\n`;
  });
  
  msg += '\n';
  msg += `**# WILDCARDS (${distribution.WILDCARDS.length})**\n`;
  distribution.WILDCARDS.forEach(player => {
    msg += `• ${player.mention} ${player.action}\n`;
  });
  
  msg += '\n---\n\n';
  msg += 'Stop: ❌  Hold: ✋  Done: ✅\n\n';
  msg += '**IF SOMEONE IN __RGR OR OTL__ CAN\'T PLAY AT RESET, PLEASE CONTACT LEADERSHIP!**\n\n';
  msg += '**AND DON\'T FORGET TO HIT MANTICORE BEFORE YOU MOVE!**\n\n';
  msg += ':exclamation: **18-HOUR-RULE** :exclamation:\n';
  msg += '__Anyone on the swap list who hasn\'t moved within 18 hours after reset will be automatically kicked from their current clan, replaced and must apply on their own to RND.__\n';
  
  return msg;
}

async function updateMessages() {
  try {
    console.log('🔄 Starting final restore with real Discord IDs...');
    console.log('   ✅ TNT stays in RND (in WILDCARDS)');
    console.log('   ✅ Meadows removed from RND');
    console.log('   ✅ All players have real Discord mentions');

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
    console.log(`   Total: ${distribution.RGR.length + distribution.OTL.length + distribution.RND.length + distribution.WILDCARDS.length} players`);

    for (let i = 0; i < 3; i++) {
      try {
        console.log(`\n📤 Updating message ${i + 1}/3...`);
        const msg = await channel.messages.fetch(MESSAGE_IDS[i]);
        await msg.edit({
          content: messages[i],
          allowedMentions: { parse: ['users'] }
        });
        console.log(`✅ Message ${i + 1} updated with real Discord mentions`);
      } catch (error) {
        console.error(`❌ Failed to update message ${i + 1}:`, error.message);
      }
    }

    console.log('\n✅ Final restore completed!');
    console.log('   All players now have proper Discord mentions');
    console.log('   Players will be notified when mentioned');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during restore:', error);
    process.exit(1);
  }
}

client.once('ready', async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  await updateMessages();
});

client.login(process.env.DISCORD_TOKEN);
