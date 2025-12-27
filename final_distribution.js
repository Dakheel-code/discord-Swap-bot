import { initializeSheetsClient, fetchPlayersDataWithDiscordNames } from './src/sheets.js';

async function generateFinalDistribution() {
  await initializeSheetsClient();
  const players = await fetchPlayersDataWithDiscordNames();
  
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
      // Hold - يُعرض في WILDCARDS أيضاً
      targetClan = currentClan;
      playerInfo.targetClan = currentClan;
      playerInfo.isHold = true;
      distribution.WILDCARDS.push(playerInfo);
    } else if (action && ['RGR', 'OTL', 'RND'].includes(action)) {
      // انتقال يدوي - يُعرض في WILDCARDS
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
      
      // فقط أضف اللاعب إذا كان سينتقل (ليس في نفس الكلان)
      if (currentClan !== targetClan) {
        playerInfo.targetClan = targetClan;
        distribution[targetClan].push(playerInfo);
      }
    }
  });
  
  // طباعة التوزيع النهائي
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📋 SWAP LIST - اللاعبين المطلوب انتقالهم فقط');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  // RGR
  if (distribution.RGR.length > 0) {
    console.log(`\n🏰 ═══ to RGR (${distribution.RGR.length}) ═══\n`);
    distribution.RGR.forEach((p, i) => {
      const displayName = p.mention ? `${p.mention} • ${p.name}` : p.name;
      console.log(`   ${i + 1}. ${displayName} • **${p.trophies}** [من ${p.currentClan}]`);
    });
  } else {
    console.log(`\n🏰 ═══ to RGR (0) ═══`);
    console.log('   _No players need to move_\n');
  }
  
  // OTL
  if (distribution.OTL.length > 0) {
    console.log(`\n🏰 ═══ to OTL (${distribution.OTL.length}) ═══\n`);
    distribution.OTL.forEach((p, i) => {
      const displayName = p.mention ? `${p.mention} • ${p.name}` : p.name;
      console.log(`   ${i + 1}. ${displayName} • **${p.trophies}** [من ${p.currentClan}]`);
    });
  } else {
    console.log(`\n🏰 ═══ to OTL (0) ═══`);
    console.log('   _No players need to move_\n');
  }
  
  // RND
  if (distribution.RND.length > 0) {
    console.log(`\n🏰 ═══ to RND (${distribution.RND.length}) ═══\n`);
    distribution.RND.forEach((p, i) => {
      const displayName = p.mention ? `${p.mention} • ${p.name}` : p.name;
      console.log(`   ${i + 1}. ${displayName} • **${p.trophies}** [من ${p.currentClan}]`);
    });
  } else {
    console.log(`\n🏰 ═══ to RND (0) ═══`);
    console.log('   _No players need to move_\n');
  }
  
  // WILDCARDS
  if (distribution.WILDCARDS.length > 0) {
    console.log(`\n\n🎯 ═══ WILDCARDS (${distribution.WILDCARDS.length}) ═══\n`);
    distribution.WILDCARDS.forEach((p, i) => {
      const displayName = p.mention ? `${p.mention} •${p.name}•` : `•${p.name}•`;
      let moveText = '';
      
      if (p.isHold) {
        moveText = `stays in **${p.targetClan}** [Hold]`;
      } else if (p.currentClan === p.targetClan) {
        moveText = `stays in **${p.targetClan}**`;
      } else {
        moveText = `moves to **${p.targetClan}**`;
      }
      
      console.log(`   ${i + 1}. ${displayName} ${moveText}`);
    });
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════\n');
  
  // الملخص
  const totalMoving = distribution.RGR.length + distribution.OTL.length + distribution.RND.length;
  const totalManual = distribution.WILDCARDS.length;
  
  console.log('📊 الملخص:');
  console.log('─────────────────────────────────────────────────────────────');
  console.log(`إجمالي اللاعبين المنتقلين (تلقائي): ${totalMoving}`);
  console.log(`  - إلى RGR: ${distribution.RGR.length}`);
  console.log(`  - إلى OTL: ${distribution.OTL.length}`);
  console.log(`  - إلى RND: ${distribution.RND.length}`);
  console.log(`\nانتقالات يدوية (WILDCARDS): ${totalManual}`);
  console.log(`إجمالي الانتقالات: ${totalMoving + totalManual}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  // إنشاء نص Discord
  console.log('\n📝 نص Discord للنسخ:\n');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  let discordText = '**# :RGR: SWAP LIST SEASON 157 :RGR:**\n\n';
  
  // RGR
  discordText += `**## to RGR (${distribution.RGR.length})**\n`;
  if (distribution.RGR.length > 0) {
    distribution.RGR.forEach(p => {
      const displayName = p.mention ? `${p.mention} • ${p.name}` : p.name;
      discordText += `› ${displayName} • **${p.trophies}**\n`;
    });
  } else {
    discordText += '_No players_\n';
  }
  discordText += '\n';
  
  // OTL
  discordText += `**## to OTL (${distribution.OTL.length})**\n`;
  if (distribution.OTL.length > 0) {
    distribution.OTL.forEach(p => {
      const displayName = p.mention ? `${p.mention} • ${p.name}` : p.name;
      discordText += `› ${displayName} • **${p.trophies}**\n`;
    });
  } else {
    discordText += '_No players_\n';
  }
  discordText += '\n';
  
  // RND
  discordText += `**## to RND (${distribution.RND.length})**\n`;
  if (distribution.RND.length > 0) {
    distribution.RND.forEach(p => {
      const displayName = p.mention ? `${p.mention} • ${p.name}` : p.name;
      discordText += `› ${displayName} • **${p.trophies}**\n`;
    });
  } else {
    discordText += '_No players_\n';
  }
  discordText += '\n';
  
  // WILDCARDS
  if (distribution.WILDCARDS.length > 0) {
    discordText += `**# WILDCARDS (${distribution.WILDCARDS.length})**\n`;
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
      
      discordText += `${displayName} ${moveText}\n`;
    });
    discordText += '\n';
  }
  
  discordText += '---\n\n';
  discordText += 'Done: ✅\n\n';
  discordText += '**IF SOMEONE IN __RGR OR OTL__ CAN\'T PLAY AT RESET, PLEASE CONTACT LEADERSHIP!**\n\n';
  discordText += ':exclamation: **| 18-HOUR-RULE |** :exclamation:\n';
  discordText += '__Anyone on the swap list who hasn\'t moved within 18 hours after reset will be automatically kicked from their current clan, replaced and must apply on their own to RND.__\n';
  
  console.log(discordText);
  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

generateFinalDistribution().catch(console.error);
