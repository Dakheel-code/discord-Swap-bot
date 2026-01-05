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

const GUILD_ID = '789699461672730656';
const CHANNEL_ID = '1037060250701922405';

const MESSAGES = [
  {
    id: '1454308028223590422',
    content: `<:RGR:1238937013940523008> **SWAP LIST SEASON 158** <:RGR:1238937013940523008>

**to RGR (16):**
- <@691802404244422688> 7480 ✅
- <@858753170934333452> 7410 ✅
- <@782304608780812299> 7408 ✅
- <@942383653269430323> 7401 ✅
- <@796401163611799583> 7401 ✅
- <@1069730891536011265> 7390 ✅
- <@1007800520288776233> 7377 ✅
- <@767810845035593748> 7370 ✅
- <@788139332032135228> 7362 ✅
- <@800411701673328740> 7354 ✅
- <@934898291764776960> 7351 ✅
- <@ᴿʸᶠᴳF.Krugerᴿᴳᴿ> 7305 ✅
- <@723500619532599318> 7300 ✅
- <@730866031442264105> 7300 ✅
- <@408666607880110090> 7297 ✅
- <@834801274909229057> 7296 ✅`
  },
  {
    id: '1454308033432912033',
    content: `**to OTL (18):**
- <@850677075969835030> 7291
- <@731336517003509830> 7282 ✅
- <@912487695211692032> 7277 ✅
- <@1124179496241733643> 7276 ✅
- <@785520433172185108> 7275 ✅
- <@894747151089930251> 7274 ✅
- <@860212893105520660> 7266 ✅
- <@772256730176159754> 7259 ✅
- <@714399683426123777> 7231 ✅
- <@785415411955925004> 7226 ✅
- <@867013014208905216> 7224 ✅
- <@780549187946807318> 7071 ✅
- <@831152550597099570> 7064 ✅
- <@1011535836686340096> 7029 ✅
- <@873289660598726686> 6998 ✅
- <@1131177358041284629> 6992 ✅
- <@147857664775290880> 6960
- <@830482933030584341> 6918 ✅`
  },
  {
    id: '1454308036075065396',
    content: `**to RND (8):**
- <@Meadowsᴿᴳᴿ> 6915
- <@922239894061993985> 6861 ✅
- <@768933039820111882> 6835 ✅
- <@876510202818609212> 6800 ✅
- <@860307204930011146> 6771 ✅
- <@627066456181440522> 6685 ✅
- <@438315524552654859> 6609 ✅
- <@913037835823632394> 3585 ✅

**WILDCARDS (6):**
- <@742461440371458148> stays in OTL ✅
- <@911688686188499005> stays in RND ✅
- <@789673654987915266> stays in RND ✅
- <@863540237778550785> moves to RND ✅
- <@NO MERCY ᴿᴳᴿ> stays in RND ✅
- <@810199363259072552> stays in RND ✅

Stop: ❌  Hold: ✋  Done: ✅

**IF SOMEONE IN __RGR OR OTL__ CAN'T PLAY AT RESET, PLEASE CONTACT LEADERSHIP!**

AND DON'T FORGET TO HIT MANTICORE BEFORE YOU MOVE!

❗**18-HOUR-RULE**❗
__Anyone on the swap list who hasn't moved within 18 hours after reset will be automatically kicked from their current clan, replaced and must apply on their own to RND.__`
  }
];

client.once('ready', async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    console.log(`✅ Found guild: ${guild.name}`);
    
    const channel = await guild.channels.fetch(CHANNEL_ID);
    console.log(`✅ Found channel: ${channel.name}`);
    
    for (let i = 0; i < MESSAGES.length; i++) {
      const { id, content } = MESSAGES[i];
      try {
        const message = await channel.messages.fetch(id);
        await message.edit({
          content: content,
          allowedMentions: { parse: ['users'] }
        });
        console.log(`✅ Updated message ${i + 1}/${MESSAGES.length} (ID: ${id})`);
      } catch (error) {
        console.error(`❌ Failed to update message ${id}:`, error.message);
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
