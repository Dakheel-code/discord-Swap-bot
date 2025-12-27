import { Client, GatewayIntentBits } from 'discord.js';
import { initializeSheetsClient, fetchPlayersDataWithDiscordNames } from './src/sheets.js';
import { config } from './src/config.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

// معرفات الرسائل والقناة
const MESSAGE_IDS = [
  '1454308028223590422',
  '1454308033432912033',
  '1454308036075065396'
];
const CHANNEL_ID = '1037060250701922405';
const SEASON_NUMBER = 157;

async function generateCorrectDistribution() {
  await initializeSheetsClient();
  const players = await fetchPlayersDataWithDiscordNames();
  
  console.log(`📊 Total players: ${players.length}`);
  
  // ترتيب اللاعبين حسب الكؤوس (تنازلياً)
  const sortedPlayers = [...players].sort((a, b) => {
    const trophiesA = parseInt(a.Trophies) || 0;
    const trophiesB = parseInt(b.Trophies) || 0;
    return trophiesB - trophiesA;
  });
  
  // حساب عدد اللاعبين في Hold لكل كلان
  const holdCountPerClan = { RGR: 0, OTL: 0, RND: 0 };
  
  sortedPlayers.forEach(player => {
    const currentClan = player.Clan || 'Unknown';
    const action = (player.Action || '').trim();
    
    if (action === 'Hold' && holdCountPerClan[currentClan] !== undefined) {
      holdCountPerClan[currentClan]++;
    }
  });
  
  console.log('📊 Hold count per clan:', holdCountPerClan);
  
  // التوزيع النهائي
  const distribution = {
    RGR: [],
    OTL: [],
    RND: [],
    WILDCARDS: []
  };
  
  let rgrCount = holdCountPerClan.RGR;
  let otlCount = holdCountPerClan.OTL;
  let rndCount = holdCountPerClan.RND;
  
  sortedPlayers.forEach((player, index) => {
    const currentClan = player.Clan || 'Unknown';
    const action = (player.Action || '').trim();
    const name = player.OriginalName || player.Name || 'Unknown';
    const mention = player.DiscordName || '';
    const trophies = player.Trophies || '0';
    
    const playerInfo = {
      name,
      mention,
      trophies,
      currentClan,
      action,
      rank: index + 1
    };
    
    let targetClan = null;
    
    if (action === 'Hold') {
      // Hold - يبقى في كلانه
      targetClan = currentClan;
      playerInfo.targetClan = currentClan;
      playerInfo.isHold = true;
      distribution.WILDCARDS.push(playerInfo);
    } else if (action && ['RGR', 'OTL', 'RND'].includes(action)) {
      // انتقال يدوي
      targetClan = action;
      playerInfo.targetClan = action;
      playerInfo.isHold = false;
      distribution.WILDCARDS.push(playerInfo);
    } else {
      // توزيع تلقائي
      if (rgrCount < 50) {
        targetClan = 'RGR';
        rgrCount++;
      } else if (otlCount < 50) {
        targetClan = 'OTL';
        otlCount++;
      } else {
        targetClan = 'RND';
        rndCount++;
      }
      
      // فقط أضف اللاعب إذا كان سينتقل
      if (currentClan !== targetClan) {
        playerInfo.targetClan = targetClan;
        distribution[targetClan].push(playerInfo);
      }
    }
  });
  
  console.log('📊 Final distribution:');
  console.log(`   RGR: ${distribution.RGR.length} moving (${rgrCount} total)`);
  console.log(`   OTL: ${distribution.OTL.length} moving (${otlCount} total)`);
  console.log(`   RND: ${distribution.RND.length} moving (${rndCount} total)`);
  console.log(`   WILDCARDS: ${distribution.WILDCARDS.length}`);
  
  return distribution;
}

