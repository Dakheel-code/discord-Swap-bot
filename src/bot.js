import { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType } from 'discord.js';
import { config } from './config.js';
import { commands } from './commands.js';
import { fetchPlayersData, fetchPlayersDataWithDiscordNames, getAvailableColumns, writeDiscordMapping, writePlayerAction, clearPlayerAction, clearAllPlayerActions, saveBotState, loadBotState, updateBotState, syncMasterCsvToFinal } from './sheets.js';
import { DistributionManager } from './distribution.js';
import fs from 'fs';

export class DiscordBot {
  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
      ],
    });

    this.distributionManager = new DistributionManager();
    this.playersData = [];
    this.isReady = false;
    this.scheduledPost = null; // Store scheduled timeout
    this.scheduledData = null; // Store schedule data for persistence
    this.scheduleCheckInterval = null; // Store interval for checking schedule
    this.lastDistributionMessages = []; // Store last distribution messages for editing
    this.lastSwapsLeftMessages = []; // Store last swapsleft messages for editing
    this.messagesFilePath = './distribution_messages.json'; // File to store message IDs
    this.scheduleFilePath = './schedule.json'; // File to store schedule data
    this.lastChannelId = null; // Store channel ID for message retrieval
    this.pendingScheduleChannel = new Map(); // Store pending channel selection for schedule (userId -> channelId)
    this.lastSelectedPlayers = new Map(); // Store last selected players for mark done (userId -> [identifiers])
    this.swapsLeftPlayersList = []; // Store players shown in last Swaps Left message
    this.swapsLeftCompletionSent = false; // Prevent spamming SWAPS COMPLETED message
    this.dataSnapshot = null; // Store snapshot of sheet data for auto-send comparison
    this.autoSendMode = false; // Track if auto-send mode is active
    this.savedState = null; // Last loaded persistent state (from local file or BotState sheet)
    this.masterSyncInProgress = false;
  }

  extractDiscordUserIdForDm(player) {
    if (player && player.discordId && /^\d{17,20}$/.test(String(player.discordId).trim())) {
      return String(player.discordId).trim();
    }

    if (player && player.mention) {
      const match = String(player.mention).match(/<@!?(\d+)>/);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  async sendSwapsLeftDMs(playersList) {
    console.log(`📨 ========== STARTING DM SENDING PROCESS ==========`);
    console.log(`📊 Total players in list: ${playersList.length}`);

    let dmsSent = 0;
    let dmsFailed = 0;
    let skippedDone = 0;
    let skippedNoId = 0;

    for (const player of playersList) {
      console.log(`🔍 Processing player: ${player.name}, isDone: ${player.isDone}, mention: ${player.mention}, discordId: ${player.discordId}`);

      if (player.isDone) {
        skippedDone++;
        continue;
      }

      const userId = this.extractDiscordUserIdForDm(player);
      if (!userId) {
        skippedNoId++;
        console.warn(`⚠️ No Discord ID found for player: ${player.name} (mention: ${player.mention})`);
        continue;
      }

      const mentionText = (player.mention && String(player.mention).startsWith('<@'))
        ? player.mention
        : `<@${userId}>`;

      try {
        const user = await this.client.users.fetch(userId);

        const dmMessage = `Hi ${mentionText},\n\n` +
          `please move to **${player.targetClan}**. Thank you! 🙂\n\n` +
          `When you have further questions or something else to say, contact <@942383653269430323>, <@858753170934333452> or <@731336517003509830>. 😁\n\n` +
          `__Keep in mind:__ If you don't move within 18 hours after reset, you will be automatically kicked from the current clan, replaced and must apply on your own to RND.`;

        await user.send(dmMessage);
        dmsSent++;
        console.log(`✅ DM sent to ${player.name} (${userId})`);
      } catch (error) {
        dmsFailed++;
        console.error(`❌ Failed to send DM to ${player.name} (${userId}): ${error.message}`);
      }

      // Small delay to reduce rate-limit risk
      await new Promise(resolve => setTimeout(resolve, 350));
    }

    console.log(`📨 DM Summary: ${dmsSent} sent, ${dmsFailed} failed, ${skippedDone} skipped (done), ${skippedNoId} skipped (no ID)`);
    return { dmsSent, dmsFailed, skippedDone, skippedNoId };
  }

  sanitizeMessageContent(text) {
    if (text === null || text === undefined) return '';
    const raw = String(text);
    // Prevent unclosed code blocks / inline code from breaking all markdown rendering
    // Replace triple backticks first, then single backticks
    return raw
      .replace(/```/g, "'''")
      .replace(/`/g, "'")
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
  }

  splitTextByLinesToChunks(text, maxLength = 2000) {
    const chunks = [];
    let currentChunk = '';
    const lines = String(text).split('\n');

    for (const line of lines) {
      if (currentChunk.length + line.length + 1 > maxLength) {
        if (currentChunk) chunks.push(currentChunk);
        currentChunk = line + '\n';
      } else {
        currentChunk += line + '\n';
      }
    }

    if (currentChunk) chunks.push(currentChunk);
    return chunks;
  }

  splitDistributionToChunks(text, maxLength = 2000) {
    const safeText = this.sanitizeMessageContent(text);

    const otlIndex = safeText.indexOf('**## to OTL');
    const rndIndex = safeText.indexOf('**## to RND');

    if (otlIndex === -1 || rndIndex === -1) {
      return this.splitTextByLinesToChunks(safeText, maxLength);
    }

    const part1 = safeText.slice(0, otlIndex);
    const part2 = safeText.slice(otlIndex, rndIndex);
    const part3 = safeText.slice(rndIndex);

    const chunks = [];
    chunks.push(...this.splitTextByLinesToChunks(part1, maxLength));
    chunks.push(...this.splitTextByLinesToChunks(part2, maxLength));
    chunks.push(...this.splitTextByLinesToChunks(part3, maxLength));

    return chunks.filter(c => c && c.trim().length > 0);
  }

  async ensureDistributionLoaded() {
    if (this.distributionManager.allPlayers && this.distributionManager.allPlayers.length > 0) {
      return true;
    }

    let data = this.savedState;
    if (!data) {
      if (fs.existsSync(this.messagesFilePath)) {
        try {
          data = JSON.parse(fs.readFileSync(this.messagesFilePath, 'utf8'));
        } catch (error) {
          console.warn('⚠️ Failed to parse local distribution_messages.json:', error.message);
        }
      }
    }

    if (!data) {
      try {
        data = await loadBotState();
      } catch (error) {
        console.warn('⚠️ Failed to load BotState from Google Sheets:', error.message);
      }
    }

    if (!data) {
      return false;
    }

    this.savedState = data;
    if (data.channelId) {
      this.lastChannelId = data.channelId;
    }

    try {
      console.log('🔄 ensureDistributionLoaded: Restoring distribution from Google Sheets...');
      const finalRange = `${config.googleSheets.masterFinalSheetName || 'Master_Final'}!A:Z`;
      this.playersData = await fetchPlayersDataWithDiscordNames({ range: finalRange });
      const sortColumn = data.sortColumn || this.distributionManager.sortColumn || 'Trophies';
      const seasonNumber = data.seasonNumber || this.distributionManager.customSeasonNumber || null;
      this.distributionManager.distribute(this.playersData, sortColumn, seasonNumber);

      if (data.completedPlayers && Array.isArray(data.completedPlayers)) {
        this.distributionManager.completedPlayers = new Set(data.completedPlayers);
        console.log(`✅ ensureDistributionLoaded: Restored ${data.completedPlayers.length} completed players (checkmarks)`);
      }

      console.log(`✅ ensureDistributionLoaded: Distribution restored (${this.playersData.length} players)`);
      return this.distributionManager.allPlayers && this.distributionManager.allPlayers.length > 0;
    } catch (error) {
      console.error('❌ ensureDistributionLoaded failed:', error);
      return false;
    }
  }

  /**
   * Initialize and start the bot
   */
  async start() {
    try {
      // Register event handlers
      this.client.once('ready', () => this.onReady());
      this.client.on('interactionCreate', (interaction) => this.onInteraction(interaction));

      // Login
      await this.client.login(config.discord.token);
    } catch (error) {
      console.error('❌ Failed to start bot:', error);
      throw error;
    }
  }

  /**
   * Handle bot ready event
   */
  async onReady() {
    console.log(`✅ Bot logged in as ${this.client.user.tag}`);
    
    // Register slash commands
    await this.registerCommands();
    
    // Load saved message IDs
    await this.loadMessageIds();
    
    // Load saved schedule
    await this.loadSchedule();
    
    // Start schedule checker (runs every minute)
    this.startScheduleChecker();
    
    this.isReady = true;
    console.log('🤖 Bot is ready to receive commands!');
  }

  async checkAndExecuteMasterSync(force = false) {
    if (!force && !config.googleSheets.masterSyncEnabled) {
      return;
    }

    if (this.masterSyncInProgress) {
      return;
    }

    this.masterSyncInProgress = true;
    try {
      const state = (await loadBotState()) || this.savedState || {};
      const lastCopiedRow = state && state.masterSync && Number(state.masterSync.lastCopiedRow) ? Number(state.masterSync.lastCopiedRow) : undefined;
      const targetFrozen = !!(state && state.masterSync && state.masterSync.targetFrozen);

      const fullSync = !!force;

      const result = await syncMasterCsvToFinal({
        lastCopiedRow,
        freezeExistingTarget: !targetFrozen,
        fullSync,
      });

      if (result && (result.copiedRows > 0 || result.frozeExistingTarget)) {
        await updateBotState({
          masterSync: {
            lastCopiedRow: result.lastCopiedRow,
            lastSyncAt: Date.now(),
            targetFrozen: targetFrozen || !!result.frozeExistingTarget,
          },
        });

        if (result.frozeExistingTarget) {
          console.log('✅ Master Sync: Frozen existing Master_Final values (removed formulas)');
        }
        if (result.copiedRows > 0) {
          console.log(`✅ Master Sync: Copied ${result.copiedRows} row(s) to Master_Final (lastCopiedRow=${result.lastCopiedRow})`);
        }
      }

      return result;
    } catch (error) {
      console.warn(`⚠️ Master Sync failed: ${error.message}`);
      return null;
    } finally {
      this.masterSyncInProgress = false;
    }
  }

  /**
   * Save message IDs to file
   */
  saveMessageIds() {
    try {
      const data = {
        channelId: this.lastChannelId,
        distributionMessageIds: this.lastDistributionMessages.map(msg => msg.id),
        swapsLeftMessageIds: this.lastSwapsLeftMessages.map(msg => msg.id),
        sortColumn: this.distributionManager.sortColumn || 'Trophies',
        seasonNumber: this.distributionManager.customSeasonNumber || null,
        completedPlayers: Array.from(this.distributionManager.completedPlayers),
        timestamp: Date.now()
      };
      fs.writeFileSync(this.messagesFilePath, JSON.stringify(data, null, 2));
      console.log('💾 Saved distribution data: messages, sortColumn, seasonNumber, and completedPlayers');

      updateBotState(data)
        .then(() => console.log('💾 Saved BotState to Google Sheets'))
        .catch((error) => console.warn('⚠️ Failed to save BotState to Google Sheets:', error.message));
    } catch (error) {
      console.error('❌ Failed to save message IDs:', error);
    }
  }

  /**
   * Load message IDs from file
   */
  async loadMessageIds() {
    try {
      let data = null;
      if (fs.existsSync(this.messagesFilePath)) {
        data = JSON.parse(fs.readFileSync(this.messagesFilePath, 'utf8'));

        try {
          const sheetState = await loadBotState();
          if (sheetState && sheetState.masterSync) {
            data.masterSync = sheetState.masterSync;
          }
        } catch (error) {
          console.warn('⚠️ Could not load BotState for master sync merge:', error.message);
        }
      } else {
        console.log('ℹ️ No saved message IDs found locally, trying Google Sheets BotState...');
        data = await loadBotState();
        if (!data) {
          console.log('ℹ️ No saved BotState found');
          return;
        }
        console.log('✅ Loaded BotState from Google Sheets');
      }

      this.savedState = data;

      this.lastChannelId = data.channelId;

      // Fetch the actual message objects
      this.lastDistributionMessages = [];
      this.lastSwapsLeftMessages = [];

      let channel = null;
      if (data.channelId) {
        try {
          channel = await this.client.channels.fetch(data.channelId);
        } catch (error) {
          console.warn(`⚠️ Could not fetch channel ${data.channelId}: ${error.message}`);
        }
      }

      const distributionIds = data.distributionMessageIds || data.messageIds || []; // Support old format
      if (channel && distributionIds.length > 0) {
        for (const messageId of distributionIds) {
          try {
            const message = await channel.messages.fetch(messageId);
            this.lastDistributionMessages.push(message);
          } catch (error) {
            console.warn(`⚠️ Could not fetch distribution message ${messageId}`);
          }
        }
        console.log(`✅ Loaded ${this.lastDistributionMessages.length} distribution messages`);
      }

      if (channel && data.swapsLeftMessageIds && data.swapsLeftMessageIds.length > 0) {
        for (const messageId of data.swapsLeftMessageIds) {
          try {
            const message = await channel.messages.fetch(messageId);
            this.lastSwapsLeftMessages.push(message);
          } catch (error) {
            console.warn(`⚠️ Could not fetch swapsleft message ${messageId}`);
          }
        }
        console.log(`✅ Loaded ${this.lastSwapsLeftMessages.length} swapsleft messages`);
      }

      const shouldRestoreState =
        (distributionIds && distributionIds.length > 0) ||
        (data.swapsLeftMessageIds && data.swapsLeftMessageIds.length > 0) ||
        (data.completedPlayers && Array.isArray(data.completedPlayers) && data.completedPlayers.length > 0);

      if (shouldRestoreState) {
        console.log('🔄 Reloading distribution data from Google Sheets...');
        const finalRange = `${config.googleSheets.masterFinalSheetName || 'Master_Final'}!A:Z`;
        this.playersData = await fetchPlayersDataWithDiscordNames({ range: finalRange });

        const sortColumn = data.sortColumn || 'Trophies';
        const seasonNumber = data.seasonNumber || null;

        this.distributionManager.distribute(this.playersData, sortColumn, seasonNumber);

        if (data.completedPlayers && Array.isArray(data.completedPlayers)) {
          this.distributionManager.completedPlayers = new Set(data.completedPlayers);
          console.log(`✅ Restored ${data.completedPlayers.length} completed players (checkmarks)`);
        }

        console.log(`✅ Distribution data restored: ${this.playersData.length} players, sortColumn: ${sortColumn}, seasonNumber: ${seasonNumber}`);
      }
    } catch (error) {
      console.error('❌ Failed to load message IDs:', error);
    }
  }

  /**
   * Save schedule data to file
   */
  saveSchedule() {
    try {
      if (!this.scheduledData) {
        console.warn('⚠️ No schedule data to save');
        return;
      }
      fs.writeFileSync(this.scheduleFilePath, JSON.stringify(this.scheduledData, null, 2));
      console.log('💾 Saved schedule to file');
    } catch (error) {
      console.error('❌ Failed to save schedule:', error);
    }
  }

  /**
   * Load schedule from file
   */
  async loadSchedule() {
    try {
      if (!fs.existsSync(this.scheduleFilePath)) {
        console.log('ℹ️ No saved schedule found');
        return;
      }

      const data = JSON.parse(fs.readFileSync(this.scheduleFilePath, 'utf8'));
      this.scheduledData = data;

      // Parse the scheduled date
      const [datePart, timePart] = data.datetime.split(' ');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hour, minute] = timePart.split(':').map(Number);
      const scheduledDate = new Date(Date.UTC(year, month - 1, day, hour, minute));
      const now = new Date();

      const delay = scheduledDate.getTime() - now.getTime();
      const minutesRemaining = Math.round(delay / 1000 / 60);

      if (delay > 0) {
        console.log(`✅ Loaded schedule: Will post in ${minutesRemaining} minutes (${data.datetime} UTC)`);
        console.log(`📅 Scheduled for: ${scheduledDate.toISOString()}`);
      } else {
        console.log(`⚠️ Loaded schedule is ${Math.abs(minutesRemaining)} minutes late - will be handled by checker`);
      }
    } catch (error) {
      console.error('❌ Failed to load schedule:', error);
      // Clean up corrupted file
      if (fs.existsSync(this.scheduleFilePath)) {
        fs.unlinkSync(this.scheduleFilePath);
      }
    }
  }

  /**
   * Delete schedule file
   */
  deleteSchedule() {
    try {
      if (fs.existsSync(this.scheduleFilePath)) {
        fs.unlinkSync(this.scheduleFilePath);
        console.log('🗑️ Deleted schedule file');
      }
      this.scheduledData = null;
    } catch (error) {
      console.error('❌ Failed to delete schedule:', error);
    }
  }

  /**
   * Start schedule checker interval
   * Checks every 30 seconds for scheduled posts and auto-send mode
   */
  startScheduleChecker() {
    // Clear existing interval if any
    if (this.scheduleCheckInterval) {
      clearInterval(this.scheduleCheckInterval);
    }

    // Check every 30 seconds (30000 ms)
    this.scheduleCheckInterval = setInterval(async () => {
      await this.checkAndExecuteSchedule();
    }, 30000); // 30 seconds

    console.log('⏰ Schedule checker started (checks every 30 seconds)');
  }

  /**
   * Check if scheduled time has arrived and execute if needed
   * Also checks for auto-send mode (data changes)
   */
  async checkAndExecuteSchedule() {
    try {
      // Check if there's a schedule
      if (!this.scheduledData) {
        // Try to load from file
        if (fs.existsSync(this.scheduleFilePath)) {
          const data = JSON.parse(fs.readFileSync(this.scheduleFilePath, 'utf8'));
          this.scheduledData = data;
          this.autoSendMode = data.autoSend || false;
        } else {
          return; // No schedule
        }
      }

      // Handle Auto-Send mode (check for data changes)
      if (this.autoSendMode) {
        const hasChanges = await this.checkForDataChanges();
        if (hasChanges) {
          console.log('🔄 Auto-Send: Data changes detected! Sending distribution...');
          await this.executeScheduledPost();
          return;
        }
        return; // No changes, continue monitoring
      }

      // Handle Time-based or Scheduled Auto-Send
      const [datePart, timePart] = this.scheduledData.datetime.split(' ');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hour, minute] = timePart.split(':').map(Number);
      const scheduledDate = new Date(Date.UTC(year, month - 1, day, hour, minute));
      const now = new Date();

      // Check if it's time to send (within 30 second window for 30-sec polling)
      const timeDiff = scheduledDate.getTime() - now.getTime();
      
      if (timeDiff <= 0 && timeDiff > -30000) {
        // Time has arrived!
        if (this.scheduledData.autoSend) {
          // Activate Auto-Send monitoring mode
          console.log('🎯 Scheduled time reached! Activating Auto-Send monitoring...');
          this.autoSendMode = true;
          // Snapshot was already taken at schedule creation time
          console.log('📸 Using snapshot from schedule creation time');
        } else {
          // Regular time-based post
          console.log('🎯 Scheduled time reached! Sending distribution...');
          await this.executeScheduledPost();
        }
      } else if (timeDiff <= -30000) {
        // More than 30 seconds late - schedule missed
        console.log('⚠️ Scheduled time has passed by more than 30 seconds, cleaning up');
        this.deleteSchedule();
      }
    } catch (error) {
      console.error('❌ Error in schedule checker:', error);
    }
  }

  /**
   * Check for data changes in Google Sheets (for auto-send mode)
   * Compares Master_CSV with Master_Final (columns B, C, D only - ignores column E - Action)
   */
  async checkForDataChanges() {
    try {
      // Fetch data from Master_CSV (source)
      const csvRange = `${config.googleSheets.masterCsvSheetName || 'Master_CSV'}!A:Z`;
      const csvData = await fetchPlayersDataWithDiscordNames({ range: csvRange });
      
      // Fetch data from Master_Final (target)
      const finalRange = `${config.googleSheets.masterFinalSheetName || 'Master_Final'}!A:Z`;
      const finalData = await fetchPlayersDataWithDiscordNames({ range: finalRange });
      
      // Create snapshots for comparison (columns B, C, D only)
      const csvSnapshot = this.createDataSnapshot(csvData);
      const finalSnapshot = this.createDataSnapshot(finalData);
      
      // Compare Master_CSV with Master_Final
      const hasChanges = JSON.stringify(csvSnapshot) !== JSON.stringify(finalSnapshot);
      
      if (hasChanges) {
        console.log('🔄 Data changes detected: Master_CSV differs from Master_Final');
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('❌ Error checking for data changes:', error);
      return false;
    }
  }

  /**
   * Create a snapshot of data (columns B, C, D only - ignore E)
   * Returns simplified data structure for comparison
   */
  createDataSnapshot(data) {
    return data.map(player => ({
      name: player.Name || player.Player || '',
      discordName: player['Discord-Name'] || player.DiscordName || '',
      trophies: player.Trophies || 0,
      clan: player.Clan || ''
      // Intentionally excluding Action column (E)
    }));
  }

  /**
   * Execute the scheduled post
   */
  async executeScheduledPost() {
    try {
      // Get the channel
      const channel = await this.client.channels.fetch(this.scheduledData.channelId);
      if (!channel) {
        console.error('❌ Could not find scheduled channel');
        this.deleteSchedule();
        return;
      }

      // If auto-send mode, sync Master_CSV → Master_Final first
      if (this.autoSendMode) {
        console.log('🔁 Auto-Send: Syncing Master_CSV → Master_Final before posting...');
        const syncResult = await this.checkAndExecuteMasterSync(true);
        if (syncResult && syncResult.aborted) {
          console.warn(`⚠️ Auto-send sync skipped: ${syncResult.abortReason || 'Source empty'}`);
        } else if (syncResult && syncResult.copiedRows > 0) {
          console.log(`✅ Auto-Send: Synced ${syncResult.copiedRows} row(s) to Master_Final`);
        }
      }

      console.log('🔄 Refreshing data from Google Sheets (Master_Final) before scheduled post...');
      const finalRange = `${config.googleSheets.masterFinalSheetName || 'Master_Final'}!A:Z`;
      this.playersData = await fetchPlayersDataWithDiscordNames({ range: finalRange });
      
      const sortColumn = this.distributionManager.sortColumn || 'Trophies';
      this.distributionManager.distribute(this.playersData, sortColumn);
      console.log(`✅ Data refreshed: ${this.playersData.length} players`);
      
      const formattedText = this.distributionManager.getFormattedDistribution();
      
      if (formattedText && formattedText.length > 50) {
        await this.sendLongMessage(channel, formattedText, true, true);
        console.log(`✅ Scheduled post sent to ${channel.name}`);
        
        // Send notification about the scheduled post to the channel where scheduling was initiated
        const creationChannelId = this.scheduledData.creationChannelId || this.scheduledData.channelId;
        
        // Prepare notification channels list
        const notificationChannelIds = [creationChannelId];
        
        // Prepare notification embed
        const rgrCount = this.distributionManager.groups.RGR?.length || 0;
        const otlCount = this.distributionManager.groups.OTL?.length || 0;
        const rndCount = this.distributionManager.groups.RND?.length || 0;
        const wildcardsCount = this.distributionManager.groups.WILDCARDS?.length || 0;
        const totalPlayers = this.playersData.length;
        
        const notificationEmbed = new EmbedBuilder()
          .setColor(0x00ff00)
          .setTitle('✅ Scheduled Distribution Sent')
          .setDescription(`The scheduled swap distribution has been posted successfully in ${channel}!`)
          .addFields(
            { name: '📊 Total Players', value: `${totalPlayers}`, inline: true },
            { name: '🔴 RGR', value: `${rgrCount} players`, inline: true },
            { name: '🟡 OTL', value: `${otlCount} players`, inline: true },
            { name: '🟢 RND', value: `${rndCount} players`, inline: true },
            { name: '⭐ WILDCARDS', value: `${wildcardsCount} players`, inline: true },
            { name: '📅 Sent At', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false }
          )
          .setFooter({ text: this.autoSendMode ? 'Auto-Send Mode: Monitoring continues' : 'Scheduled post completed' })
          .setTimestamp();
        
        // Send notification to all channels
        for (const channelId of notificationChannelIds) {
          try {
            const notifChannel = await this.client.channels.fetch(channelId).catch(() => null);
            if (notifChannel) {
              await notifChannel.send({ embeds: [notificationEmbed] });
              console.log(`📢 Notification sent to channel: ${notifChannel.name} (${channelId})`);
            }
          } catch (error) {
            console.error(`❌ Failed to send notification to channel ${channelId}:`, error);
          }
        }
      } else {
        console.error('❌ No distribution data to send');
        await channel.send('❌ Error: No distribution data available. Please run /swap first.');
      }

      // Clean up after sending (only if not in continuous auto-send mode)
      if (!this.scheduledData.continuousAutoSend) {
        this.deleteSchedule();
        this.scheduledPost = null;
        this.autoSendMode = false;
        this.dataSnapshot = null;
      } else {
        // Update snapshot for next check
        this.dataSnapshot = this.createDataSnapshot(this.playersData);
      }
    } catch (error) {
      console.error('❌ Error sending scheduled post:', error);
      try {
        const channel = await this.client.channels.fetch(this.scheduledData.channelId);
        await channel.send('❌ Error sending scheduled distribution. Please check bot logs.');
      } catch (e) {
        console.error('❌ Could not send error message to channel');
      }
    }
  }

  /**
   * Register slash commands with Discord
   */
  async registerCommands() {
    try {
      const rest = new REST({ version: '10' }).setToken(config.discord.token);
      
      const commandsData = commands.map(cmd => cmd.toJSON());

      if (config.discord.guildId) {
        // Register for specific guild (faster for testing)
        try {
          await rest.put(
            Routes.applicationGuildCommands(this.client.user.id, config.discord.guildId),
            { body: commandsData }
          );
          console.log('✅ Registered guild commands');
        } catch (error) {
          const code = error && (error.code || error.rawError?.code);
          const status = error && (error.status || error.rawError?.status);
          const message = error && (error.message || error.rawError?.message);

          // DiscordAPIError[50001]: Missing Access
          if (code === 50001 || status === 403) {
            console.warn('⚠️ Failed to register guild commands: Missing Access');
            console.warn('   Fix: Ensure the bot is in the server for GUILD_ID and invited with OAuth2 scopes: bot + applications.commands');
            console.warn('   Falling back to global command registration...');

            await rest.put(
              Routes.applicationCommands(this.client.user.id),
              { body: commandsData }
            );
            console.log('✅ Registered global commands (fallback)');
          } else {
            console.error('❌ Failed to register guild commands:', message || error);
          }
        }
      } else {
        // Wait a bit for guilds to be fully cached
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Delete old guild-specific commands from all guilds to prevent duplicates
        const guilds = this.client.guilds.cache;
        console.log(`🔍 Found ${guilds.size} guilds to clear commands from`);
        
        for (const [guildId, guild] of guilds) {
          try {
            await rest.put(
              Routes.applicationGuildCommands(this.client.user.id, guildId),
              { body: [] }
            );
            console.log(`🗑️ Cleared guild commands from: ${guild.name} (${guildId})`);
          } catch (error) {
            console.error(`❌ Failed to clear commands from ${guild.name}:`, error.message);
          }
        }
        
        // Register globally
        await rest.put(
          Routes.applicationCommands(this.client.user.id),
          { body: commandsData }
        );
        console.log('✅ Registered global commands');
      }
    } catch (error) {
      console.error('❌ Failed to register commands:', error);
    }
  }

  /**
   * Handle interactions (slash commands, buttons, select menus, modals)
   */
  async onInteraction(interaction) {
    // Handle button interactions
    if (interaction.isButton()) {
      return await this.handleButtonInteraction(interaction);
    }
    
    // Handle select menu interactions (string)
    if (interaction.isStringSelectMenu()) {
      return await this.handleSelectMenuInteraction(interaction);
    }
    
    // Handle channel select menu interactions
    if (interaction.isChannelSelectMenu()) {
      return await this.handleChannelSelectInteraction(interaction);
    }
    
    // Handle modal submissions
    if (interaction.isModalSubmit()) {
      return await this.handleModalSubmit(interaction);
    }
    
    if (!interaction.isChatInputCommand()) return;

    const commandName = interaction.commandName;

    try {
      // Defer reply - make all commands ephemeral (hidden)
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }

      switch (commandName) {
        case 'swap':
          await this.handleDistribute(interaction);
          break;

        case 'admin':
          await this.handleAdmin(interaction);
          break;

        case 'refresh':
          await this.handleRefresh(interaction);
          break;

        default:
          await interaction.editReply('❌ Unknown command');
      }
    } catch (error) {
      console.error(`Error handling command ${commandName}:`, error);
      const errorMessage = error.message || 'An error occurred';
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: `❌ Error: ${errorMessage}`, ephemeral: true });
      } else {
        await interaction.editReply(`❌ Error: ${errorMessage}`).catch(() => {});
      }
    }
  }

  /**
   * Handle button interactions
   */
  async handleButtonInteraction(interaction) {
    const customId = interaction.customId;
    
    try {
      // Don't defer for buttons that open modals
      if (customId === 'schedule_set_time' || customId === 'schedule_edit') {
        await this.handleScheduleSetTimeButton(interaction);
        return;
      }
      
      // Don't defer for schedule cancel - it updates the original message
      if (customId === 'schedule_cancel') {
        await interaction.update({ content: '❌ Schedule cancelled', embeds: [], components: [] });
        return;
      }
      
      // Handle schedule delete
      if (customId === 'schedule_delete') {
        this.scheduledData = null;
        this.autoSendMode = false;
        this.dataSnapshot = null;
        this.deleteSchedule();
        await interaction.update({ 
          content: '✅ Schedule deleted successfully', 
          embeds: [], 
          components: [] 
        });
        return;
      }
      
      
      // Handle schedule preview
      if (customId === 'schedule_view_preview') {
        await interaction.deferReply({ ephemeral: true });
        const formattedText = this.distributionManager.getFormattedDistribution();
        if (formattedText && formattedText.length > 50) {
          const header = '**Preview:**\n\n';
          const maxLength = 2000 - header.length;
          const chunks = [];
          let currentChunk = '';
          const lines = formattedText.split('\n');
          
          for (const line of lines) {
            if ((currentChunk + line + '\n').length > maxLength) {
              if (currentChunk) chunks.push(currentChunk);
              currentChunk = line + '\n';
            } else {
              currentChunk += line + '\n';
            }
          }
          if (currentChunk) chunks.push(currentChunk);
          
          // Send first chunk with header
          await interaction.editReply({ content: header + chunks[0] });
          
          // Send remaining chunks as followUp
          for (let i = 1; i < chunks.length; i++) {
            await interaction.followUp({ 
              content: chunks[i], 
              ephemeral: true 
            });
          }
        } else {
          await interaction.editReply('⚠️ No distribution data. Run /swap first.');
        }
        return;
      }
      
      // Handle Move Player button - opens Modal
      if (customId === 'move_player') {
        await this.handleMovePlayerButton(interaction);
        return;
      }
      
      // Handle Schedule button - opens schedule UI
      if (customId === 'open_schedule') {
        await this.handleOpenScheduleButton(interaction);
        return;
      }
      
      // Handle Add Player button - opens Modal
      if (customId === 'add_player') {
        await this.handleAddPlayerButton(interaction);
        return;
      }
      
      // Handle Include Player button - clears manual action
      if (customId === 'include_player') {
        await this.handleIncludePlayerButton(interaction);
        return;
      }
      
      // Handle Reset Options button - shows reset options
      if (customId === 'reset_options') {
        await this.handleResetOptionsButton(interaction);
        return;
      }
      
      // Handle Reset Swap Only button
      if (customId === 'reset_swap_only') {
        await this.handleResetSwapOnly(interaction);
        return;
      }
      
      // Handle Reset All button
      if (customId === 'reset_all') {
        await this.handleResetAll(interaction);
        return;
      }
      
      // Handle Show Distribution button
      if (customId === 'show_distribution') {
        await this.handleShowDistributionButton(interaction);
        return;
      }
      
      // Handle Help button
      if (customId === 'show_help') {
        await this.handleHelpButton(interaction);
        return;
      }
      
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }
      
      switch (customId) {
        case 'show_swaps_left':
          await this.handleSwapsLeftButton(interaction);
          break;
        
        case 'refresh_data':
          await this.handleRefreshButton(interaction);
          break;
        
        case 'mark_done':
          await this.handleMarkDoneButton(interaction);
          break;
        
        default:
          await interaction.editReply('❌ Unknown button');
      }
    } catch (error) {
      console.error(`❌ Error handling button ${customId}:`, error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true }).catch(() => {});
      } else {
        await interaction.editReply(`❌ Error: ${error.message}`).catch(() => {});
      }
    }
  }

  /**
   * Handle select menu interactions
   */
  async handleSelectMenuInteraction(interaction) {
    const customId = interaction.customId;
    
    try {
      await interaction.deferReply({ ephemeral: true });
      
      if (
        customId === 'select_players_done' ||
        customId.startsWith('select_rgr_done') ||
        customId.startsWith('select_otl_done') ||
        customId.startsWith('select_rnd_done') ||
        customId.startsWith('select_wildcards_done')
      ) {
        await this.handleSelectPlayersDone(interaction);
      } else if (customId.startsWith('move_player_select_')) {
        await this.handleMovePlayerSelect(interaction);
      } else if (customId === 'move_clan_select') {
        await this.handleMoveClanSelect(interaction);
      } else {
        await interaction.editReply('❌ Unknown select menu');
      }
    } catch (error) {
      console.error(`❌ Error handling select menu ${customId}:`, error);
      await interaction.editReply(`❌ Error: ${error.message}`);
    }
  }

  /**
   * Handle channel select menu interactions
   */
  async handleChannelSelectInteraction(interaction) {
    const customId = interaction.customId;
    
    try {
      if (customId === 'schedule_channel_select') {
        const selectedChannel = interaction.channels.first();
        
        // Store the selected channel for this user
        this.pendingScheduleChannel.set(interaction.user.id, selectedChannel.id);
        
        // Update the embed to show selected channel
        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('📅 Schedule Swap')
          .setDescription('**Step 1:** ✅ Channel selected\n**Step 2:** Click "Set Date & Time" to enter the schedule time')
          .addFields(
            { name: '📺 Channel', value: `${selectedChannel}`, inline: true },
            { name: '⏰ Date & Time', value: '_Not set_', inline: true }
          )
          .setFooter({ text: 'All times are in UTC' });

        // Recreate components
        const channelSelect = new ChannelSelectMenuBuilder()
          .setCustomId('schedule_channel_select')
          .setPlaceholder('Select a channel to post in')
          .setChannelTypes(ChannelType.GuildText);

        const channelRow = new ActionRowBuilder().addComponents(channelSelect);

        const buttonRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('schedule_set_time')
              .setLabel('📅 Set Date & Time')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId('schedule_cancel')
              .setLabel('Cancel')
              .setStyle(ButtonStyle.Secondary)
          );

        await interaction.update({
          embeds: [embed],
          components: [channelRow, buttonRow]
        });
      }
    } catch (error) {
      console.error(`❌ Error handling channel select ${customId}:`, error);
      await interaction.reply({ content: `❌ Error: ${error.message}`, ephemeral: true });
    }
  }

  /**
   * Handle Schedule Set Time button - opens Modal with pre-filled defaults
   */
  async handleScheduleSetTimeButton(interaction) {
    // Check if channel is selected (from pending or existing schedule)
    let channelId = this.pendingScheduleChannel.get(interaction.user.id);
    
    // If editing existing schedule, use that channel
    if (!channelId && this.scheduledData) {
      channelId = this.scheduledData.channelId;
      this.pendingScheduleChannel.set(interaction.user.id, channelId);
    }
    
    if (!channelId) {
      await interaction.reply({ 
        content: '❌ Please select a channel first!', 
        ephemeral: true 
      });
      return;
    }

    // Calculate tomorrow's date or use existing schedule date
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    
    const year = tomorrow.getUTCFullYear();
    const month = String(tomorrow.getUTCMonth() + 1).padStart(2, '0');
    const day = String(tomorrow.getUTCDate()).padStart(2, '0');
    const defaultDate = `${year}-${month}-${day}`;
    const defaultTime = '01:00';

    // Create Modal for date/time input with defaults
    const modal = new ModalBuilder()
      .setCustomId('schedule_datetime_modal')
      .setTitle('📅 Set Schedule Time');

    const dateInput = new TextInputBuilder()
      .setCustomId('schedule_date')
      .setLabel('Date (YYYY-MM-DD)')
      .setValue(defaultDate)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(10)
      .setMaxLength(10);

    const timeInput = new TextInputBuilder()
      .setCustomId('schedule_time')
      .setLabel('Time in UTC (HH:MM)')
      .setValue(defaultTime)
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(5)
      .setMaxLength(5);

    const autoSendInput = new TextInputBuilder()
      .setCustomId('schedule_auto_send')
      .setLabel('Enable Smart Auto-Send? (yes/no)')
      .setPlaceholder('yes = monitor changes after time | no = post once at time')
      .setValue('yes')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(2)
      .setMaxLength(3);

    const dateRow = new ActionRowBuilder().addComponents(dateInput);
    const timeRow = new ActionRowBuilder().addComponents(timeInput);
    const autoSendRow = new ActionRowBuilder().addComponents(autoSendInput);

    modal.addComponents(dateRow, timeRow, autoSendRow);

    await interaction.showModal(modal);
  }

  /**
   * Handle Move Player button - shows player selection dropdowns
   */
  async handleMovePlayerButton(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    // Get all players
    if (!this.playersData || this.playersData.length === 0) {
      const finalRange = `${config.googleSheets.masterFinalSheetName || 'Master_Final'}!A:Z`;
      this.playersData = await fetchPlayersDataWithDiscordNames({ range: finalRange });
    }
    
    if (this.playersData.length === 0) {
      await interaction.editReply('❌ No players found. Please run /swap first.');
      return;
    }
    
    // Create player options (max 25 per select menu, max 5 select menus per message)
    const players = this.playersData.map((p, index) => {
      const name = p.Name || p.Player || p.USERNAME || 'Unknown';
      const discordId = p['Discord-ID'] || '';
      const trophies = p.Trophies || '';
      // Truncate name to fit Discord's 100 char limit for label
      const displayName = name.length > 50 ? name.substring(0, 47) + '...' : name;
      return {
        label: displayName,
        description: trophies ? `${trophies}` : undefined,
        value: `player_${index}_${discordId || 'no_id'}`
      };
    });
    
    // Split into chunks of 25 (Discord limit)
    const chunks = [];
    for (let i = 0; i < players.length; i += 25) {
      chunks.push(players.slice(i, i + 25));
    }
    
    // Create select menus (max 5 per message due to Discord limit)
    const components = [];
    const maxMenus = Math.min(chunks.length, 5);
    
    for (let i = 0; i < maxMenus; i++) {
      const startNum = i * 25 + 1;
      const endNum = Math.min((i + 1) * 25, players.length);
      
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`move_player_select_${i}`)
        .setPlaceholder(`Players ${startNum}-${endNum}`)
        .setMinValues(1)
        .setMaxValues(chunks[i].length)
        .addOptions(chunks[i]);
      
      components.push(new ActionRowBuilder().addComponents(selectMenu));
    }
    
    // If more than 125 players, add a note
    let description = '**Step 1:** Select players from the lists below (you can select multiple)\n**Step 2:** Choose the target clan';
    if (players.length > 125) {
      description += `\n\n⚠️ Showing first 125 of ${players.length} players`;
    }
    
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🔀 Move Player')
      .setDescription(description)
      .setFooter({ text: 'Select one or more players to move them to a different clan' });
    
    await interaction.editReply({ embeds: [embed], components });
  }

  /**
   * Handle player selection from Move dropdown (supports multiple players)
   */
  async handleMovePlayerSelect(interaction) {
    const selectedValues = interaction.values;
    
    // Parse all selected players
    const selectedPlayers = [];
    for (const selectedValue of selectedValues) {
      // Parse: player_INDEX_DISCORDID
      const parts = selectedValue.split('_');
      const playerIndex = parseInt(parts[1]);
      const discordIdFromValue = parts.slice(2).join('_'); // In case ID has underscores
      
      if (!this.playersData || playerIndex >= this.playersData.length) {
        continue;
      }
      
      const player = this.playersData[playerIndex];
      const playerName = player.Name || player.Player || player.USERNAME || 'Unknown';
      
      // Get Discord ID from player data (more reliable than from value)
      const discordId = player['Discord-ID'] || (discordIdFromValue !== 'no_id' ? discordIdFromValue : null);
      
      console.log(`📋 Selected player: "${playerName}" (index: ${playerIndex})`);
      console.log(`   Discord-ID from data: "${player['Discord-ID']}"`);
      console.log(`   Discord-ID from value: "${discordIdFromValue}"`);
      console.log(`   Final Discord-ID: "${discordId}"`);
      
      selectedPlayers.push({
        index: playerIndex,
        discordId: discordId,
        name: playerName
      });
    }
    
    if (selectedPlayers.length === 0) {
      await interaction.editReply('❌ No valid players found. Please try again.');
      return;
    }
    
    // Store selected players for this user (now an array)
    this.pendingMovePlayer = this.pendingMovePlayer || new Map();
    this.pendingMovePlayer.set(interaction.user.id, selectedPlayers);
    
    // Show clan selection
    const clanSelect = new StringSelectMenuBuilder()
      .setCustomId('move_clan_select')
      .setPlaceholder('Select target clan')
      .addOptions([
        { label: 'RGR', description: 'Move to RGR clan', value: 'RGR', emoji: '🏆' },
        { label: 'OTL', description: 'Move to OTL clan', value: 'OTL', emoji: '🏆' },
        { label: 'RND', description: 'Move to RND clan', value: 'RND', emoji: '🏆' }
      ]);
    
    const clanRow = new ActionRowBuilder().addComponents(clanSelect);
    
    // Add Include button to clear manual action
    const buttonRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('include_player')
          .setLabel('Include')
          .setEmoji('♻️')
          .setStyle(ButtonStyle.Secondary)
      );
    
    // Build selected players list for display
    const playerNames = selectedPlayers.map(p => p.name).join('\n• ');
    const playerCount = selectedPlayers.length;
    const selectedText = playerCount === 1 
      ? `**Selected:** ${selectedPlayers[0].name}`
      : `**Selected (${playerCount} players):**\n• ${playerNames}`;
    
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🔀 Move Player')
      .setDescription(`${selectedText}\n\n**Step 2:** Choose the target clan\n\nOr click **Include** to remove manual action`)
      .setFooter({ text: playerCount === 1 ? 'Select a clan to complete the move' : `Select a clan to move all ${playerCount} players` });
    
    await interaction.editReply({ embeds: [embed], components: [clanRow, buttonRow] });
  }

  /**
   * Handle clan selection for Move (supports multiple players)
   */
  async handleMoveClanSelect(interaction) {
    const targetClan = interaction.values[0];
    
    // Get stored players
    if (!this.pendingMovePlayer || !this.pendingMovePlayer.has(interaction.user.id)) {
      await interaction.editReply('❌ No player selected. Please start over.');
      return;
    }
    
    const selectedPlayers = this.pendingMovePlayer.get(interaction.user.id);
    
    // Ensure it's an array (backward compatibility)
    const playersArray = Array.isArray(selectedPlayers) ? selectedPlayers : [selectedPlayers];
    
    console.log(`🔀 Move request: ${playersArray.length} player(s) to ${targetClan}`);
    
    const successList = [];
    const failList = [];
    
    try {
      for (const playerData of playersArray) {
        const { discordId, name: playerName, index: playerIndex } = playerData;
        
        if (!discordId) {
          failList.push(`${playerName} (no Discord ID)`);
          continue;
        }
        
        // Get player's current clan
        const player = this.playersData[playerIndex];
        const currentClan = player?.Clan || player?.clan || '';
        
        // If moving to same clan, use HOLD instead
        let actionToWrite = targetClan;
        
        if (currentClan.toUpperCase() === targetClan.toUpperCase()) {
          actionToWrite = 'Hold';
          console.log(`📌 Player "${playerName}" is already in ${currentClan}, setting to HOLD`);
        }
        
        // Write action to Google Sheet
        console.log(`📝 Writing action: "${playerName}" -> ${actionToWrite}`);
        await writePlayerAction(discordId, actionToWrite);
        
        if (actionToWrite === 'Hold') {
          successList.push(`${playerName} → HOLD`);
        } else {
          successList.push(`${playerName} → ${targetClan}`);
        }
      }
      
      // Refresh and redistribute once after all changes
      console.log(`🔄 Refreshing player data...`);
      const finalRange = `${config.googleSheets.masterFinalSheetName || 'Master_Final'}!A:Z`;
      this.playersData = await fetchPlayersDataWithDiscordNames({ range: finalRange });
      this.distributionManager.distribute(this.playersData);
      console.log(`✅ Data refreshed and redistributed`);
      
      // Update messages if they exist
      if (this.lastDistributionMessages && this.lastDistributionMessages.length > 0) {
        console.log(`📝 Updating ${this.lastDistributionMessages.length} distribution messages...`);
        const formattedText = this.distributionManager.getFormattedDistribution();
        await this.updateDistributionMessages(formattedText);
        console.log(`✅ Messages updated`);
      }
      
      // Build result message
      let description = '';
      if (successList.length > 0) {
        description += `**✅ Moved (${successList.length}):**\n• ${successList.join('\n• ')}`;
      }
      if (failList.length > 0) {
        description += `\n\n**❌ Failed (${failList.length}):**\n• ${failList.join('\n• ')}`;
      }
      
      const embed = new EmbedBuilder()
        .setColor(failList.length === 0 ? 0x00ff00 : 0xffaa00)
        .setTitle(playersArray.length === 1 ? '✅ Player Moved' : `✅ ${successList.length} Players Moved`)
        .setDescription(description)
        .setTimestamp();
      
      await interaction.editReply({ embeds: [embed], components: [] });
    } catch (error) {
      console.error(`❌ Error moving players:`, error);
      await interaction.editReply(`❌ Failed to move players: ${error.message}`);
    }
    
    // Clean up
    this.pendingMovePlayer.delete(interaction.user.id);
  }

  /**
   * Handle Include Player button - clears manual action (supports multiple players)
   */
  async handleIncludePlayerButton(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    // Get stored players
    if (!this.pendingMovePlayer || !this.pendingMovePlayer.has(interaction.user.id)) {
      await interaction.editReply('❌ No player selected. Please start over.');
      return;
    }
    
    const selectedPlayers = this.pendingMovePlayer.get(interaction.user.id);
    
    // Ensure it's an array (backward compatibility)
    const playersArray = Array.isArray(selectedPlayers) ? selectedPlayers : [selectedPlayers];
    
    const successList = [];
    const failList = [];
    
    try {
      for (const playerData of playersArray) {
        const { discordId, name: playerName } = playerData;
        
        if (!discordId) {
          failList.push(`${playerName} (no Discord ID)`);
          continue;
        }
        
        // Clear action from Google Sheet
        console.log(`♻️ Clearing action for player "${playerName}" (discordId: ${discordId})`);
        await clearPlayerAction(discordId);
        successList.push(playerName);
      }
      
      // Refresh and redistribute once after all changes
      const finalRange = `${config.googleSheets.masterFinalSheetName || 'Master_Final'}!A:Z`;
      this.playersData = await fetchPlayersDataWithDiscordNames({ range: finalRange });
      this.distributionManager.distribute(this.playersData);
      
      // Update messages if they exist
      if (this.lastDistributionMessages && this.lastDistributionMessages.length > 0) {
        const formattedText = this.distributionManager.getFormattedDistribution();
        await this.updateDistributionMessages(formattedText);
      }
      
      // Build result message
      let description = '';
      if (successList.length > 0) {
        description += `**✅ Included (${successList.length}):**\n• ${successList.join('\n• ')}`;
        description += '\n\nPlayers will now be distributed automatically.';
      }
      if (failList.length > 0) {
        description += `\n\n**❌ Failed (${failList.length}):**\n• ${failList.join('\n• ')}`;
      }
      
      const embed = new EmbedBuilder()
        .setColor(failList.length === 0 ? 0x00ff00 : 0xffaa00)
        .setTitle(playersArray.length === 1 ? '✅ Player Included' : `✅ ${successList.length} Players Included`)
        .setDescription(description)
        .setTimestamp();
      
      await interaction.editReply({ embeds: [embed], components: [] });
    } catch (error) {
      console.error(`❌ Error including players:`, error);
      await interaction.editReply(`❌ Failed to include players: ${error.message}`);
    }
    
    // Clean up
    this.pendingMovePlayer.delete(interaction.user.id);
  }

  /**
   * Handle Reset Options button - shows reset options
   */
  async handleResetOptionsButton(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('🗑️ Reset Options')
      .setDescription('Choose what you want to reset:')
      .addFields(
        { name: '📊 Reset Swap Only', value: 'Clears the current swap distribution', inline: false },
        { name: '⚠️ Reset All', value: 'Clears swap + all manual actions + schedule', inline: false }
      )
      .setFooter({ text: '⚠️ This action cannot be undone!' });
    
    const buttonRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('reset_swap_only')
          .setLabel('Reset Swap Only')
          .setEmoji('📊')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('reset_all')
          .setLabel('Reset All')
          .setEmoji('⚠️')
          .setStyle(ButtonStyle.Danger)
      );
    
    await interaction.editReply({ embeds: [embed], components: [buttonRow] });
  }

  /**
   * Handle Reset Swap Only button
   */
  async handleResetSwapOnly(interaction) {
    await interaction.deferUpdate();
    
    try {
      // Clear distribution data
      this.distributionManager.allPlayers = [];
      this.distributionManager.groups = { RGR: [], OTL: [], RND: [] };
      this.distributionManager.wildcards = [];
      this.distributionManager.completedPlayers = new Set();
      this.playersData = [];
      this.lastDistributionMessages = [];
      this.lastSwapsLeftMessages = [];
      this.savedState = null;
      
      // Delete saved message IDs
      const messagesFilePath = './distribution_messages.json';
      if (fs.existsSync(messagesFilePath)) {
        fs.unlinkSync(messagesFilePath);
      }

      updateBotState({
        channelId: null,
        distributionMessageIds: [],
        swapsLeftMessageIds: [],
        sortColumn: null,
        seasonNumber: null,
        completedPlayers: [],
        timestamp: Date.now(),
      })
        .then(() => console.log('🗑️ Cleared distribution state in Google Sheets'))
        .catch((error) => console.warn('⚠️ Failed to clear distribution state in Google Sheets:', error.message));
      
      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ Swap Reset')
        .setDescription('The swap distribution has been cleared.\nRun `/swap` to create a new distribution.')
        .setTimestamp();
      
      await interaction.editReply({ embeds: [embed], components: [] });
    } catch (error) {
      console.error('❌ Error resetting swap:', error);
      await interaction.editReply({ content: `❌ Error: ${error.message}`, embeds: [], components: [] });
    }
  }

  /**
   * Handle Reset All button
   */
  async handleResetAll(interaction) {
    await interaction.deferUpdate();
    
    try {
      // Clear distribution data
      this.distributionManager.allPlayers = [];
      this.distributionManager.groups = { RGR: [], OTL: [], RND: [] };
      this.distributionManager.wildcards = [];
      this.distributionManager.completedPlayers = new Set();
      this.playersData = [];
      this.lastDistributionMessages = [];
      this.lastSwapsLeftMessages = [];
      this.savedState = null;
      
      // Delete saved message IDs
      const messagesFilePath = './distribution_messages.json';
      if (fs.existsSync(messagesFilePath)) {
        fs.unlinkSync(messagesFilePath);
      }

      updateBotState({
        channelId: null,
        distributionMessageIds: [],
        swapsLeftMessageIds: [],
        sortColumn: null,
        seasonNumber: null,
        completedPlayers: [],
        timestamp: Date.now(),
      })
        .then(() => console.log('🗑️ Cleared distribution state in Google Sheets'))
        .catch((error) => console.warn('⚠️ Failed to clear distribution state in Google Sheets:', error.message));
      
      // Clear all actions from Google Sheet
      await clearAllPlayerActions();
      
      // Delete schedule
      if (this.scheduledData) {
        this.scheduledData = null;
        this.deleteSchedule();
      }
      
      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ All Reset')
        .setDescription('Everything has been cleared:\n• Swap distribution\n• All manual actions (Move/Hold)\n• Schedule')
        .setTimestamp();
      
      await interaction.editReply({ embeds: [embed], components: [] });
    } catch (error) {
      console.error('❌ Error resetting all:', error);
      await interaction.editReply({ content: `❌ Error: ${error.message}`, embeds: [], components: [] });
    }
  }

  /**
   * Handle Show Distribution button
   */
  async handleShowDistributionButton(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    const ok = await this.ensureDistributionLoaded();
    if (!ok) {
      await interaction.editReply('⚠️ No swap found. Please run `/swap` first.');
      return;
    }
    
    try {
      const formattedText = this.distributionManager.getFormattedDistribution();

      const chunks = this.splitDistributionToChunks(formattedText, 2000);

      // Keep the deferred reply as a hidden placeholder (Discord can fail to render mentions on edit)
      await interaction.editReply({ content: '\u200B' });

      // Send ALL chunks as followUps so mentions render consistently
      for (let i = 0; i < chunks.length; i++) {
        await interaction.followUp({
          content: chunks[i],
          ephemeral: true,
          allowedMentions: { parse: ['users'] }
        });
      }
      
      console.log('✅ Distribution shown via Show button (ephemeral)');
    } catch (error) {
      console.error('❌ Error showing distribution:', error);
      await interaction.editReply(`❌ Error: ${error.message}`);
    }
  }

  /**
   * Handle Help button
   */
  async handleHelpButton(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('❓ Help - Admin Controls')
      .setDescription('Here are all the available controls:')
      .addFields(
        { name: '📋 Swaps Left', value: 'Show players who haven\'t moved yet', inline: true },
        { name: '🔄 Refresh', value: 'Refresh data from Google Sheets', inline: true },
        { name: '✅ Mark Done', value: 'Mark players as done (moved)', inline: true },
        { name: '🔀 Move', value: 'Move or Hold a player to a specific clan', inline: true },
        { name: '📅 Schedule', value: 'Schedule swap post for later', inline: true },
        { name: '👁️ Show', value: 'Show current distribution', inline: true },
        { name: '➕ Add a player', value: 'Map in-game ID to Discord user', inline: true },
        { name: '🗑️ Reset', value: 'Reset swap or all settings', inline: true }
      )
      .addFields(
        { name: '\n📝 Commands', value: '`/swap` - Create new distribution\n`/admin` - Open this panel', inline: false }
      )
      .setFooter({ text: 'All actions are private (only you can see them)' });
    
    await interaction.editReply({ embeds: [embed] });
  }

  /**
   * Handle Add Player button - opens Modal
   */
  async handleAddPlayerButton(interaction) {
    const modal = new ModalBuilder()
      .setCustomId('add_player_modal')
      .setTitle('➕ Add a Player');

    const ingameIdInput = new TextInputBuilder()
      .setCustomId('ingame_id')
      .setLabel('In-game ID (Numbers only)')
      .setPlaceholder('Enter the player ID (e.g., 5015942)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(20);

    const discordIdInput = new TextInputBuilder()
      .setCustomId('discord_id')
      .setLabel('Discord User ID')
      .setPlaceholder('Right-click user → Copy User ID (e.g., 123456789012345678)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(17)
      .setMaxLength(20);

    const ingameRow = new ActionRowBuilder().addComponents(ingameIdInput);
    const discordRow = new ActionRowBuilder().addComponents(discordIdInput);

    modal.addComponents(ingameRow, discordRow);

    await interaction.showModal(modal);
  }

  /**
   * Handle Schedule button from Admin Controls
   */
  async handleOpenScheduleButton(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    // Check if schedule exists
    if (this.scheduledData) {
      const channel = await this.client.channels.fetch(this.scheduledData.channelId).catch(() => null);
      
      // Check if it's Auto-Send mode
      if (this.scheduledData.autoSend) {
        // Check if monitoring has started
        if (this.autoSendMode) {
          // Auto-Send is actively monitoring
          const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('🔄 Smart Auto-Send Active')
            .setDescription('The bot is actively monitoring for data changes and will auto-post when detected.')
            .addFields(
              { name: '📺 Channel', value: channel ? `${channel}` : 'Unknown', inline: true },
              { name: '🔄 Check Interval', value: 'Every 5 minutes', inline: true },
              { name: '📊 Monitored Columns', value: 'B, C, D (ignores E)', inline: true },
              { name: '📸 Baseline', value: 'Snapshot from schedule creation', inline: true }
            )
            .setFooter({ text: 'Changes in Action column (E) are ignored • Monitoring active' });

          const buttonRow = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId('schedule_delete')
                .setLabel('Stop Auto-Send')
                .setEmoji('🛑')
                .setStyle(ButtonStyle.Danger),
              new ButtonBuilder()
                .setCustomId('schedule_view_preview')
                .setLabel('Preview')
                .setEmoji('👁️')
                .setStyle(ButtonStyle.Secondary)
            );

          await interaction.editReply({ embeds: [embed], components: [buttonRow] });
        } else {
          // Scheduled Auto-Send waiting to start
          const scheduledTime = new Date(this.scheduledData.timestamp);
          const now = new Date();
          const diff = scheduledTime - now;
          
          const hoursUntil = Math.floor(diff / 1000 / 60 / 60);
          const minsUntil = Math.floor((diff / 1000 / 60) % 60);
          
          const embed = new EmbedBuilder()
            .setColor(0xffa500)
            .setTitle('⏰ Smart Auto-Send Scheduled')
            .setDescription(`Monitoring will start at **${this.scheduledData.datetime} UTC**`)
            .addFields(
              { name: '⏰ Monitoring Starts In', value: `${hoursUntil}h ${minsUntil}m`, inline: true },
              { name: '📺 Channel', value: channel ? `${channel}` : 'Unknown', inline: true },
              { name: '🔄 Check Interval', value: 'Every 5 minutes', inline: true },
              { name: '📊 Monitored Columns', value: 'B, C, D (ignores E)', inline: true },
              { name: '📸 Baseline', value: 'Snapshot from schedule creation', inline: true }
            )
            .setFooter({ text: 'Comparison baseline: Data at schedule creation time' });

          const buttonRow = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId('schedule_delete')
                .setLabel('Cancel Schedule')
                .setEmoji('🗑️')
                .setStyle(ButtonStyle.Danger),
              new ButtonBuilder()
                .setCustomId('schedule_view_preview')
                .setLabel('Preview')
                .setEmoji('👁️')
                .setStyle(ButtonStyle.Secondary)
            );

          await interaction.editReply({ embeds: [embed], components: [buttonRow] });
        }
      } else {
        // Time-based schedule
        const scheduledTime = new Date(this.scheduledData.timestamp);
        const now = new Date();
        const diff = scheduledTime - now;
        
        let timeStatus;
        let color;
        
        if (diff > 0) {
          const hoursUntil = Math.floor(diff / 1000 / 60 / 60);
          const minsUntil = Math.floor((diff / 1000 / 60) % 60);
          timeStatus = `${hoursUntil}h ${minsUntil}m remaining`;
          color = 0x00ff00;
        } else {
          const hoursAgo = Math.floor(Math.abs(diff) / 1000 / 60 / 60);
          const minsAgo = Math.floor((Math.abs(diff) / 1000 / 60) % 60);
          timeStatus = `${hoursAgo}h ${minsAgo}m ago (pending execution)`;
          color = 0xffa500;
        }
        
        const embed = new EmbedBuilder()
          .setColor(color)
          .setTitle('📅 Swap Schedule')
          .setDescription('You have an active schedule:')
          .addFields(
            { name: '📺 Channel', value: channel ? `${channel}` : 'Unknown', inline: true },
            { name: '⏰ Date & Time (UTC)', value: this.scheduledData.datetime, inline: true },
            { name: '⏳ Status', value: timeStatus, inline: false }
          )
          .setFooter({ text: 'Use the buttons below to manage your schedule' });

        const buttonRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('schedule_edit')
              .setLabel('Edit')
              .setEmoji('✏️')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId('schedule_delete')
              .setLabel('Delete')
              .setEmoji('🗑️')
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId('schedule_view_preview')
              .setLabel('Preview')
              .setEmoji('👁️')
              .setStyle(ButtonStyle.Secondary)
          );

        await interaction.editReply({ embeds: [embed], components: [buttonRow] });
      }
    } else {
      // Show schedule creation UI
      const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('schedule_channel_select')
        .setPlaceholder('Select a channel to post in')
        .setChannelTypes(ChannelType.GuildText);

      const channelRow = new ActionRowBuilder().addComponents(channelSelect);

      const buttonRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('schedule_set_time')
            .setLabel('Set Schedule')
            .setEmoji('📅')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('schedule_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
        );

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('📅 Schedule Swap')
        .setDescription('**Step 1:** ✅ Select a channel\n**Step 2:** Click "Set Schedule" to choose time-based or auto-send mode')
        .addFields(
          { name: '📺 Channel', value: '_Not selected_', inline: true },
          { name: '⏰ Schedule Type', value: '_Not set_', inline: true }
        )
        .setFooter({ text: 'You can choose between time-based scheduling or smart auto-send in the next step' });

      await interaction.editReply({
        embeds: [embed],
        components: [channelRow, buttonRow]
      });
    }
  }


  /**
   * Handle Modal submissions
   */
  async handleModalSubmit(interaction) {
    const customId = interaction.customId;
    
    try {
      if (customId === 'schedule_datetime_modal') {
        await interaction.deferReply({ ephemeral: true });
        
        const date = interaction.fields.getTextInputValue('schedule_date').trim();
        const time = interaction.fields.getTextInputValue('schedule_time').trim();
        const autoSendResponse = interaction.fields.getTextInputValue('schedule_auto_send').trim().toLowerCase();
        
        // Get the stored channel
        const channelId = this.pendingScheduleChannel.get(interaction.user.id);
        
        if (!channelId) {
          await interaction.editReply('❌ Channel not found. Please start over');
          return;
        }
        
        // Auto-run swap if no data exists
        if (!this.distributionManager.allPlayers || this.distributionManager.allPlayers.length === 0) {
          const finalRange = `${config.googleSheets.masterFinalSheetName || 'Master_Final'}!A:Z`;
          this.playersData = await fetchPlayersDataWithDiscordNames({ range: finalRange });
          if (this.playersData && this.playersData.length > 0) {
            this.distributionManager.distribute(this.playersData);
            console.log('📊 Auto-distributed players for schedule');
          }
        }
        
        // Validate date and time
        if (!date || !time) {
          await interaction.editReply('❌ Please provide both date and time');
          return;
        }
        
        const datetime = `${date} ${time}`;
        
        // Check if Auto-Send is enabled
        const isAutoSend = autoSendResponse === 'yes' || autoSendResponse === 'y';
        
        if (isAutoSend) {
          // Scheduled Auto-Send mode: Start monitoring at specified time
          // IMPORTANT: Snapshot is taken NOW, not at start time
          
          // Parse the scheduled date for validation
          const [datePart, timePart] = datetime.split(' ');
          const [year, month, day] = datePart.split('-').map(Number);
          const [hour, minute] = timePart.split(':').map(Number);
          const scheduledDate = new Date(Date.UTC(year, month - 1, day, hour, minute));
          const now = new Date();
          const diff = scheduledDate.getTime() - now.getTime();
          
          if (diff < 0) {
            await interaction.editReply('❌ Scheduled time must be in the future');
            return;
          }
          
          const hoursUntil = Math.floor(diff / 1000 / 60 / 60);
          const minsUntil = Math.floor((diff / 1000 / 60) % 60);
          
          if (config.googleSheets.masterSyncEnabled) {
            console.log('🔁 Master Sync: Copying Master_CSV -> Master_Final (on schedule creation - auto-send)...');
            await this.checkAndExecuteMasterSync();
          }

          // Create initial snapshot NOW (at schedule creation time)
          const finalRange = `${config.googleSheets.masterFinalSheetName || 'Master_Final'}!A:Z`;
          this.playersData = await fetchPlayersDataWithDiscordNames({ range: finalRange });
          this.dataSnapshot = this.createDataSnapshot(this.playersData);
          console.log('📸 Created data snapshot at schedule creation time');
          
          // Save schedule with Auto-Send mode
          this.scheduledData = {
            channelId: channelId,
            creationChannelId: interaction.channel.id,
            datetime: datetime,
            timestamp: scheduledDate.getTime(),
            autoSend: true,
            continuousAutoSend: true
          };
          
          this.saveSchedule();
          this.autoSendMode = false; // Will be activated when time arrives
          
          const channel = await this.client.channels.fetch(channelId);
          
          const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('✅ Smart Auto-Send Scheduled')
            .setDescription(`**Intelligent monitoring will start at ${datetime} UTC**\n\nThe bot will compare data against the current snapshot and auto-post when changes are detected in ${channel}.`)
            .addFields(
              { name: '⏰ Monitoring Starts In', value: `${hoursUntil}h ${minsUntil}m`, inline: true },
              { name: '🔄 Check Interval', value: 'Every 30 seconds', inline: true },
              { name: '📊 Monitored Columns', value: 'B, C, D (ignores E)', inline: true },
              { name: '📺 Channel', value: `${channel}`, inline: true },
              { name: '📸 Snapshot Taken', value: 'Now (at schedule creation)', inline: true }
            )
            .setFooter({ text: 'Comparison baseline: Current data • Monitoring starts: ' + datetime + ' UTC' })
            .setTimestamp();
          
          const buttonRow = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId('schedule_delete')
                .setLabel('Cancel Schedule')
                .setEmoji('🗑️')
                .setStyle(ButtonStyle.Danger),
              new ButtonBuilder()
                .setCustomId('schedule_view_preview')
                .setLabel('Preview')
                .setEmoji('👁️')
                .setStyle(ButtonStyle.Secondary)
            );
          
          await interaction.editReply({ embeds: [embed], components: [buttonRow] });
          this.pendingScheduleChannel.delete(interaction.user.id);
          console.log(`✅ Scheduled Auto-Send mode: monitoring starts at ${datetime}, snapshot taken now`);
          
        } else {
          // Regular time-based schedule (post once)
          const result = await this.processScheduleCreation(interaction, datetime, channelId);
          
          if (result.success) {
            const channel = await this.client.channels.fetch(channelId);
            
            const embed = new EmbedBuilder()
              .setColor(0x00ff00)
              .setTitle('✅ Swap Scheduled')
              .setDescription(`The swap will be posted in ${channel} at **${datetime} UTC**`)
              .addFields(
                { name: '⏰ Time Until Post', value: `${result.hoursUntil}h ${result.minsUntil}m`, inline: true },
                { name: '📺 Channel', value: `${channel}`, inline: true }
              )
              .setFooter({ text: 'The schedule checker runs every 30 seconds to ensure delivery' })
              .setTimestamp();

            const buttonRow = new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId('schedule_view_preview')
                  .setLabel('👁️ Preview Message')
                  .setStyle(ButtonStyle.Secondary)
              );

            await interaction.editReply({ embeds: [embed], components: [buttonRow] });
            this.pendingScheduleChannel.delete(interaction.user.id);
          } else {
            await interaction.editReply(`❌ ${result.error}`);
          }
        }
      }
      
      // Handle Add Player Modal
      if (customId === 'add_player_modal') {
        await interaction.deferReply({ ephemeral: true });
        
        const ingameId = interaction.fields.getTextInputValue('ingame_id').trim();
        const discordId = interaction.fields.getTextInputValue('discord_id').trim();
        
        // Validate In-game ID (should be numeric)
        if (!/^\d+$/.test(ingameId)) {
          await interaction.editReply('❌ Invalid In-game ID. It should contain numbers only (e.g., 5015942)');
          return;
        }
        
        // Validate Discord ID (should be numeric)
        if (!/^\d{17,20}$/.test(discordId)) {
          await interaction.editReply('❌ Invalid Discord ID. It should be a 17-20 digit number.\n\nTo get a Discord ID:\n1. Enable Developer Mode in Discord Settings\n2. Right-click on the user\n3. Click "Copy User ID"');
          return;
        }
        
        try {
          // Try to fetch the user to verify the ID exists
          const user = await this.client.users.fetch(discordId).catch(() => null);
          
          if (!user) {
            await interaction.editReply(`❌ Could not find a Discord user with ID: ${discordId}`);
            return;
          }
          
          // Map the player
          const success = await mapPlayerToDiscord(ingameId, discordId);
          
          if (success) {
            const embed = new EmbedBuilder()
              .setColor(0x00ff00)
              .setTitle('✅ Player Added')
              .setDescription(`Successfully mapped player to Discord account`)
              .addFields(
                { name: '🎮 In-game ID', value: ingameId, inline: true },
                { name: '👤 Discord User', value: `<@${discordId}>`, inline: true }
              )
              .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
          } else {
            await interaction.editReply(`❌ Failed to add player. Please try again.`);
          }
        } catch (error) {
          console.error('❌ Error adding player:', error);
          await interaction.editReply(`❌ Error: ${error.message}`);
        }
      }
      
    } catch (error) {
      console.error(`❌ Error handling modal ${customId}:`, error);
      await interaction.editReply(`❌ Error: ${error.message}`);
    }
  }

  /**
   * Handle "Show Swaps Left" button
   */
  async handleSwapsLeftButton(interaction) {
    const ok = await this.ensureDistributionLoaded();
    if (!ok) {
      await interaction.editReply('⚠️ No swap found. Please run `/swap` first.');
      return;
    }

    // Get the swaps left text and players list (hideCompleted=true for new messages)
    const result = this.distributionManager.getSwapsLeft(true);

    // If all players are done, send only SWAPS COMPLETED
    if (result.completed) {
      await interaction.editReply('✅ All players completed!');
      await interaction.channel.send(' -\n\n**SWAPS COMPLETED**');
      this.swapsLeftCompletionSent = true;
      this.lastSwapsLeftMessages = [];
      this.swapsLeftPlayersList = result.players;
      this.saveMessageIds();
      return;
    }

    // Send the list publicly (not ephemeral) and save the message
    await interaction.editReply('📋 Sending Swaps Left to channel...');
    this.lastSwapsLeftMessages = await this.sendLongMessage(interaction.channel, result.text);
    
    // Store the message and players list for later updates
    this.swapsLeftPlayersList = result.players;
    this.swapsLeftCompletionSent = false;
    this.saveMessageIds();

    const dmResult = await this.sendSwapsLeftDMs(result.players || []);
    await interaction.followUp({
      content: `📨 DM Summary: ${dmResult.dmsSent} sent, ${dmResult.dmsFailed} failed, ${dmResult.skippedNoId} skipped (no ID)`,
      ephemeral: true
    });
  }

  /**
   * Handle "Refresh" button
   */
  async handleRefreshButton(interaction) {
    await this.handleRefresh(interaction);
  }

  /**
   * Handle "Mark Done" button
   */
  async handleMarkDoneButton(interaction) {
    const ok = await this.ensureDistributionLoaded();
    if (!ok) {
      await interaction.editReply('⚠️ No swap found. Please run `/swap` first.');
      return;
    }

    // Get ALL players grouped by clan (including done players)
    const playersByClans = {
      RGR: [],
      OTL: [],
      RND: [],
      WILDCARDS: []
    };
    
    let totalNotDone = 0;
    
    ['RGR', 'OTL', 'RND', 'WILDCARDS'].forEach(groupName => {
      if (this.distributionManager.groups[groupName]) {
        console.log(`📊 ${groupName}: ${this.distributionManager.groups[groupName].length} players`);
        this.distributionManager.groups[groupName].forEach(player => {
          const identifier = this.distributionManager.getPlayerIdentifier(player);
          
          let isDone = this.distributionManager.completedPlayers.has(identifier);
          if (!isDone && player.DiscordName) {
            isDone = this.distributionManager.completedPlayers.has(player.DiscordName);
          }
          
          // Get original name from Master_CSV (Name column)
          const originalName = player.OriginalName || player.Name || player.Player || player.USERNAME || '';
          
          // Get Discord ID for mention
          const discordId = player['Discord-ID'] || null;
          
          // Truncate label if too long (Discord limit is 100 chars)
          // Add ✅ prefix for done players
          let label = isDone ? `✅ ${originalName || identifier}` : (originalName || identifier);
          if (label.length > 100) {
            label = label.substring(0, 97) + '...';
          }
          
          playersByClans[groupName].push({
            name: label,
            identifier: identifier,
            discordId: discordId,
            originalName: originalName,
            isDone: isDone
          });
          
          if (!isDone) totalNotDone++;
        });
      } else {
        console.log(`⚠️ ${groupName}: group is undefined or null`);
      }
    });
    
    console.log(`📋 Final playersByClans counts:`);
    console.log(`  RGR: ${playersByClans.RGR.length}`);
    console.log(`  OTL: ${playersByClans.OTL.length}`);
    console.log(`  RND: ${playersByClans.RND.length}`);
    console.log(`  WILDCARDS: ${playersByClans.WILDCARDS.length}`);

    if (totalNotDone === 0) {
      // Send public completion message
      await interaction.channel.send('**SWAPS COMPLETED**');
      
      // Send ephemeral confirmation
      await interaction.editReply('✅ All players have moved!');
      return;
    }

    const buildSelectMenuRows = (baseCustomId, placeholder, players) => {
      const rows = [];

      const makeUniqueOptionValue = (identifier, suffix) => {
        const base = String(identifier ?? 'unknown');
        const value = `${base}|${suffix}`;
        if (value.length <= 100) return value;
        const maxBaseLen = Math.max(1, 100 - String(suffix).length - 1);
        return `${base.slice(0, maxBaseLen)}|${suffix}`;
      };

      for (let pageIndex = 0; pageIndex < players.length; pageIndex += 25) {
        const page = players.slice(pageIndex, pageIndex + 25);
        const options = page.map((player, idx) => ({
          label: player.name,
          value: makeUniqueOptionValue(player.identifier, pageIndex + idx)
        }));

        const pageNumber = Math.floor(pageIndex / 25) + 1;
        const totalPages = Math.ceil(players.length / 25);

        const customId = pageNumber === 1
          ? baseCustomId
          : `${baseCustomId}_page_${pageNumber}`;

        const menu = new StringSelectMenuBuilder()
          .setCustomId(customId)
          .setPlaceholder(totalPages > 1 ? `${placeholder} (${pageNumber}/${totalPages})` : placeholder)
          .setMinValues(0)
          .setMaxValues(Math.min(options.length, 25))
          .addOptions(options);

        rows.push(new ActionRowBuilder().addComponents(menu));
      }

      return rows;
    };

    // Create select menus (Discord limit: 25 options per menu, 5 rows per message)
    const components = [];
    const extraComponentBatches = [];

    // RGR Select Menu - show ALL players
    if (playersByClans.RGR.length > 0) {
      const rgrRemaining = playersByClans.RGR.filter(p => !p.isDone).length;
      const rgrRows = buildSelectMenuRows('select_rgr_done', `RGR (${rgrRemaining} remaining)`, playersByClans.RGR);
      components.push(...rgrRows);
    }

    // OTL Select Menu - show ALL players
    if (playersByClans.OTL.length > 0) {
      const otlRemaining = playersByClans.OTL.filter(p => !p.isDone).length;
      const otlRows = buildSelectMenuRows('select_otl_done', `OTL (${otlRemaining} remaining)`, playersByClans.OTL);
      components.push(...otlRows);
    }

    // RND Select Menu - show ALL players
    if (playersByClans.RND.length > 0) {
      const rndRemaining = playersByClans.RND.filter(p => !p.isDone).length;
      const rndRows = buildSelectMenuRows('select_rnd_done', `RND (${rndRemaining} remaining)`, playersByClans.RND);
      components.push(...rndRows);
    }

    // WILDCARDS Select Menu - show ALL players (even if all are done)
    if (playersByClans.WILDCARDS.length > 0) {
      const wildcardsRemaining = playersByClans.WILDCARDS.filter(p => !p.isDone).length;
      const wildRows = buildSelectMenuRows('select_wildcards_done', `WILDCARDS (${wildcardsRemaining} remaining)`, playersByClans.WILDCARDS);
      components.push(...wildRows);
    }

    // Add instructions
    const instructions = `Select players to mark as done (${totalNotDone} remaining):\n\n` +
      `**How to use:**\n` +
      `• Select a player → Adds ✅ mark\n` +
      `• Select same player again → Removes ✅ mark`;
    
    const MAX_ROWS_PER_MESSAGE = 5;
    const firstBatch = components.slice(0, MAX_ROWS_PER_MESSAGE);
    const remainingRows = components.slice(MAX_ROWS_PER_MESSAGE);

    await interaction.editReply({
      content: instructions,
      components: firstBatch
    });

    if (remainingRows.length > 0) {
      for (let i = 0; i < remainingRows.length; i += MAX_ROWS_PER_MESSAGE) {
        const batch = remainingRows.slice(i, i + MAX_ROWS_PER_MESSAGE);
        await interaction.followUp({
          content: 'More players:',
          components: batch,
          ephemeral: true
        });
      }
    }
  }

  /**
   * Handle player selection from select menu
   */
  async handleSelectPlayersDone(interaction) {
    const selectedIdentifiers = (interaction.values || []).map(v => String(v).split('|')[0]);
    const userId = interaction.user.id;
    
    console.log(`🔍 Selected identifiers: ${selectedIdentifiers.join(', ')}`);
    console.log(`📋 Current completed players: ${Array.from(this.distributionManager.completedPlayers).join(', ')}`);
    
    // Get previously selected players for this user
    const previouslySelected = this.lastSelectedPlayers.get(userId) || [];
    
    // Check if selection was cleared (user deselected all)
    if (!selectedIdentifiers || selectedIdentifiers.length === 0) {
      // If there were previously selected players, unmark them
      if (previouslySelected.length > 0) {
        let unmarkedCount = 0;
        previouslySelected.forEach(identifier => {
          if (this.distributionManager.completedPlayers.has(identifier)) {
            this.distributionManager.completedPlayers.delete(identifier);
            console.log(`❌ Unmarking (cleared): ${identifier}`);
            unmarkedCount++;
          }
          // Also try by DiscordName
          const player = this.distributionManager.findPlayer(identifier);
          if (player && player.DiscordName && this.distributionManager.completedPlayers.has(player.DiscordName)) {
            this.distributionManager.completedPlayers.delete(player.DiscordName);
          }
        });
        
        // Clear the stored selection
        this.lastSelectedPlayers.delete(userId);
        
        if (unmarkedCount > 0) {
          // Update distribution messages
          const formattedText = this.distributionManager.getFormattedDistribution();
          await this.updateDistributionMessages(formattedText);
          await interaction.editReply(`❌ Unmarked ${unmarkedCount} player(s)`);
          return;
        }
      }
      
      await interaction.editReply('ℹ️ No players selected. Select players from the dropdown to mark/unmark them.');
      return;
    }
    
    // Store current selection for next time
    this.lastSelectedPlayers.set(userId, [...selectedIdentifiers]);
    
    // Toggle players: if already marked as done, unmark them; otherwise mark them
    let markedCount = 0;
    let unmarkedCount = 0;
    
    selectedIdentifiers.forEach(identifier => {
      // Also check by DiscordName mention
      let isMarked = this.distributionManager.completedPlayers.has(identifier);
      
      // Try to find player and check by Discord-ID too
      if (!isMarked) {
        const player = this.distributionManager.findPlayer(identifier);
        if (player && player.DiscordName) {
          isMarked = this.distributionManager.completedPlayers.has(player.DiscordName);
        }
      }
      
      if (isMarked) {
        // Player is already marked - unmark them
        console.log(`❌ Unmarking: ${identifier}`);
        this.distributionManager.completedPlayers.delete(identifier);
        
        // Also try to remove by DiscordName
        const player = this.distributionManager.findPlayer(identifier);
        if (player && player.DiscordName) {
          this.distributionManager.completedPlayers.delete(player.DiscordName);
        }
        
        unmarkedCount++;
      } else {
        // Player is not marked - mark them
        console.log(`✅ Marking: ${identifier}`);
        this.distributionManager.completedPlayers.add(identifier);
        markedCount++;
      }
    });

    // Update distribution messages
    const formattedText = this.distributionManager.getFormattedDistribution();
    await this.updateDistributionMessages(formattedText);

    // Update swapsleft messages if they exist
    if (this.lastSwapsLeftMessages && this.lastSwapsLeftMessages.length > 0) {
      // Use the stored players list for updates (only show players from original message)
      const result = this.distributionManager.getSwapsLeft(false, this.swapsLeftPlayersList);
      const swapsLeftText = result.text;
      const safeText = this.sanitizeMessageContent(swapsLeftText);
      const chunks = this.splitTextByLinesToChunks(safeText, 2000);

      if (chunks.length > this.lastSwapsLeftMessages.length) {
        console.warn(
          `⚠️ SwapsLeft now needs ${chunks.length} message(s) but only ${this.lastSwapsLeftMessages.length} are saved. ` +
          `Not sending new messages automatically. Please run /swapsleft to recreate swaps left messages.`
        );
      }

      for (let i = 0; i < Math.min(chunks.length, this.lastSwapsLeftMessages.length); i++) {
        try {
          await this.lastSwapsLeftMessages[i].edit({ content: chunks[i], allowedMentions: { parse: ['users'] } });
        } catch (error) {
          console.error(`❌ Failed to update swapsleft message ${i + 1}: ${error.message}`);
        }
      }

      if (result.completed && !this.swapsLeftCompletionSent) {
        try {
          await this.lastSwapsLeftMessages[0].channel.send(' -\n\n**SWAPS COMPLETED**');
          this.swapsLeftCompletionSent = true;
        } catch (error) {
          console.warn('⚠️ Failed to send SWAPS COMPLETED message:', error.message);
        }
      }
    }

    // Build response message
    let responseMsg = '';
    if (markedCount > 0) {
      responseMsg += `✅ Marked ${markedCount} player(s) as done`;
    }
    if (unmarkedCount > 0) {
      if (responseMsg) responseMsg += '\n';
      responseMsg += `❌ Unmarked ${unmarkedCount} player(s)`;
    }
    if (!responseMsg) {
      responseMsg = '⚠️ No changes made';
    }

    await interaction.editReply(responseMsg);
  }


  /**
   * Handle /swap command (formerly /distribute)
   */
  async handleDistribute(interaction) {
    const columnName = 'Trophies'; // Always use Trophies column
    const seasonNumber = interaction.options.getString('season'); // Get season number from options

    // Fetch fresh data with Discord names
    const finalRange = `${config.googleSheets.masterFinalSheetName || 'Master_Final'}!A:Z`;
    this.playersData = await fetchPlayersDataWithDiscordNames({ range: finalRange });

    if (this.playersData.length === 0) {
      await interaction.editReply('❌ No data found in Google Sheet');
      return;
    }

    // Check if column exists
    const firstPlayer = this.playersData[0];
    if (!firstPlayer[columnName]) {
      const availableColumns = Object.keys(firstPlayer).join(', ');
      await interaction.editReply(
        `❌ Column "${columnName}" not found.\n\n**Available columns:**\n${availableColumns}`
      );
      return;
    }

    // Save for later use in /done command
    this.lastColumnName = columnName;
    this.lastSeasonNumber = seasonNumber;
    
    // Distribute players with optional season number
    this.distributionManager.distribute(this.playersData, columnName, seasonNumber);
    const summary = this.distributionManager.getSummary();

    this.lastChannelId = interaction.channel?.id || this.lastChannelId;

    const stateToSave = {
      channelId: this.lastChannelId,
      distributionMessageIds: this.lastDistributionMessages.map(msg => msg.id),
      swapsLeftMessageIds: this.lastSwapsLeftMessages.map(msg => msg.id),
      sortColumn: this.distributionManager.sortColumn || 'Trophies',
      seasonNumber: this.distributionManager.customSeasonNumber || seasonNumber || null,
      completedPlayers: Array.from(this.distributionManager.completedPlayers),
      timestamp: Date.now()
    };

    updateBotState(stateToSave)
      .then(() => console.log('💾 Saved BotState to Google Sheets (on /swap)'))
      .catch((error) => console.warn('⚠️ Failed to save BotState to Google Sheets (on /swap):', error.message));

    // Create embed
    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('✅ Distribution Complete')
      .setDescription(`Sorted by: **${columnName}**${seasonNumber ? `\nSeason: **${seasonNumber}**` : ''}`)
      .addFields(
        { name: '🏆 RGR', value: `${summary.groups.RGR} players`, inline: true },
        { name: '🏆 OTL', value: `${summary.groups.OTL} players`, inline: true },
        { name: '🏆 RND', value: `${summary.groups.RND} players`, inline: true },
        { name: '📊 Total', value: `${summary.total} players`, inline: false },
        { name: '🚫 Excluded', value: `${summary.excluded} players`, inline: true }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    // Send or update detailed distribution
    const formattedText = this.distributionManager.getFormattedDistribution();
    
    // Check if messages exist and are still valid
    let messagesValid = false;
    if (this.lastDistributionMessages.length > 0) {
      try {
        // Try to fetch the first message to verify it still exists
        await this.lastDistributionMessages[0].fetch();
        messagesValid = true;
      } catch (error) {
        console.log('⚠️ Saved messages no longer exist, creating new ones');
        this.lastDistributionMessages = [];
        this.lastChannelId = null;
      }
    }
    
    // If messages exist and are valid, update them
    if (messagesValid) {
      await this.updateDistributionMessages(formattedText);
      
      // Send a notification that the existing message was updated
      await interaction.followUp({
        content: '✅ Distribution updated in the existing message',
        ephemeral: true
      });
    } else {
      // Don't send to channel - just show preview and admin controls (ephemeral)
      // Send preview as ephemeral
      const header = '**Preview:**\n\n';

      const chunks = this.splitDistributionToChunks(formattedText, 2000 - header.length);
      
      // Send first chunk with header
      await interaction.followUp({ 
        content: header + (chunks[0] || ''), 
        ephemeral: true,
        allowedMentions: { parse: ['users'] }
      });
      
      // Send remaining chunks
      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({ 
          content: chunks[i], 
          ephemeral: true,
          allowedMentions: { parse: ['users'] }
        });
      }
      
      // Send admin controls as ephemeral followUp
      await interaction.followUp({
        content: '**Admin Controls** (Only you can see this)',
        components: this.createDistributionButtons(),
        ephemeral: true
      });
    }
  }

  /**
   * Handle /move command
   */
  async handleMove(interaction) {
    const discordUser = interaction.options.getUser('player');
    const targetGroup = interaction.options.getString('clan');

    try {
      // Use Discord ID directly - no need to search in memory
      const discordId = discordUser.id;
      
      console.log(`🔄 Moving player: ${discordUser.username} (Discord ID: ${discordId}) to ${targetGroup}`);
      console.log(`📋 User object:`, {
        id: discordUser.id,
        username: discordUser.username,
        tag: discordUser.tag,
        discriminator: discordUser.discriminator
      });
      
      // Refresh data first to get latest info
      const finalRange = `${config.googleSheets.masterFinalSheetName || 'Master_Final'}!A:Z`;
      this.playersData = await fetchPlayersDataWithDiscordNames({ range: finalRange });
      
      // Find player's current clan from playersData
      let playerCurrentClan = null;
      if (this.playersData && this.playersData.length > 0) {
        // Search by Discord-ID (compare as strings, trimmed)
        const player = this.playersData.find(p => {
          const pDiscordId = p['Discord-ID'] || p['DiscordID'] || p['Discord_ID'] || '';
          return String(pDiscordId).trim() === String(discordId).trim();
        });
        
        if (player) {
          // Try multiple possible clan column names
          playerCurrentClan = player.Clan || player.clan || player.CLAN || 
                              player.Team || player.team || player.TEAM ||
                              player.Guild || player.guild || null;
          console.log(`📋 Found player: ${player.Name || player.Player || 'Unknown'}`);
          console.log(`📋 Player's current clan: ${playerCurrentClan}`);
          console.log(`📋 Player object keys:`, Object.keys(player));
        } else {
          console.log(`⚠️ Player not found in playersData by Discord-ID: ${discordId}`);
        }
      }
      
      // Check if player is already in the target clan - write HOLD instead
      let actionToWrite = targetGroup;
      let messageText = `**${discordUser.username}** has been assigned to **${targetGroup}**`;
      
      if (playerCurrentClan && playerCurrentClan.toUpperCase() === targetGroup.toUpperCase()) {
        actionToWrite = 'Hold';
        messageText = `**${discordUser.username}** will stay in **${targetGroup}** (already in clan)`;
        console.log(`⏸️ Player already in ${targetGroup}, writing HOLD instead`);
      }
      
      // Write directly to Google Sheet Action column
      await writePlayerAction(discordId, actionToWrite);
      
      // Refresh distribution and update messages
      this.playersData = await fetchPlayersDataWithDiscordNames({ range: finalRange });
      const sortColumn = this.distributionManager.sortColumn || 'Trophies';
      this.distributionManager.distribute(this.playersData, sortColumn);
      
      // Update distribution messages
      const formattedText = this.distributionManager.getFormattedDistribution();
      await this.updateDistributionMessages(formattedText);
      
      // Success message
      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle(actionToWrite === 'Hold' ? '⏸️ Player Stays' : '✅ Player Moved')
        .setDescription(messageText)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      console.error('Error in handleMove:', error);
      
      let description = `**Failed to move ${discordUser.username}**\n\n`;
      
      // Check if it's a "player not found" error
      if (error.message.includes('Player not found')) {
        description += `❌ **Player not found in DiscordMap**\n\n`;
        description += `Please use \`/map\` command first to link this player:\n`;
        description += `\`\`\`\n/map ingame_id:${discordUser.username} discord_id:@${discordUser.username}\n\`\`\``;
      } else {
        description += `**Error:** ${error.message}`;
      }
      
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('❌ Move Failed')
        .setDescription(description)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  }

  /**
   * Handle /exclude command (hold)
   */
  async handleExclude(interaction) {
    const discordUser = interaction.options.getUser('player');

    try {
      // Use Discord ID directly
      const discordId = discordUser.id;
      
      console.log(`⏸️ Excluding player: ${discordUser.username} (${discordId})`);
      
      // Write "Hold" directly to Google Sheet Action column
      await writePlayerAction(discordId, 'Hold');
      
      // Refresh distribution and update messages
      const finalRange = `${config.googleSheets.masterFinalSheetName || 'Master_Final'}!A:Z`;
      this.playersData = await fetchPlayersDataWithDiscordNames({ range: finalRange });
      const sortColumn = this.distributionManager.sortColumn || 'Trophies';
      this.distributionManager.distribute(this.playersData, sortColumn);
      
      // Update distribution messages
      const formattedText = this.distributionManager.getFormattedDistribution();
      await this.updateDistributionMessages(formattedText);
      
      // Success message
      const embed = new EmbedBuilder()
        .setColor(0xff9900)
        .setTitle('✅ Player Excluded')
        .setDescription(`**${discordUser.username}** has been excluded from distribution`)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      console.error('Error in handleExclude:', error);
      
      let description = `**Failed to exclude ${discordUser.username}**\n\n`;
      
      // Check if it's a "player not found" error
      if (error.message.includes('Player not found')) {
        description += `❌ **Player not found in DiscordMap**\n\n`;
        description += `Please use \`/map\` command first to link this player:\n`;
        description += `\`\`\`\n/map ingame_id:${discordUser.username} discord_id:@${discordUser.username}\n\`\`\``;
      } else {
        description += `**Error:** ${error.message}`;
      }
      
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('❌ Exclude Failed')
        .setDescription(description)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  }

  /**
   * Handle /include command
   */
  async handleInclude(interaction) {
    const discordUser = interaction.options.getUser('player');

    try {
      // Use Discord ID directly
      const discordId = discordUser.id;
      
      console.log(`▶️ Including player: ${discordUser.username} (${discordId})`);
      
      // Clear Action column directly in Google Sheet
      const result = await clearPlayerAction(discordId);

      // Build description based on what was cleared
      let description = `**${discordUser.username}** has been added back to distribution`;
      
      if (result.previousValue) {
        description += `\n\n_Cleared previous action: "${result.previousValue}"_`;
      }

      // Refresh distribution and update messages
      const finalRange = `${config.googleSheets.masterFinalSheetName || 'Master_Final'}!A:Z`;
      this.playersData = await fetchPlayersDataWithDiscordNames({ range: finalRange });
      const sortColumn = this.distributionManager.sortColumn || 'Trophies';
      this.distributionManager.distribute(this.playersData, sortColumn);
      
      // Update distribution messages
      const formattedText = this.distributionManager.getFormattedDistribution();
      await this.updateDistributionMessages(formattedText);
      
      // Success message
      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ Player Included')
        .setDescription(description)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      console.error('Error in handleInclude:', error);
      
      let description = `**Failed to include ${discordUser.username}**\n\n`;
      
      // Check if it's a "player not found" error
      if (error.message.includes('Player not found')) {
        description += `❌ **Player not found in DiscordMap**\n\n`;
        description += `Please use \`/map\` command first to link this player:\n`;
        description += `\`\`\`\n/map ingame_id:${discordUser.username} discord_id:@${discordUser.username}\n\`\`\``;
      } else {
        description += `**Error:** ${error.message}`;
      }
      
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('❌ Include Failed')
        .setDescription(description)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  }

  /**
   * Handle /show command
   */
  async handleShow(interaction) {
    const summary = this.distributionManager.getSummary();

    if (summary.total === 0) {
      await interaction.editReply('❌ No distribution yet. Use `/distribute` first');
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle('📊 Current Distribution')
      .addFields(
        { name: '🏆 RGR', value: `${summary.groups.RGR} players`, inline: true },
        { name: '🏆 OTL', value: `${summary.groups.OTL} players`, inline: true },
        { name: '🏆 RND', value: `${summary.groups.RND} players`, inline: true },
        { name: '📊 Total', value: `${summary.total} players`, inline: true },
        { name: '🚫 Excluded', value: `${summary.excluded} players`, inline: true }
      );

    if (summary.sortColumn) {
      embed.setDescription(`Sorted by: **${summary.sortColumn}**`);
    }

    await interaction.editReply({ embeds: [embed] });

    // Send detailed distribution
    const formattedText = this.distributionManager.getFormattedDistribution();
    await this.sendLongMessage(interaction.channel, formattedText);
  }

  /**
   * Handle /refresh command
   */
  /**
   * Handle /reset command
   */
  async handleReset(interaction) {
    try {
      const resetType = interaction.options.getString('type');
      
      let description = '';
      let title = '';
      
      if (resetType === 'all') {
        console.log('🔄 Resetting all data (Actions + Distribution)...');
        
        // Clear all actions from DiscordMap sheet
        const result = await clearAllPlayerActions();
        
        // Save current sort column
        const currentSortColumn = this.distributionManager.sortColumn;

        // Refresh data from Google Sheets
        const finalRange = `${config.googleSheets.masterFinalSheetName || 'Master_Final'}!A:Z`;
        this.playersData = await fetchPlayersDataWithDiscordNames({ range: finalRange });

        // Create new distribution manager
        this.distributionManager = new DistributionManager();

        // Re-distribute if there was a previous distribution
        if (this.playersData.length > 0 && currentSortColumn) {
          this.distributionManager.distribute(this.playersData, currentSortColumn);
        }

        // Clear saved messages
        this.lastDistributionMessages = [];
        this.lastSwapsLeftMessages = [];
        this.lastChannelId = null;
        
        // Delete the saved messages file
        if (fs.existsSync(this.messagesFilePath)) {
          fs.unlinkSync(this.messagesFilePath);
          console.log('🗑️ Deleted saved message IDs');
        }

        title = '✅ Reset All Complete';
        description = `**All settings have been reset:**\n\n`;
        description += `✅ Cleared ${result.clearedCount} actions from DiscordMap (Column C)\n`;
        description += `✅ Reset swap manager\n`;
        description += `✅ Cleared saved messages\n`;
        description += `✅ Refreshed player data (${this.playersData.length} players)\n\n`;
        description += `_All /move, /hold actions have been cleared_\n`;
        description += `_Next /swap will create a new distribution message_`;
        
      } else if (resetType === 'swap') {
        console.log('🔄 Resetting distribution only...');
        
        // Save current sort column
        const currentSortColumn = this.distributionManager.sortColumn;

        // Refresh data from Google Sheets (keeps actions)
        const finalRange = `${config.googleSheets.masterFinalSheetName || 'Master_Final'}!A:Z`;
        this.playersData = await fetchPlayersDataWithDiscordNames({ range: finalRange });

        // Create new distribution manager
        this.distributionManager = new DistributionManager();

        // Re-distribute if there was a previous distribution
        if (this.playersData.length > 0 && currentSortColumn) {
          this.distributionManager.distribute(this.playersData, currentSortColumn);
        }

        // Clear saved messages
        this.lastDistributionMessages = [];
        this.lastSwapsLeftMessages = [];
        this.lastChannelId = null;
        
        // Delete the saved messages file
        if (fs.existsSync(this.messagesFilePath)) {
          fs.unlinkSync(this.messagesFilePath);
          console.log('🗑️ Deleted saved message IDs');
        }

        title = '✅ Reset Swap Complete';
        description = `**Swap has been reset:**\n\n`;
        description += `✅ Reset swap manager\n`;
        description += `✅ Cleared saved messages\n`;
        description += `✅ Refreshed player data (${this.playersData.length} players)\n\n`;
        description += `⚠️ All /move, /hold actions are still active\n`;
        description += `_Next /swap will create a new distribution message_`;
      }

      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle(title)
        .setDescription(description)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      console.error('Error in handleReset:', error);
      
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('❌ Reset Failed')
        .setDescription(`**Failed to reset**\n\n**Error:** ${error.message}`)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  }

  /**
   * Handle /schedule command - Show unified schedule management UI
   */
  async handleScheduleMain(interaction) {
    // Check if there's an existing schedule
    const hasSchedule = this.scheduledData !== null;
    
    if (hasSchedule) {
      // Show existing schedule with edit/delete options
      const [datePart, timePart] = this.scheduledData.datetime.split(' ');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hour, minute] = timePart.split(':').map(Number);
      const scheduledDate = new Date(Date.UTC(year, month - 1, day, hour, minute));
      const now = new Date();
      const diff = scheduledDate.getTime() - now.getTime();
      
      let timeStatus, color;
      if (diff > 0) {
        const hoursUntil = Math.floor(diff / 1000 / 60 / 60);
        const minsUntil = Math.floor((diff / 1000 / 60) % 60);
        timeStatus = `${hoursUntil}h ${minsUntil}m remaining`;
        color = 0x00ff00;
      } else {
        const hoursAgo = Math.floor(Math.abs(diff) / 1000 / 60 / 60);
        const minsAgo = Math.floor((Math.abs(diff) / 1000 / 60) % 60);
        timeStatus = `${hoursAgo}h ${minsAgo}m ago (pending execution)`;
        color = 0xffa500;
      }
      
      const channel = await this.client.channels.fetch(this.scheduledData.channelId).catch(() => null);
      
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle('📅 Swap Schedule')
        .setDescription('You have an active schedule:')
        .addFields(
          { name: '📺 Channel', value: channel ? `${channel}` : 'Unknown', inline: true },
          { name: '⏰ Date & Time (UTC)', value: this.scheduledData.datetime, inline: true },
          { name: '⏳ Status', value: timeStatus, inline: false }
        )
        .setFooter({ text: 'Use the buttons below to manage your schedule' });

      const buttonRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('schedule_edit')
            .setLabel('✏️ Edit')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('schedule_delete')
            .setLabel('🗑️ Delete')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('schedule_view_preview')
            .setLabel('👁️ Preview')
            .setStyle(ButtonStyle.Secondary)
        );

      await interaction.editReply({ embeds: [embed], components: [buttonRow] });
    } else {
      // No schedule - show create UI
      await this.handleScheduleCreate(interaction);
    }
  }

  /**
   * Handle schedule creation UI
   */
  async handleScheduleCreate(interaction) {
    // Create channel select menu
    const channelSelect = new ChannelSelectMenuBuilder()
      .setCustomId('schedule_channel_select')
      .setPlaceholder('Select a channel to post in')
      .setChannelTypes(ChannelType.GuildText);

    const channelRow = new ActionRowBuilder().addComponents(channelSelect);

    // Set Time button
    const buttonRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('schedule_set_time')
          .setLabel('📅 Set Date & Time')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('schedule_cancel')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📅 Schedule Swap')
      .setDescription('**Step 1:** Select a channel\n**Step 2:** Click "Set Date & Time"')
      .addFields(
        { name: '📺 Channel', value: '_Not selected_', inline: true },
        { name: '⏰ Date & Time', value: '_Not set_', inline: true }
      )
      .setFooter({ text: 'All times are in UTC • Default: Tomorrow 03:30' });

    await interaction.editReply({
      embeds: [embed],
      components: [channelRow, buttonRow]
    });
  }

  /**
   * Process schedule after Modal submission
   */
  async processScheduleCreation(interaction, datetime, channelId) {
    try {
      // Parse datetime (YYYY-MM-DD HH:MM) in UTC
      const [datePart, timePart] = datetime.split(' ');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hour, minute] = timePart.split(':').map(Number);

      // Create date in UTC
      const scheduledDate = new Date(Date.UTC(year, month - 1, day, hour, minute));
      const now = new Date();

      if (scheduledDate <= now) {
        return { success: false, error: 'The scheduled time must be in the future (UTC)!' };
      }

      const delay = scheduledDate.getTime() - now.getTime();
      const minutesUntil = Math.round(delay / 1000 / 60);
      const hoursUntil = Math.floor(minutesUntil / 60);
      const minsUntil = minutesUntil % 60;

      // Cancel existing schedule
      if (this.scheduledPost) {
        clearTimeout(this.scheduledPost);
      }

      // Save schedule data to file
      this.scheduledData = {
        datetime: datetime,
        channelId: channelId,
        creationChannelId: interaction.channel.id,
        timestamp: scheduledDate.getTime()
      };
      this.saveSchedule();

      console.log('🔁 Master Sync: Copying Master_CSV -> Master_Final (on schedule creation)...');
      const syncResult = await this.checkAndExecuteMasterSync(true);

      if (syncResult && syncResult.aborted) {
        console.warn(`⚠️ Schedule creation sync skipped: ${syncResult.abortReason || 'Source empty'}`);
      }

      console.log('🔄 Refreshing data from Google Sheets (Master_Final) after schedule creation...');
      const finalRange = `${config.googleSheets.masterFinalSheetName || 'Master_Final'}!A:Z`;
      this.playersData = await fetchPlayersDataWithDiscordNames({ range: finalRange });

      console.log(`⏰ Schedule set: Will post in ${minutesUntil} minutes (${datetime} UTC)`);
      console.log(`📅 Scheduled for: ${scheduledDate.toISOString()}`);
      console.log(`🕐 Current time: ${now.toISOString()}`);

      return {
        success: true,
        hoursUntil,
        minsUntil,
        datetime,
        channelId
      };
    } catch (error) {
      console.error('❌ Error in processScheduleCreation:', error);
      return { success: false, error: 'Invalid datetime format! Use: YYYY-MM-DD HH:MM' };
    }
  }

  /**
   * Handle /viewschedule command
   */
  async handleViewSchedule(interaction) {
    if (!this.scheduledData) {
      await interaction.editReply('❌ No scheduled distribution found');
      return;
    }

    // Calculate time remaining
    const [datePart, timePart] = this.scheduledData.datetime.split(' ');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute] = timePart.split(':').map(Number);
    const scheduledDate = new Date(Date.UTC(year, month - 1, day, hour, minute));
    const now = new Date();
    const timeRemaining = scheduledDate.getTime() - now.getTime();
    const minutesRemaining = Math.round(timeRemaining / 1000 / 60);
    const hoursRemaining = Math.floor(Math.abs(minutesRemaining) / 60);
    const minsRemaining = Math.abs(minutesRemaining) % 60;

    // Get channel
    let channelMention = `<#${this.scheduledData.channelId}>`;
    try {
      const channel = await this.client.channels.fetch(this.scheduledData.channelId);
      channelMention = `${channel}`;
    } catch (error) {
      console.warn('Could not fetch channel');
    }

    // Determine status
    let timeRemainingText;
    let embedColor;
    let statusText;
    
    if (timeRemaining > 60000) {
      // More than 1 minute in the future
      timeRemainingText = `${hoursRemaining}h ${minsRemaining}m`;
      embedColor = 0x00ff00; // Green
      statusText = '✅ Scheduled';
    } else if (timeRemaining > 0) {
      // Less than 1 minute away
      timeRemainingText = 'Less than 1 minute';
      embedColor = 0xffaa00; // Orange
      statusText = '⏳ Sending soon...';
    } else if (timeRemaining > -60000) {
      // Up to 1 minute late (still in execution window)
      timeRemainingText = 'Sending now...';
      embedColor = 0xffaa00; // Orange
      statusText = '⏳ Executing...';
    } else {
      // More than 1 minute late
      timeRemainingText = `${hoursRemaining}h ${minsRemaining}m ago`;
      embedColor = 0xff0000; // Red
      statusText = '❌ Missed (will be cleaned up)';
    }

    const embed = new EmbedBuilder()
      .setColor(embedColor)
      .setTitle('📅 Scheduled Distribution')
      .setDescription(`**Status:** ${statusText}`)
      .addFields(
        { name: '📅 Date & Time', value: `${this.scheduledData.datetime} UTC`, inline: false },
        { name: '📺 Channel', value: channelMention, inline: false },
        { name: '⏰ Time Remaining', value: timeRemainingText, inline: false }
      )
      .setFooter({ text: 'Schedule checker runs every 30 seconds' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }

  /**
   * Handle /editschedule command
   */
  async handleEditSchedule(interaction) {
    if (!this.scheduledData) {
      await interaction.editReply('❌ No scheduled distribution found to edit');
      return;
    }

    const newDatetime = interaction.options.getString('datetime');
    const newChannel = interaction.options.getChannel('channel');

    if (!newDatetime && !newChannel) {
      await interaction.editReply('❌ Please provide at least one parameter to edit (datetime or channel)');
      return;
    }

    // Update datetime if provided
    if (newDatetime) {
      try {
        // Validate datetime format
        const [datePart, timePart] = newDatetime.split(' ');
        const [year, month, day] = datePart.split('-').map(Number);
        const [hour, minute] = timePart.split(':').map(Number);
        const scheduledDate = new Date(Date.UTC(year, month - 1, day, hour, minute));
        const now = new Date();

        if (scheduledDate <= now) {
          await interaction.editReply('❌ The scheduled time must be in the future (UTC)!');
          return;
        }

        // Update schedule data
        this.scheduledData.datetime = newDatetime;
        console.log(`⏰ Schedule updated to: ${newDatetime} UTC`);
      } catch (error) {
        await interaction.editReply('❌ Invalid datetime format! Use: YYYY-MM-DD HH:MM (e.g., 2024-12-25 14:30)');
        return;
      }
    }

    // Update channel if provided
    if (newChannel) {
      this.scheduledData.channelId = newChannel.id;
      console.log(`📺 Schedule channel updated to: ${newChannel.name}`);
    }

    // Save updated schedule
    this.saveSchedule();

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('✅ Schedule Updated')
      .setDescription('The scheduled distribution has been updated:')
      .addFields(
        { name: '📅 Date & Time', value: `${this.scheduledData.datetime} UTC`, inline: false },
        { name: '📺 Channel', value: newChannel ? `${newChannel}` : 'Unchanged', inline: false }
      )
      .setFooter({ text: 'The schedule checker will handle the new time automatically' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }

  /**
   * Handle /deleteschedule command
   */
  async handleDeleteSchedule(interaction) {
    if (this.scheduledPost) {
      clearTimeout(this.scheduledPost);
      this.scheduledPost = null;
      
      // Delete the schedule file
      this.deleteSchedule();

      const embed = new EmbedBuilder()
        .setColor(0xff9900)
        .setTitle('✅ Schedule Deleted')
        .setDescription('The scheduled distribution has been cancelled')
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } else {
      await interaction.editReply('❌ No scheduled distribution found');
    }
  }

  /**
   * Handle /map command
   */
  async handleMap(interaction) {
    const ingameId = interaction.options.getString('ingame_id');
    const discordUser = interaction.options.getUser('discord_id');

    try {
      // Write to DiscordMap sheet with username
      await writeDiscordMapping(ingameId, discordUser.id, discordUser.username);

      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ Discord Mapping Added')
        .setDescription(`Successfully mapped **${ingameId}** to ${discordUser}`)
        .addFields(
          { name: 'In-game ID', value: ingameId, inline: true },
          { name: 'Discord User', value: `${discordUser.tag} (${discordUser.id})`, inline: true },
          { name: 'Username', value: `@${discordUser.username}`, inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('❌ Mapping Failed')
        .setDescription(`Failed to map ${ingameId} to Discord user.\n\n**Error:** ${error.message}`)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  }

  /**
   * Handle /help command
   */
  async handleHelp(interaction) {
    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle('📚 Bot Commands Help')
      .setDescription('Here are all available commands and how to use them:')
      .addFields(
        {
          name: '1️⃣ `/swap season:NUMBER`',
          value: '**Distribute players into groups (RGR, OTL, RND)**\nExample: `/swap season:157`\n*Note: Season number is required*',
          inline: false
        },
        {
          name: '2️⃣ `/hold players:NAMES`',
          value: '**Exclude players from distribution**\nExample: `/hold players:Ahmed, Sara, Ali`\n*Separate multiple names with commas*',
          inline: false
        },
        {
          name: '3️⃣ `/move players:NAMES clan:CLAN`',
          value: '**Move players manually to a specific clan**\nExample: `/move players:Ahmed, Sara clan:RGR`\n*Available clans: RGR, OTL, RND*',
          inline: false
        },
        {
          name: '4️⃣ `/include player:NAME`',
          value: '**Re-include a previously excluded player**\nExample: `/include player:Ahmed`',
          inline: false
        },
        {
          name: '5️⃣ `/show`',
          value: '**Display current distribution**\nShows the current player distribution across all groups',
          inline: false
        },
        {
          name: '6️⃣ `/refresh`',
          value: '**Refresh data from Google Sheets**\nUpdates player data from the spreadsheet',
          inline: false
        },
        {
          name: '7️⃣ `/reset type:all/swap`',
          value: '**Reset settings**\n• `all` - Clear all actions + distribution\n• `swap` - Clear distribution only (keep actions)\nExample: `/reset type:all`',
          inline: false
        },
        {
          name: '8️⃣ `/schedule datetime:DATE channel:CHANNEL`',
          value: '**Schedule automatic distribution posting**\nExample: `/schedule datetime:2024-12-25 14:30 channel:#announcements`\n*Format: YYYY-MM-DD HH:MM (UTC timezone)*',
          inline: false
        },
        {
          name: '9️⃣ `/viewschedule` | `/editschedule` | `/deleteschedule`',
          value: '**Manage scheduled distribution**\n• `/viewschedule` - Show current schedule\n• `/editschedule` - Modify datetime or channel\n• `/deleteschedule` - Cancel schedule',
          inline: false
        },
        {
          name: '🔟 `/done players:NAMES action:add/remove`',
          value: '**Mark players as moved (adds/removes checkmark)**\nExample: `/done players:Ahmed action:add`\n*Use action:add to mark as done, action:remove to unmark*',
          inline: false
        },
        {
          name: '1️⃣1️⃣ `/swapsleft`',
          value: '**Show players who haven\'t moved yet**\nDisplays a list of all players without checkmarks',
          inline: false
        }
      )
      .addFields({
        name: '📋 Recommended Workflow',
        value: '1. Use `/hold` to exclude players\n2. Use `/move` to manually assign players\n3. Run `/swap` to distribute remaining players\n4. Use `/done` to mark players as moved\n5. Use `/swapsleft` to see who\'s left',
        inline: false
      })
      .setFooter({ text: 'Discord Player Distribution Bot' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }

  /**
   * Calculate similarity between two strings (Levenshtein distance)
   * Returns a value between 0 and 1 (1 = identical)
   */
  calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }
  
  /**
   * Calculate Levenshtein distance between two strings
   */
  levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * Handle /done command - Show dropdown menus with buttons to mark players as done
   */
  async handleDone(interaction) {
    // Reuse the same logic as handleMarkDoneButton
    await this.handleMarkDoneButton(interaction);
  }

  /**
   * Handle /swapsleft command - Show players who haven't moved yet
   */
  async handleSwapsLeft(interaction) {
    try {
      // Check if distribution exists, if not try to load from saved messages
      if (!this.distributionManager.allPlayers || this.distributionManager.allPlayers.length === 0) {
        // Try to refresh data and re-distribute
        if (this.lastDistributionMessages && this.lastDistributionMessages.length > 0) {
          console.log('🔄 No distribution in memory, refreshing from Google Sheets...');
          const finalRange = `${config.googleSheets.masterFinalSheetName || 'Master_Final'}!A:Z`;
          this.playersData = await fetchPlayersDataWithDiscordNames({ range: finalRange });
          const sortColumn = this.distributionManager.sortColumn || 'Trophies';
          this.distributionManager.distribute(this.playersData, sortColumn);
          console.log(`✅ Distribution refreshed: ${this.playersData.length} players`);
        } else {
          const embed = new EmbedBuilder()
            .setColor(0xff9900)
            .setTitle('⚠️ No Distribution')
            .setDescription('Please run `/swap` first to create a distribution.')
            .setTimestamp();

          await interaction.editReply({ embeds: [embed] });
          return;
        }
      }

      // Get the swaps left text and player list
      const result = this.distributionManager.getSwapsLeft();
      const swapsLeftText = result.text || result;
      const playersList = result.players || [];
      this.swapsLeftPlayersList = playersList;
      this.swapsLeftCompletionSent = false;

      console.log(`📊 getSwapsLeft result type: ${typeof result}`);
      console.log(`📊 result.players exists: ${!!result.players}`);
      console.log(`📊 playersList length: ${playersList.length}`);
      
      // Debug: Show first 2 players structure
      if (playersList.length > 0) {
        console.log(`📋 First player structure:`, JSON.stringify(playersList[0], null, 2));
        if (playersList.length > 1) {
          console.log(`📋 Second player structure:`, JSON.stringify(playersList[1], null, 2));
        }
      }

      // If all players are done, send only SWAPS COMPLETED
      if (result.completed) {
        const embed = new EmbedBuilder()
          .setColor(0x00ff00)
          .setTitle('✅ All Swaps Completed')
          .setDescription('All players have been marked as done!')
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        await interaction.channel.send(' -\n\n**SWAPS COMPLETED**');
        this.swapsLeftCompletionSent = true;
        this.lastSwapsLeftMessages = [];
        this.saveMessageIds();
        return;
      }

      // Send the message
      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('📋 Swaps Left')
        .setDescription('Players who have not moved yet:')
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      
      // Send the actual list and store messages
      this.lastSwapsLeftMessages = await this.sendLongMessage(interaction.channel, swapsLeftText);
      
      // Save message IDs to file
      this.saveMessageIds();
      
      console.log(`✅ Swaps left list sent (${this.lastSwapsLeftMessages.length} messages)`);

      await this.sendSwapsLeftDMs(playersList);
    } catch (error) {
      console.error(`❌ Error in handleSwapsLeft: ${error.message}`);
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('❌ Failed')
        .setDescription(`Failed to get swaps left.\n\n**Error:** ${error.message}`)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  }

  /**
   * Handle /admin command - Show Admin Controls panel
   */
  async handleAdmin(interaction) {
    await interaction.editReply({
      content: '**Admin Controls** (Only you can see this)',
      components: this.createDistributionButtons()
    });
  }

  /**
   * Handle /refresh command - Refresh last posted distribution message with latest sheet data
   */
  async handleRefresh(interaction) {
    try {
      console.log('🔁 Master Sync: Copying Master_CSV -> Master_Final (manual refresh)...');
      const syncResult = await this.checkAndExecuteMasterSync(true);

      if (!syncResult && !config.googleSheets.masterSyncEnabled) {
        console.warn('⚠️ Master Sync is disabled (MASTER_SYNC_ENABLED is not true).');
      }

      // Check if there are distribution messages to refresh
      if (!this.lastDistributionMessages || this.lastDistributionMessages.length === 0) {
        if (!syncResult) {
          const embed = new EmbedBuilder()
            .setColor(0xff0000)
            .setTitle('❌ Refresh Failed')
            .setDescription('Master sync did not run. Please check bot logs for details (Service Account write access is required).')
            .setTimestamp();

          await interaction.editReply({ embeds: [embed] });
          return;
        }

        if (syncResult.aborted) {
          const embed = new EmbedBuilder()
            .setColor(0xff9900)
            .setTitle('⚠️ Refresh Skipped')
            .setDescription(`Master_CSV appears empty. Sync aborted to protect Master_Final.\n\n**Reason:** ${syncResult.abortReason || 'Source empty'}`)
            .setTimestamp();

          await interaction.editReply({ embeds: [embed] });
          return;
        }

        const copiedRows = typeof syncResult.copiedRows === 'number' ? syncResult.copiedRows : 0;
        const froze = !!syncResult.frozeExistingTarget;

        const embed = new EmbedBuilder()
          .setColor(0x00ff00)
          .setTitle('✅ Refreshed')
          .setDescription(
            `Master sync completed.\nCopied **${copiedRows}** row(s) to **${config.googleSheets.masterFinalSheetName || 'Master_Final'}**${froze ? '\n(Existing formulas were frozen to values)' : ''}.\n\nRun \/swap to create a distribution.`
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (syncResult && syncResult.aborted) {
        const embed = new EmbedBuilder()
          .setColor(0xff9900)
          .setTitle('⚠️ Refresh Skipped')
          .setDescription(`Master_CSV appears empty. Sync aborted to protect Master_Final.\n\n**Reason:** ${syncResult.abortReason || 'Source empty'}`)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Verify messages still exist
      let messagesValid = false;
      try {
        await this.lastDistributionMessages[0].fetch();
        messagesValid = true;
      } catch (error) {
        console.log('⚠️ Saved messages no longer exist');
        this.lastDistributionMessages = [];
        this.lastChannelId = null;
        
        const embed = new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle('❌ Messages Not Found')
          .setDescription('The distribution messages no longer exist. Please use `/swap` to create a new distribution.')
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Fetch fresh data from Google Sheets
      console.log('🔄 Refreshing data from Google Sheets (Master_Final)...');
      const finalRange = `${config.googleSheets.masterFinalSheetName || 'Master_Final'}!A:Z`;
      this.playersData = await fetchPlayersDataWithDiscordNames({ range: finalRange });

      if (this.playersData.length === 0) {
        const embed = new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle('❌ No Data Found')
          .setDescription('No data found in Google Sheet')
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Re-distribute with latest data (NEW LOGIC: max 50 per clan, considering manual moves)
      const sortColumn = this.distributionManager.sortColumn || 'Trophies';
      const seasonNumber = this.lastSeasonNumber || null;
      
      console.log(`🔄 Re-distributing with NEW LOGIC: max 50 per clan`);
      console.log(`   Column: ${sortColumn}, Season: ${seasonNumber || 'N/A'}`);
      this.distributionManager.distribute(this.playersData, sortColumn, seasonNumber);
      
      // Validate distribution (check if any clan exceeds 50)
      const validation = this.validateDistribution();
      if (!validation.valid) {
        console.warn('⚠️ Distribution validation failed:', validation.errors);
        const embed = new EmbedBuilder()
          .setColor(0xff9900)
          .setTitle('⚠️ Distribution Warning')
          .setDescription(`Distribution updated but has warnings:\n\n${validation.errors.join('\n')}`)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      }

      // Get formatted distribution
      const formattedText = this.distributionManager.getFormattedDistribution();

      // Update the messages
      await this.updateDistributionMessages(formattedText);

      // Update swapsleft messages if they exist
      if (this.lastSwapsLeftMessages && this.lastSwapsLeftMessages.length > 0) {
        try {
          await this.lastSwapsLeftMessages[0].fetch();
          const result = this.distributionManager.getSwapsLeft(false, this.swapsLeftPlayersList);
          const swapsLeftText = result.text;
          const safeText = this.sanitizeMessageContent(swapsLeftText);
          const chunks = this.splitTextByLinesToChunks(safeText, 2000);

          if (chunks.length > this.lastSwapsLeftMessages.length) {
            console.warn(
              `⚠️ SwapsLeft now needs ${chunks.length} message(s) but only ${this.lastSwapsLeftMessages.length} are saved. ` +
              `Not sending new messages automatically. Please run /swapsleft to recreate swaps left messages.`
            );
          }

          for (let i = 0; i < Math.min(chunks.length, this.lastSwapsLeftMessages.length); i++) {
            try {
              await this.lastSwapsLeftMessages[i].edit({ content: chunks[i], allowedMentions: { parse: ['users'] } });
            } catch (error) {
              console.error(`❌ Failed to update swapsleft message ${i + 1}: ${error.message}`);
            }
          }

          if (result.completed && !this.swapsLeftCompletionSent) {
            try {
              await this.lastSwapsLeftMessages[0].channel.send(' -\n\n**SWAPS COMPLETED**');
              this.swapsLeftCompletionSent = true;
            } catch (error) {
              console.warn('⚠️ Failed to send SWAPS COMPLETED message:', error.message);
            }
          }
          console.log('✅ Swaps left messages refreshed');
        } catch (error) {
          console.log('⚠️ Swaps left messages no longer exist');
          this.lastSwapsLeftMessages = [];
        }
      }

      // Success message
      const summary = this.distributionManager.getSummary();
      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ Distribution Refreshed')
        .setDescription(`Updated with latest data from Google Sheets${seasonNumber ? `\nSeason: **${seasonNumber}**` : ''}`)
        .addFields(
          { name: '🏆 RGR', value: `${summary.groups.RGR} players`, inline: true },
          { name: '🏆 OTL', value: `${summary.groups.OTL} players`, inline: true },
          { name: '🏆 RND', value: `${summary.groups.RND} players`, inline: true },
          { name: '📊 Total', value: `${summary.total} players`, inline: false },
          { name: '🚫 Excluded', value: `${summary.excluded} players`, inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      console.log('✅ Distribution refresh complete');

    } catch (error) {
      console.error(`❌ Error in handleRefresh: ${error.message}`);
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('❌ Refresh Failed')
        .setDescription(`Failed to refresh distribution.\n\n**Error:** ${error.message}`)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  }

  /**
   * Update existing distribution messages
   */
  async updateDistributionMessages(messagesArray) {
    console.log(`📝 updateDistributionMessages: Updating ${this.lastDistributionMessages.length} messages`);
    
    // messagesArray is now an array from getFormattedDistribution()
    if (!Array.isArray(messagesArray)) {
      console.error('❌ messagesArray is not an array');
      return;
    }

    console.log(`📝 Received ${messagesArray.length} messages to update`);

    if (messagesArray.length === 0) {
      console.warn('⚠️ No messages produced for distribution update');
      return;
    }

    // Sanitize each message
    const sanitizedMessages = messagesArray.map(msg => this.sanitizeMessageContent(msg));

    const messagesToUpdate = Math.min(sanitizedMessages.length, this.lastDistributionMessages.length);

    // Update existing messages
    for (let i = 0; i < messagesToUpdate; i++) {
      if (i < this.lastDistributionMessages.length) {
        try {
          console.log(`✅ Updating message ${i + 1}/${messagesToUpdate} (${sanitizedMessages[i].length} chars)`);
          await this.lastDistributionMessages[i].edit({
            content: sanitizedMessages[i],
            allowedMentions: { parse: ['users'] }
          });
          console.log(`✅ Message ${i + 1} updated successfully`);
        } catch (error) {
          console.error(`❌ Failed to edit message ${i + 1}:`, error.message);
        }
      }
    }

    this.saveMessageIds();
  }

  /**
   * Split distribution text into 3 fixed messages
   */
  splitIntoThreeMessages(text) {
    const messages = [];
    
    // Find section markers
    const rgrStart = text.indexOf('**# ');
    const otlStart = text.indexOf('**## to OTL');
    const rndStart = text.indexOf('**## to RND');
    const wildcardsStart = text.indexOf('**# WILDCARDS');
    const footerStart = text.indexOf('---\n\nDone:');
    
    if (rgrStart === -1 || otlStart === -1 || rndStart === -1) {
      console.warn('⚠️ Could not find section markers, using fallback split');
      return this.splitDistributionToChunks(text, 2000);
    }
    
    // Message 1: Title + RGR
    let message1 = text.slice(rgrStart, otlStart).trim();
    messages.push(message1);
    
    // Message 2: OTL only
    let message2 = text.slice(otlStart, rndStart).trim();
    messages.push(message2);
    
    // Message 3: RND + WILDCARDS + Footer
    let message3 = text.slice(rndStart).trim();
    messages.push(message3);
    
    return messages;
  }

  /**
   * Create interactive buttons for distribution message
   */
  createDistributionButtons() {
    // Row 1: View & Data actions (Blue theme)
    const row1 = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('show_distribution')
          .setLabel('Show')
          .setEmoji('👁️')
          .setStyle(ButtonStyle.Primary),
        
        new ButtonBuilder()
          .setCustomId('show_swaps_left')
          .setLabel('Swaps Left')
          .setEmoji('📋')
          .setStyle(ButtonStyle.Secondary),
        
        new ButtonBuilder()
          .setCustomId('refresh_data')
          .setLabel('Refresh')
          .setEmoji('🔄')
          .setStyle(ButtonStyle.Primary),
        
        new ButtonBuilder()
          .setCustomId('open_schedule')
          .setLabel('Schedule')
          .setEmoji('📅')
          .setStyle(ButtonStyle.Primary)
      );
    
    // Row 2: Player actions (Green & Gray theme)
    const row2 = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('mark_done')
          .setLabel('Mark Done')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Success),
        
        new ButtonBuilder()
          .setCustomId('move_player')
          .setLabel('Move')
          .setEmoji('🔀')
          .setStyle(ButtonStyle.Primary),
        
        new ButtonBuilder()
          .setCustomId('add_player')
          .setLabel('Add Player')
          .setEmoji('➕')
          .setStyle(ButtonStyle.Success)
      );
    
    // Row 3: Settings (Gray & Red theme)
    const row3 = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('show_help')
          .setLabel('Help')
          .setEmoji('❓')
          .setStyle(ButtonStyle.Secondary),
        
        new ButtonBuilder()
          .setCustomId('reset_options')
          .setLabel('Reset')
          .setEmoji('🗑️')
          .setStyle(ButtonStyle.Danger)
      );
    
    return [row1, row2, row3];
  }

  /**
   * Send long message in chunks
   */
  /**
   * Validate distribution to ensure no clan exceeds 50 players
   * @returns {Object} { valid: boolean, errors: Array<string> }
   */
  validateDistribution() {
    const errors = [];
    const warnings = [];
    
    // Count total players per clan (including Hold and manual moves)
    const clanCounts = { RGR: 0, OTL: 0, RND: 0 };
    
    // Count players with actions
    if (this.distributionManager.groups.WILDCARDS) {
      this.distributionManager.groups.WILDCARDS.forEach(player => {
        const action = player.Action ? player.Action.trim() : '';
        const currentClan = this.distributionManager.getPlayerClan(player);
        
        if (action === 'Hold' && clanCounts[currentClan] !== undefined) {
          clanCounts[currentClan]++;
        } else if (action && ['RGR', 'OTL', 'RND'].includes(action)) {
          if (clanCounts[action] !== undefined) {
            clanCounts[action]++;
          }
        }
      });
    }
    
    // Count automatic distribution
    ['RGR', 'OTL', 'RND'].forEach(clan => {
      if (this.distributionManager.groups[clan]) {
        // Count players who need to move to this clan
        const movingTo = this.distributionManager.groups[clan].length;
        
        // Count players already in this clan (not moving)
        const stayingInClan = this.playersData.filter(p => {
          const playerClan = this.distributionManager.getPlayerClan(p);
          const action = p.Action ? p.Action.trim() : '';
          return playerClan === clan && !action; // No action means automatic distribution
        }).length;
        
        clanCounts[clan] += movingTo;
      }
    });
    
    // Check if any clan exceeds 50
    Object.entries(clanCounts).forEach(([clan, count]) => {
      if (count > 50) {
        errors.push(`❌ **${clan}** has ${count} players (exceeds limit of 50)`);
      } else if (count === 50) {
        warnings.push(`✅ **${clan}** has exactly 50 players`);
      } else {
        warnings.push(`✅ **${clan}** has ${count} players`);
      }
    });
    
    console.log('📊 Distribution validation:');
    console.log(`   RGR: ${clanCounts.RGR}/50`);
    console.log(`   OTL: ${clanCounts.OTL}/50`);
    console.log(`   RND: ${clanCounts.RND}/50`);
    
    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : warnings,
      counts: clanCounts
    };
  }

  async sendLongMessage(channel, textOrArray, saveMessages = false, isDistribution = false) {
    const sentMessages = [];

    // Clear previous messages if saving new ones
    if (saveMessages) {
      this.lastDistributionMessages = [];
      this.lastChannelId = channel.id;
    }

    // Check if input is array (from getFormattedDistribution) or string
    if (Array.isArray(textOrArray)) {
      // Send each message in the array
      for (let i = 0; i < textOrArray.length; i++) {
        const safeText = this.sanitizeMessageContent(textOrArray[i]);
        const messageOptions = { content: safeText, allowedMentions: { parse: ['users'] } };
        
        const message = await channel.send(messageOptions);
        sentMessages.push(message);
        if (saveMessages) {
          this.lastDistributionMessages.push(message);
        }
      }
    } else {
      // Legacy: handle string input
      const maxLength = 2000;
      const safeText = this.sanitizeMessageContent(textOrArray);
      const chunks = saveMessages
        ? this.splitDistributionToChunks(safeText, maxLength)
        : this.splitTextByLinesToChunks(safeText, maxLength);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const messageOptions = { content: chunk, allowedMentions: { parse: ['users'] } };
        
        const message = await channel.send(messageOptions);
        sentMessages.push(message);
        if (saveMessages) {
          this.lastDistributionMessages.push(message);
        }
      }
    }

    // Save message IDs to file
    if (saveMessages) {
      this.saveMessageIds();
    }

    return sentMessages;
  }
}
