import { initializeSheetsClient, fetchPlayersDataWithDiscordNames } from './src/sheets.js';

async function analyzePlayerDistribution() {
  await initializeSheetsClient();
  const players = await fetchPlayersDataWithDiscordNames();
  
  // ترتيب اللاعبين حسب الكؤوس (تنازلياً)
  const sortedPlayers = [...players].sort((a, b) => {
    const trophiesA = parseInt(a.Trophies) || 0;
    const trophiesB = parseInt(b.Trophies) || 0;
    return trophiesB - trophiesA;
  });
  
  // تصنيف اللاعبين حسب التوزيع الصحيح
  const analysis = {
    RGR: { automatic: [], manual_in: [], manual_out: [], hold: [] },
    OTL: { automatic: [], manual_in: [], manual_out: [], hold: [] },
    RND: { automatic: [], manual_in: [], manual_out: [], hold: [] },
    Hold: []
  };
  
  // معالجة الانتقالات اليدوية أولاً
  const manualMoves = new Map(); // playerName -> targetClan
  const holdPlayers = new Set();
  
  sortedPlayers.forEach(player => {
    const action = (player.Action || '').trim();
    const name = player.OriginalName || player.Name || 'Unknown';
    
    if (action === 'Hold') {
      holdPlayers.add(name);
    } else if (action && ['RGR', 'OTL', 'RND'].includes(action)) {
      manualMoves.set(name, action);
    }
  });
  
  // حساب عدد اللاعبين في Hold لكل كلان أولاً
  const holdCountPerClan = { RGR: 0, OTL: 0, RND: 0 };
  const manualMovesCount = { RGR: 0, OTL: 0, RND: 0 };
  
  sortedPlayers.forEach(player => {
    const currentClan = player.Clan || 'Unknown';
    const action = (player.Action || '').trim();
    
    if (action === 'Hold' && holdCountPerClan[currentClan] !== undefined) {
      holdCountPerClan[currentClan]++;
    } else if (action && ['RGR', 'OTL', 'RND'].includes(action)) {
      if (manualMovesCount[action] !== undefined) {
        manualMovesCount[action]++;
      }
    }
  });
  
  console.log('📊 Hold count per clan:', holdCountPerClan);
  console.log('📊 Manual moves count:', manualMovesCount);
  
  // توزيع اللاعبين مع الأخذ بعين الاعتبار Hold
  let rgrCount = holdCountPerClan.RGR; // ابدأ بعدد Hold
  let otlCount = holdCountPerClan.OTL;
  let rndCount = holdCountPerClan.RND;
  
  sortedPlayers.forEach((player, index) => {
    const currentClan = player.Clan || 'Unknown';
    const action = (player.Action || '').trim();
    const name = player.OriginalName || player.Name || 'Unknown';
    const trophies = player.Trophies || '0';
    
    const playerInfo = {
      name,
      trophies,
      currentClan,
      action,
      rank: index + 1,
      discordId: player['Discord-ID'] || 'N/A'
    };
    
    // تحديد الكلان المستهدف
    let targetClan = null;
    
    if (action === 'Hold') {
      // يبقى في كلانه الحالي ويشغل مكاناً من الـ 50
      targetClan = currentClan;
      analysis.Hold.push(playerInfo);
      if (analysis[currentClan]) {
        analysis[currentClan].hold.push(playerInfo);
      }
      // لا نزيد العداد لأنه تم احتسابه مسبقاً
    } else if (action && ['RGR', 'OTL', 'RND'].includes(action)) {
      // انتقال يدوي
      targetClan = action;
      if (analysis[action]) {
        analysis[action].manual_in.push(playerInfo);
      }
      if (currentClan !== action && analysis[currentClan]) {
        analysis[currentClan].manual_out.push(playerInfo);
      }
      // لا نزيد العداد للانتقالات اليدوية
    } else {
      // توزيع تلقائي حسب الترتيب
      if (rgrCount < 50) {
        targetClan = 'RGR';
        rgrCount++;
        analysis.RGR.automatic.push(playerInfo);
      } else if (otlCount < 50) {
        targetClan = 'OTL';
        otlCount++;
        analysis.OTL.automatic.push(playerInfo);
      } else {
        targetClan = 'RND';
        rndCount++;
        analysis.RND.automatic.push(playerInfo);
      }
    }
    
    playerInfo.targetClan = targetClan;
  });
  
  // طباعة التحليل
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📊 تحليل توزيع اللاعبين - حسب الكؤوس');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  ['RGR', 'OTL', 'RND'].forEach(clan => {
    const data = analysis[clan];
    const automaticCount = data.automatic.length;
    const manualInCount = data.manual_in.length;
    const manualOutCount = data.manual_out.length;
    const holdCount = data.hold.length;
    const totalFinal = automaticCount + manualInCount + holdCount;
    
    console.log(`\n🏰 ═══ ${clan} ═══`);
    console.log(`📍 إجمالي اللاعبين النهائي: ${totalFinal} لاعب`);
    console.log('─────────────────────────────────────────────────────────────');
    
    // اللاعبين التلقائيين (حسب الترتيب)
    if (data.automatic.length > 0) {
      console.log(`\n✅ اللاعبين (توزيع تلقائي حسب الكؤوس) - ${data.automatic.length} لاعب:`);
      data.automatic.forEach((p, i) => {
        const moved = p.currentClan !== clan ? ` [من ${p.currentClan}]` : '';
        console.log(`   ${i + 1}. #${p.rank} ${p.name} - ${p.trophies} 🏆${moved}`);
      });
    }
    
    // الانتقالات اليدوية القادمة
    if (data.manual_in.length > 0) {
      console.log(`\n🟢 انتقالات يدوية قادمة إلى ${clan} - ${data.manual_in.length} لاعب:`);
      data.manual_in.forEach((p, i) => {
        console.log(`   ${i + 1}. #${p.rank} ${p.name} - ${p.trophies} 🏆 [Action: ${p.action}] ← من ${p.currentClan}`);
      });
    }
    
    // اللاعبين في Hold
    if (data.hold.length > 0) {
      console.log(`\n⏸️  اللاعبين الباقين (Hold) - ${data.hold.length} لاعب:`);
      data.hold.forEach((p, i) => {
        console.log(`   ${i + 1}. #${p.rank} ${p.name} - ${p.trophies} 🏆 [Hold]`);
      });
    }
    
    // الانتقالات اليدوية المغادرة
    if (data.manual_out.length > 0) {
      console.log(`\n🔴 انتقالات يدوية مغادرة من ${clan} - ${data.manual_out.length} لاعب:`);
      data.manual_out.forEach((p, i) => {
        console.log(`   ${i + 1}. #${p.rank} ${p.name} - ${p.trophies} 🏆 → إلى ${p.action}`);
      });
    }
  });
  
  // اللاعبين في Hold
  if (analysis.Hold.length > 0) {
    console.log(`\n\n⏸️  ═══ ملخص اللاعبين في Hold (${analysis.Hold.length}) ═══`);
    analysis.Hold.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.name} - ${p.trophies} 🏆 [يبقى في ${p.currentClan}]`);
    });
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════\n');
  
  // ملخص إحصائي
  console.log('📈 الملخص الإحصائي النهائي:');
  console.log('─────────────────────────────────────────────────────────────');
  ['RGR', 'OTL', 'RND'].forEach(clan => {
    const data = analysis[clan];
    const total = data.automatic.length + data.manual_in.length + data.hold.length;
    console.log(`${clan}: ${total} لاعب (${data.automatic.length} تلقائي + ${data.manual_in.length} يدوي + ${data.hold.length} hold)`);
  });
  console.log(`\nإجمالي اللاعبين: ${sortedPlayers.length}`);
  console.log(`اللاعبين في Hold: ${analysis.Hold.length}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
}

analyzePlayerDistribution().catch(console.error);