function formatDistribution(distribution) {
  const messages = [];
  
  // الرسالة الأولى: RGR فقط
  let message1 = `**# :RGR: SWAP LIST SEASON ${SEASON_NUMBER} :RGR:**\n\n`;
  message1 += `**## to RGR (${distribution.RGR.length})**\n`;
  if (distribution.RGR.length > 0) {
    distribution.RGR.forEach(p => {
      const displayName = p.mention ? `${p.mention} • ${p.name}` : p.name;
      message1 += `› ${displayName} • **${p.trophies}**\n`;
    });
  } else {
    message1 += '_No players_\n';
  }
  messages.push(message1);
  
  // الرسالة الثانية: OTL فقط
  let message2 = `**## to OTL (${distribution.OTL.length})**\n`;
  if (distribution.OTL.length > 0) {
    distribution.OTL.forEach(p => {
      const displayName = p.mention ? `${p.mention} • ${p.name}` : p.name;
      message2 += `› ${displayName} • **${p.trophies}**\n`;
    });
  } else {
    message2 += '_No players_\n';
  }
  messages.push(message2);
  
  // الرسالة الثالثة: RND + WILDCARDS + Footer
  let message3 = `**## to RND (${distribution.RND.length})**\n`;
  if (distribution.RND.length > 0) {
    distribution.RND.forEach(p => {
      const displayName = p.mention ? `${p.mention} • ${p.name}` : p.name;
      message3 += `› ${displayName} • **${p.trophies}**\n`;
    });
  } else {
    message3 += '_No players_\n';
  }
  message3 += '\n';
  
  // WILDCARDS
  if (distribution.WILDCARDS.length > 0) {
    message3 += `**# WILDCARDS (${distribution.WILDCARDS.length})**\n`;
    distribution.WILDCARDS.forEach(p => {
      const displayName = p.mention ? `${p.mention} •${p.name}•` : `•${p.name}•`;
      let moveText = '';
      
      if (p.isHold) {
        moveText = `stays in **${p.targetClan}**`;
      } else if (p.currentClan === p.targetClan) {
        moveText = `stays in **${p.targetClan}**`;
      } else {
        moveText = `moves to **${p.targetClan}**`;
      }
      
      message3 += `${displayName} ${moveText}\n`;
    });
    message3 += '\n';
  }
  
  // Footer
  message3 += '---\n\n';
  message3 += 'Done: ✅\n\n';
  message3 += '**IF SOMEONE IN __RGR OR OTL__ CAN\'T PLAY AT RESET, PLEASE CONTACT LEADERSHIP!**\n\n';
  message3 += ':exclamation: **| 18-HOUR-RULE |** :exclamation:\n';
  message3 += '__Anyone on the swap list who hasn\'t moved within 18 hours after reset will be automatically kicked from their current clan, replaced and must apply on their own to RND.__\n';
  
  messages.push(message3);
  
  return messages;
}

function splitTextToChunks(text, maxLength = 2000) {
  const chunks = [];
  const lines = text.split('\n');
  let currentChunk = '';
  
  for (const line of lines) {
    if ((currentChunk + line + '\n').length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = '';
      }
      
      if (line.length > maxLength) {
        const words = line.split(' ');
        for (const word of words) {
          if ((currentChunk + word + ' ').length > maxLength) {
            chunks.push(currentChunk);
            currentChunk = word + ' ';
          } else {
            currentChunk += word + ' ';
          }
        }
      } else {
        currentChunk = line + '\n';
      }
    } else {
      currentChunk += line + '\n';
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk);
  }
  
  return chunks;
}

async function updateMessages() {
  try {
    console.log('🔄 Generating correct distribution...');
    const distribution = await generateCorrectDistribution();
    
    console.log('📝 Formatting distribution into 3 separate messages...');
    const messages = formatDistribution(distribution);
    console.log(`   Message 1 (RGR): ${messages[0].length} chars`);
    console.log(`   Message 2 (OTL): ${messages[1].length} chars`);
    console.log(`   Message 3 (RND+Footer): ${messages[2].length} chars`);
    
    if (messages.length !== MESSAGE_IDS.length) {
      console.warn(`⚠️ Warning: ${messages.length} messages but ${MESSAGE_IDS.length} message IDs`);
    }
    
    console.log('🔍 Fetching channel...');
    const channel = await client.channels.fetch(CHANNEL_ID);
    
    console.log('📨 Updating messages...');
    for (let i = 0; i < Math.min(messages.length, MESSAGE_IDS.length); i++) {
      try {
        const message = await channel.messages.fetch(MESSAGE_IDS[i]);
        await message.edit({ content: messages[i], allowedMentions: { parse: ['users'] } });
        console.log(`✅ Updated message ${i + 1}/${MESSAGE_IDS.length}`);
      } catch (error) {
        console.error(`❌ Failed to update message ${i + 1}: ${error.message}`);
      }
    }
    
    console.log('✅ All messages updated successfully!');
    console.log('📊 Summary:');
    console.log(`   - Message 1: RGR distribution only`);
    console.log(`   - Message 2: OTL distribution only`);
    console.log(`   - Message 3: RND + WILDCARDS + Footer`);
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

client.once('ready', () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  updateMessages();
});

client.login(config.discord.token);
