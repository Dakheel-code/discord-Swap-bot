import { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { config } from './config.js';
import { commands } from './commands.js';
import { fetchPlayersData, fetchPlayersDataWithDiscordNames, getAvailableColumns, writeDiscordMapping, writePlayerAction, clearPlayerAction, clearAllPlayerActions } from './sheets.js';
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

  /**
   * Save message IDs to file
   */
  saveMessageIds() {
    try {
      const data = {
        channelId: this.lastChannelId,
        distributionMessageIds: this.lastDistributionMessages.map(msg => msg.id),
        swapsLeftMessageIds: this.lastSwapsLeftMessages.map(msg => msg.id),
        timestamp: Date.now()
      };
      fs.writeFileSync(this.messagesFilePath, JSON.stringify(data, null, 2));
      console.log('💾 Saved distribution and swapsleft message IDs');
    } catch (error) {
      console.error('❌ Failed to save message IDs:', error);
    }
  }

  /**
   * Load message IDs from file
   */
  async loadMessageIds() {
    try {
      if (!fs.existsSync(this.messagesFilePath)) {
        console.log('ℹ️ No saved message IDs found');
        return;
      }

      const data = JSON.parse(fs.readFileSync(this.messagesFilePath, 'utf8'));
      this.lastChannelId = data.channelId;

      // Fetch the actual message objects
      const channel = await this.client.channels.fetch(data.channelId);
      if (channel) {
        // Load distribution messages
        this.lastDistributionMessages = [];
        const distributionIds = data.distributionMessageIds || data.messageIds || []; // Support old format
        for (const messageId of distributionIds) {
          try {
            const message = await channel.messages.fetch(messageId);
            this.lastDistributionMessages.push(message);
          } catch (error) {
            console.warn(`⚠️ Could not fetch distribution message ${messageId}`);
          }
        }
        console.log(`✅ Loaded ${this.lastDistributionMessages.length} distribution messages`);

        // Load swapsleft messages
        this.lastSwapsLeftMessages = [];
        if (data.swapsLeftMessageIds && data.swapsLeftMessageIds.length > 0) {
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
   * Checks every minute if it's time to send scheduled post
   */
  startScheduleChecker() {
    // Clear existing interval if any
    if (this.scheduleCheckInterval) {
      clearInterval(this.scheduleCheckInterval);
    }

    // Check every 30 seconds
    this.scheduleCheckInterval = setInterval(async () => {
      await this.checkAndExecuteSchedule();
    }, 30000); // 30 seconds

    console.log('⏰ Schedule checker started (checks every 30 seconds)');
  }

  /**
   * Check if scheduled time has arrived and execute if needed
   */
  async checkAndExecuteSchedule() {
    try {
      // Check if there's a schedule
      if (!this.scheduledData) {
        // Try to load from file
        if (fs.existsSync(this.scheduleFilePath)) {
          const data = JSON.parse(fs.readFileSync(this.scheduleFilePath, 'utf8'));
          this.scheduledData = data;
        } else {
          return; // No schedule
        }
      }

      // Parse the scheduled date
      const [datePart, timePart] = this.scheduledData.datetime.split(' ');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hour, minute] = timePart.split(':').map(Number);
      const scheduledDate = new Date(Date.UTC(year, month - 1, day, hour, minute));
      const now = new Date();

      // Check if it's time to send (within 1 minute window)
      const timeDiff = scheduledDate.getTime() - now.getTime();
      
      if (timeDiff <= 0 && timeDiff > -60000) {
        // Time has arrived! Send the post
        console.log('🎯 Scheduled time reached! Sending distribution...');
        await this.executeScheduledPost();
      } else if (timeDiff <= -60000) {
        // More than 1 minute late - schedule missed
        console.log('⚠️ Scheduled time has passed by more than 1 minute, cleaning up');
        this.deleteSchedule();
      }
    } catch (error) {
      console.error('❌ Error in schedule checker:', error);
    }
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

      console.log('🔄 Refreshing data from Google Sheets before scheduled post...');
      this.playersData = await fetchPlayersDataWithDiscordNames();
      
      const sortColumn = this.distributionManager.sortColumn || 'Trophies';
      this.distributionManager.distribute(this.playersData, sortColumn);
      console.log(`✅ Data refreshed: ${this.playersData.length} players`);
      
      const formattedText = this.distributionManager.getFormattedDistribution();
      
      if (formattedText && formattedText.length > 50) {
        await this.sendLongMessage(channel, formattedText, true, true);
        console.log(`✅ Scheduled post sent to ${channel.name}`);
      } else {
        console.error('❌ No distribution data to send');
        await channel.send('❌ Error: No distribution data available. Please run /swap first.');
      }

      // Clean up after sending
      this.deleteSchedule();
      this.scheduledPost = null;
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
        await rest.put(
          Routes.applicationGuildCommands(this.client.user.id, config.discord.guildId),
          { body: commandsData }
        );
        console.log('✅ Registered guild commands');
      } else {
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
   * Handle interactions (slash commands, buttons, select menus)
   */
  async onInteraction(interaction) {
    // Handle button interactions
    if (interaction.isButton()) {
      return await this.handleButtonInteraction(interaction);
    }
    
    // Handle select menu interactions
    if (interaction.isStringSelectMenu()) {
      return await this.handleSelectMenuInteraction(interaction);
    }
    
    if (!interaction.isChatInputCommand()) return;

    const commandName = interaction.commandName;

    try {
      // Defer reply - make all commands ephemeral (hidden)
      // Only scheduled posts will be visible to everyone
      await interaction.deferReply({ ephemeral: true });

      switch (commandName) {
        case 'swap':
          await this.handleDistribute(interaction);
          break;

        case 'move':
          await this.handleMove(interaction);
          break;

        case 'hold':
          await this.handleExclude(interaction);
          break;

        case 'include':
          await this.handleInclude(interaction);
          break;

        case 'show':
          await this.handleShow(interaction);
          break;

        case 'refresh':
          await this.handleRefresh(interaction);
          break;

        case 'reset':
          await this.handleReset(interaction);
          break;

        case 'schedule':
          await this.handleSchedule(interaction);
          break;

        case 'viewschedule':
          await this.handleViewSchedule(interaction);
          break;

        case 'editschedule':
          await this.handleEditSchedule(interaction);
          break;

        case 'deleteschedule':
          await this.handleDeleteSchedule(interaction);
          break;

        case 'help':
          await this.handleHelp(interaction);
          break;

        case 'map':
          await this.handleMap(interaction);
          break;

        case 'done':
          await this.handleDone(interaction);
          break;

        case 'swapsleft':
          await this.handleSwapsLeft(interaction);
          break;

        default:
          await interaction.editReply('❌ Unknown command');
      }
    } catch (error) {
      console.error(`Error handling command ${commandName}:`, error);
      const errorMessage = error.message || 'An error occurred';
      await interaction.editReply(`❌ Error: ${errorMessage}`);
    }
  }

  /**
   * Handle button interactions
   */
  async handleButtonInteraction(interaction) {
    const customId = interaction.customId;
    
    try {
      await interaction.deferReply({ ephemeral: true });
      
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
        
        case 'mark_all_done':
          await this.handleMarkAllDone(interaction);
          break;
        
        case 'mark_rgr_done':
          await this.handleMarkClanDone(interaction, 'RGR');
          break;
        
        case 'mark_otl_done':
          await this.handleMarkClanDone(interaction, 'OTL');
          break;
        
        case 'mark_rnd_done':
          await this.handleMarkClanDone(interaction, 'RND');
          break;
        
        default:
          await interaction.editReply('❌ Unknown button');
      }
    } catch (error) {
      console.error(`❌ Error handling button ${customId}:`, error);
      await interaction.editReply(`❌ Error: ${error.message}`);
    }
  }

  /**
   * Handle select menu interactions
   */
  async handleSelectMenuInteraction(interaction) {
    const customId = interaction.customId;
    
    try {
      await interaction.deferReply({ ephemeral: true });
      
      if (customId === 'select_players_done') {
        await this.handleSelectPlayersDone(interaction);
      } else {
        await interaction.editReply('❌ Unknown select menu');
      }
    } catch (error) {
      console.error(`❌ Error handling select menu ${customId}:`, error);
      await interaction.editReply(`❌ Error: ${error.message}`);
    }
  }

  /**
   * Handle "Show Swaps Left" button
   */
  async handleSwapsLeftButton(interaction) {
    // Check if distribution exists
    if (!this.distributionManager.allPlayers || this.distributionManager.allPlayers.length === 0) {
      await interaction.editReply('⚠️ No distribution found. Please run `/swap` first.');
      return;
    }

    // Get the swaps left text
    const swapsLeftText = this.distributionManager.getSwapsLeft();

    // Send the list
    await interaction.editReply('📋 **Swaps Left:**');
    await interaction.followUp({ content: swapsLeftText, ephemeral: true });
  }

  /**
   * Handle "Refresh" button
   */
  async handleRefreshButton(interaction) {
    // Refresh data from Google Sheets
    this.playersData = await fetchPlayersDataWithDiscordNames();
    
    // Re-distribute
    const sortColumn = this.distributionManager.sortColumn || 'Trophies';
    this.distributionManager.distribute(this.playersData, sortColumn);
    
    // Update messages
    const formattedText = this.distributionManager.getFormattedDistribution();
    await this.updateDistributionMessages(formattedText);
    
    await interaction.editReply('✅ Data refreshed and distribution updated!');
  }

  /**
   * Handle "Mark Done" button
   */
  async handleMarkDoneButton(interaction) {
    // Check if distribution exists
    if (!this.distributionManager.allPlayers || this.distributionManager.allPlayers.length === 0) {
      await interaction.editReply('⚠️ No distribution found. Please run `/swap` first.');
      return;
    }

    // Get all players who are not done yet
    const playersNotDone = [];
    
    ['RGR', 'OTL', 'RND'].forEach(groupName => {
      if (this.distributionManager.groups[groupName]) {
        this.distributionManager.groups[groupName].forEach(player => {
          const name = player.DiscordName || this.distributionManager.getPlayerName(player);
          const identifier = this.distributionManager.getPlayerIdentifier(player);
          
          let isDone = this.distributionManager.completedPlayers.has(identifier);
          if (!isDone && player.DiscordName) {
            isDone = this.distributionManager.completedPlayers.has(player.DiscordName);
          }
          
          if (!isDone) {
            playersNotDone.push({
              name: name,
              clan: groupName,
              identifier: identifier
            });
          }
        });
      }
    });

    if (playersNotDone.length === 0) {
      await interaction.editReply('✅ All players have moved!');
      return;
    }

    // Create select menu (max 25 options)
    const options = playersNotDone.slice(0, 25).map(player => ({
      label: `${player.name} → ${player.clan}`,
      value: player.identifier,
      emoji: '👤'
    }));

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('select_players_done')
      .setPlaceholder('Select players to mark as done')
      .setMinValues(1)
      .setMaxValues(Math.min(options.length, 25))
      .addOptions(options);

    // Create buttons for marking all or by clan
    const buttonsRow = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('mark_all_done')
          .setLabel('Mark All Done')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Success),
        
        new ButtonBuilder()
          .setCustomId('mark_rgr_done')
          .setLabel('RGR Done')
          .setEmoji('🏆')
          .setStyle(ButtonStyle.Primary),
        
        new ButtonBuilder()
          .setCustomId('mark_otl_done')
          .setLabel('OTL Done')
          .setEmoji('🏆')
          .setStyle(ButtonStyle.Primary),
        
        new ButtonBuilder()
          .setCustomId('mark_rnd_done')
          .setLabel('RND Done')
          .setEmoji('🏆')
          .setStyle(ButtonStyle.Primary)
      );

    const selectRow = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.editReply({
      content: `Select players to mark as done (${playersNotDone.length} remaining):`,
      components: [buttonsRow, selectRow]
    });
  }

  /**
   * Handle player selection from select menu
   */
  async handleSelectPlayersDone(interaction) {
    const selectedIdentifiers = interaction.values;
    
    // Mark selected players as done
    selectedIdentifiers.forEach(identifier => {
      this.distributionManager.completedPlayers.add(identifier);
    });

    // Update distribution messages
    const formattedText = this.distributionManager.getFormattedDistribution();
    await this.updateDistributionMessages(formattedText);

    // Update swapsleft messages if they exist
    if (this.lastSwapsLeftMessages && this.lastSwapsLeftMessages.length > 0) {
      const swapsLeftText = this.distributionManager.getSwapsLeft();
      const maxLength = 2000;
      const chunks = [];
      
      let currentChunk = '';
      const lines = swapsLeftText.split('\n');
      
      for (const line of lines) {
        if ((currentChunk + line + '\n').length > maxLength) {
          if (currentChunk) chunks.push(currentChunk);
          currentChunk = line + '\n';
        } else {
          currentChunk += line + '\n';
        }
      }
      if (currentChunk) chunks.push(currentChunk);

      for (let i = 0; i < Math.min(chunks.length, this.lastSwapsLeftMessages.length); i++) {
        try {
          await this.lastSwapsLeftMessages[i].edit(chunks[i]);
        } catch (error) {
          console.error(`❌ Failed to update swapsleft message ${i + 1}: ${error.message}`);
        }
      }
    }

    await interaction.editReply(`✅ Marked ${selectedIdentifiers.length} player(s) as done!`);
  }

  /**
   * Handle "Mark All Done" button
   */
  async handleMarkAllDone(interaction) {
    // Get all players who are not done yet
    const playersToMark = [];
    
    ['RGR', 'OTL', 'RND'].forEach(groupName => {
      if (this.distributionManager.groups[groupName]) {
        this.distributionManager.groups[groupName].forEach(player => {
          const identifier = this.distributionManager.getPlayerIdentifier(player);
          
          let isDone = this.distributionManager.completedPlayers.has(identifier);
          if (!isDone && player.DiscordName) {
            isDone = this.distributionManager.completedPlayers.has(player.DiscordName);
          }
          
          if (!isDone) {
            playersToMark.push(identifier);
          }
        });
      }
    });

    if (playersToMark.length === 0) {
      await interaction.editReply('✅ All players are already marked as done!');
      return;
    }

    // Mark all players as done
    playersToMark.forEach(identifier => {
      this.distributionManager.completedPlayers.add(identifier);
    });

    // Update messages
    const formattedText = this.distributionManager.getFormattedDistribution();
    await this.updateDistributionMessages(formattedText);

    // Update swapsleft messages
    if (this.lastSwapsLeftMessages && this.lastSwapsLeftMessages.length > 0) {
      const swapsLeftText = this.distributionManager.getSwapsLeft();
      const maxLength = 2000;
      const chunks = [];
      
      let currentChunk = '';
      const lines = swapsLeftText.split('\n');
      
      for (const line of lines) {
        if ((currentChunk + line + '\n').length > maxLength) {
          if (currentChunk) chunks.push(currentChunk);
          currentChunk = line + '\n';
        } else {
          currentChunk += line + '\n';
        }
      }
      if (currentChunk) chunks.push(currentChunk);

      for (let i = 0; i < Math.min(chunks.length, this.lastSwapsLeftMessages.length); i++) {
        try {
          await this.lastSwapsLeftMessages[i].edit(chunks[i]);
        } catch (error) {
          console.error(`❌ Failed to update swapsleft message ${i + 1}: ${error.message}`);
        }
      }
    }

    await interaction.editReply(`✅ Marked all ${playersToMark.length} player(s) as done!`);
  }

  /**
   * Handle "Mark Clan Done" button
   */
  async handleMarkClanDone(interaction, clanName) {
    // Get all players from the specified clan who are not done yet
    const playersToMark = [];
    
    if (this.distributionManager.groups[clanName]) {
      this.distributionManager.groups[clanName].forEach(player => {
        const identifier = this.distributionManager.getPlayerIdentifier(player);
        
        let isDone = this.distributionManager.completedPlayers.has(identifier);
        if (!isDone && player.DiscordName) {
          isDone = this.distributionManager.completedPlayers.has(player.DiscordName);
        }
        
        if (!isDone) {
          playersToMark.push(identifier);
        }
      });
    }

    if (playersToMark.length === 0) {
      await interaction.editReply(`✅ All ${clanName} players are already marked as done!`);
      return;
    }

    // Mark all clan players as done
    playersToMark.forEach(identifier => {
      this.distributionManager.completedPlayers.add(identifier);
    });

    // Update messages
    const formattedText = this.distributionManager.getFormattedDistribution();
    await this.updateDistributionMessages(formattedText);

    // Update swapsleft messages
    if (this.lastSwapsLeftMessages && this.lastSwapsLeftMessages.length > 0) {
      const swapsLeftText = this.distributionManager.getSwapsLeft();
      const maxLength = 2000;
      const chunks = [];
      
      let currentChunk = '';
      const lines = swapsLeftText.split('\n');
      
      for (const line of lines) {
        if ((currentChunk + line + '\n').length > maxLength) {
          if (currentChunk) chunks.push(currentChunk);
          currentChunk = line + '\n';
        } else {
          currentChunk += line + '\n';
        }
      }
      if (currentChunk) chunks.push(currentChunk);

      for (let i = 0; i < Math.min(chunks.length, this.lastSwapsLeftMessages.length); i++) {
        try {
          await this.lastSwapsLeftMessages[i].edit(chunks[i]);
        } catch (error) {
          console.error(`❌ Failed to update swapsleft message ${i + 1}: ${error.message}`);
        }
      }
    }

    await interaction.editReply(`✅ Marked all ${playersToMark.length} ${clanName} player(s) as done!`);
  }

  /**
   * Handle /swap command (formerly /distribute)
   */
  async handleDistribute(interaction) {
    const columnName = 'Trophies'; // Always use Trophies column
    const seasonNumber = interaction.options.getString('season'); // Get season number from options

    // Fetch fresh data with Discord names
    this.playersData = await fetchPlayersDataWithDiscordNames();

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
      // Create new messages with interactive buttons
      await this.sendLongMessage(interaction.channel, formattedText, true, true);
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
      
      // Write directly to Google Sheet Action column
      await writePlayerAction(discordId, targetGroup);
      
      // Success message
      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ Player Moved')
        .setDescription(`**${discordUser.username}** has been assigned to **${targetGroup}**`)
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
  async handleRefresh(interaction) {
    this.playersData = await fetchPlayersDataWithDiscordNames();

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('✅ Data Refreshed')
      .setDescription(`Loaded **${this.playersData.length}** players from Google Sheets`)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }

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
        this.playersData = await fetchPlayersDataWithDiscordNames();

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
        description += `✅ Reset distribution manager\n`;
        description += `✅ Cleared saved messages\n`;
        description += `✅ Refreshed player data (${this.playersData.length} players)\n\n`;
        description += `_All /move, /hold actions have been cleared_\n`;
        description += `_Next /swap will create a new distribution message_`;
        
      } else if (resetType === 'swap') {
        console.log('🔄 Resetting distribution only...');
        
        // Save current sort column
        const currentSortColumn = this.distributionManager.sortColumn;

        // Refresh data from Google Sheets (keeps actions)
        this.playersData = await fetchPlayersDataWithDiscordNames();

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

        title = '✅ Reset Distribution Complete';
        description = `**Distribution has been reset:**\n\n`;
        description += `✅ Reset distribution manager\n`;
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
   * Handle /schedule command
   */
  async handleSchedule(interaction) {
    const datetime = interaction.options.getString('datetime');
    const channel = interaction.options.getChannel('channel');

    try {
      // Parse datetime (YYYY-MM-DD HH:MM) in UTC
      const [datePart, timePart] = datetime.split(' ');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hour, minute] = timePart.split(':').map(Number);

      // Create date in UTC
      const scheduledDate = new Date(Date.UTC(year, month - 1, day, hour, minute));
      const now = new Date();

      if (scheduledDate <= now) {
        await interaction.editReply('❌ The scheduled time must be in the future (UTC)!');
        return;
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
        channelId: channel.id,
        timestamp: Date.now()
      };
      this.saveSchedule();

      console.log(`⏰ Schedule set: Will post in ${minutesUntil} minutes (${datetime} UTC)`);
      console.log(`📅 Scheduled for: ${scheduledDate.toISOString()}`);
      console.log(`🕐 Current time: ${now.toISOString()}`);

      // Send confirmation
      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ Distribution Scheduled')
        .setDescription(`The distribution will be posted in ${channel} at **${datetime} UTC**`)
        .addFields(
          { name: '⏰ Time Until Post', value: `${hoursUntil}h ${minsUntil}m`, inline: true },
          { name: '📺 Channel', value: `${channel}`, inline: true }
        )
        .setFooter({ text: 'The schedule checker runs every 30 seconds to ensure delivery' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // Send the actual distribution preview
      const formattedText = this.distributionManager.getFormattedDistribution();
      if (formattedText && formattedText.length > 50) {
        await interaction.followUp({ content: '**Preview of the scheduled message:**', ephemeral: true });
        await this.sendLongMessage(interaction.channel, formattedText);
      } else {
        await interaction.followUp({ content: '⚠️ No distribution data available yet. Please run /swap first.', ephemeral: true });
      }
    } catch (error) {
      console.error('❌ Error in handleSchedule:', error);
      await interaction.editReply('❌ Invalid datetime format! Use: YYYY-MM-DD HH:MM (e.g., 2024-12-25 14:30)');
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
   * Handle /done command - Add/remove checkmarks in swap message
   */
  async handleDone(interaction) {
    const playersInput = interaction.options.getString('players');
    const action = interaction.options.getString('action');

    try {
      console.log(`📝 handleDone: Input = "${playersInput}", Action = "${action}"`);
      
      // Check if distribution messages exist
      if (this.lastDistributionMessages.length === 0) {
        await interaction.editReply('❌ No swap message found. Please run `/swap` first.');
        return;
      }
      
      // Split player mentions by comma
      const playerMentions = playersInput.split(',').map(name => name.trim()).filter(name => name.length > 0);
      console.log(`📝 Processing ${playerMentions.length} player(s)`);
      
      const successPlayers = [];
      const failedPlayers = [];

      // Read all current messages
      const allMessages = [];
      for (const msg of this.lastDistributionMessages) {
        try {
          const fetchedMsg = await msg.fetch();
          allMessages.push({ msg: fetchedMsg, content: fetchedMsg.content });
          console.log(`📄 Message content (first 200 chars): ${fetchedMsg.content.substring(0, 200)}`);
        } catch (error) {
          console.error(`❌ Failed to fetch message: ${error.message}`);
        }
      }
      
      if (allMessages.length === 0) {
        await interaction.editReply('❌ Could not read swap messages.');
        return;
      }

      // Process each player mention
      for (const mention of playerMentions) {
        console.log(`🔍 Searching for: "${mention}"`);
        
        let username = null;
        
        // Check if it's a mention or plain text
        const mentionMatch = mention.match(/<@!?(\d+)>/);
        
        if (mentionMatch) {
          // It's a mention - fetch username from Discord
          const discordId = mentionMatch[1];
          console.log(`✅ Extracted Discord ID: ${discordId}`);
          
          try {
            const user = await interaction.client.users.fetch(discordId);
            username = user.username;
            console.log(`✅ Fetched username from Discord: ${username}`);
          } catch (error) {
            console.error(`❌ Could not fetch user: ${error.message}`);
            failedPlayers.push(`${mention} (Could not fetch user info)`);
            continue;
          }
        } else {
          // It's plain text - use it directly
          username = mention.trim();
          console.log(`✅ Using plain text as username: ${username}`);
        }
        
        let found = false;
        let matchedName = null;
        
        // Search in all messages for username (without @) with fuzzy matching
        for (const msgData of allMessages) {
          let content = msgData.content;
          
          console.log(`🔍 Searching for username: "${username}" (without @)`);
          console.log(`📄 Original content (first 200 chars): ${content.substring(0, 200)}`);
          
          // Convert all mentions in content to @username format
          const mentionRegex = /<@!?(\d+)>/g;
          const mentions = content.match(mentionRegex);
          
          if (mentions) {
            for (const mention of mentions) {
              const idMatch = mention.match(/<@!?(\d+)>/);
              if (idMatch) {
                try {
                  const user = await interaction.client.users.fetch(idMatch[1]);
                  // Replace <@123> with @username
                  content = content.replace(mention, `@${user.username}`);
                } catch (error) {
                  console.error(`⚠️ Could not fetch user ${idMatch[1]}`);
                }
              }
            }
            console.log(`📄 Converted content (first 200 chars): ${content.substring(0, 200)}`);
          }
          
          // Split content into lines and search for the username
          const lines = content.split('\n');
          const usernameLower = username.toLowerCase();
          
          for (const line of lines) {
            // Extract names from lines (format: • name - value or - name value)
            // Match pattern: [bullet] [name with possible clan tag] [- value]
            const nameMatch = line.match(/[•\-]\s*(@?)([^\-\n]+?)(?:\s*\-|$)/);
            if (nameMatch) {
              const fullName = nameMatch[2].trim();
              // Remove @ if present
              const nameWithoutAt = fullName.startsWith('@') ? fullName.substring(1) : fullName;
              // Extract first word only (before any space or special character)
              const firstWord = nameWithoutAt.split(/\s+/)[0].toLowerCase();
              
              console.log(`🔍 Comparing "${usernameLower}" with "${firstWord}" (from "${fullName}")`);
              
              // Calculate similarity between username and first word only
              const similarity = this.calculateSimilarity(usernameLower, firstWord);
              
              if (similarity >= 0.80) {
                console.log(`✅ Found similar name: "${fullName}" (similarity: ${(similarity * 100).toFixed(1)}%)`);
                matchedName = nameMatch[0].trim(); // Keep the full match (• name or - name)
                found = true;
                
                if (action === 'add') {
                  // Add checkmark at the end of the line
                  if (!line.includes('✅')) {
                    // Add checkmark at the end of the line (before newline)
                    const newLine = line.trimEnd() + ' ✅';
                    content = content.replace(line, newLine);
                    msgData.content = content;
                    console.log(`✅ Added checkmark at end of line for: ${nameMatch[2]}`);
                  } else {
                    console.log(`⚠️ Checkmark already exists`);
                  }
                } else {
                  // Remove checkmark from end of line
                  if (line.includes('✅')) {
                    const newLine = line.replace(' ✅', '');
                    content = content.replace(line, newLine);
                    msgData.content = content;
                    console.log(`✅ Removed checkmark for: ${nameMatch[2]}`);
                  } else {
                    console.log(`⚠️ No checkmark to remove`);
                  }
                }
                
                successPlayers.push(mention);
                break;
              }
            }
          }
          
          if (found) break;
        }
        
        if (!found) {
          failedPlayers.push(`${mention} (Not found in swap list)`);
          console.error(`❌ Player "${username}" not found in messages`);
        }
      }

      // Update all modified messages
      for (const msgData of allMessages) {
        try {
          await msgData.msg.edit(msgData.content);
          console.log(`✅ Updated message`);
        } catch (error) {
          console.error(`❌ Failed to update message: ${error.message}`);
        }
      }

      // Update swapsleft messages if they exist
      if (this.lastSwapsLeftMessages && this.lastSwapsLeftMessages.length > 0) {
        try {
          const swapsLeftText = this.distributionManager.getSwapsLeft();
          const maxLength = 2000;
          const chunks = [];
          
          let currentChunk = '';
          const lines = swapsLeftText.split('\n');
          
          for (const line of lines) {
            if ((currentChunk + line + '\n').length > maxLength) {
              if (currentChunk) chunks.push(currentChunk);
              currentChunk = line + '\n';
            } else {
              currentChunk += line + '\n';
            }
          }
          if (currentChunk) chunks.push(currentChunk);

          // Update existing swapsleft messages
          for (let i = 0; i < Math.min(chunks.length, this.lastSwapsLeftMessages.length); i++) {
            try {
              await this.lastSwapsLeftMessages[i].edit(chunks[i]);
              console.log(`✅ Updated swapsleft message ${i + 1}`);
            } catch (error) {
              console.error(`❌ Failed to update swapsleft message ${i + 1}: ${error.message}`);
            }
          }
        } catch (error) {
          console.error(`❌ Failed to update swapsleft messages: ${error.message}`);
        }
      }

      // Send response
      let description = '';
      if (successPlayers.length > 0) {
        const actionText = action === 'add' ? 'marked as done' : 'unmarked';
        description += `**Players ${actionText}:**\n${successPlayers.map(p => `• ${p}`).join('\n')}`;
      }
      if (failedPlayers.length > 0) {
        description += `\n\n**Failed:**\n${failedPlayers.map(p => `• ${p}`).join('\n')}`;
      }

      const embed = new EmbedBuilder()
        .setColor(successPlayers.length > 0 ? 0x00ff00 : 0xff0000)
        .setTitle(successPlayers.length > 0 ? '✅ Players Updated' : '❌ Update Failed')
        .setDescription(description)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      console.error(`❌ Error in handleDone: ${error.message}`);
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle('❌ Failed')
        .setDescription(`Failed to update players.\n\n**Error:** ${error.message}`)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    }
  }

  /**
   * Handle /swapsleft command - Show players who haven't moved yet
   */
  async handleSwapsLeft(interaction) {
    try {
      // Check if distribution exists
      if (!this.distributionManager.allPlayers || this.distributionManager.allPlayers.length === 0) {
        const embed = new EmbedBuilder()
          .setColor(0xff9900)
          .setTitle('⚠️ No Distribution')
          .setDescription('Please run `/swap` first to create a distribution.')
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Get the swaps left text
      const swapsLeftText = this.distributionManager.getSwapsLeft();

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
   * Update existing distribution messages
   */
  async updateDistributionMessages(text) {
    console.log(`📝 updateDistributionMessages: Updating ${this.lastDistributionMessages.length} messages`);
    console.log(`📝 Text length: ${text.length} characters`);
    console.log(`📝 First 200 chars: ${text.substring(0, 200)}`);
    
    const maxLength = 2000;
    const chunks = [];
    
    let currentChunk = '';
    const lines = text.split('\n');

    for (const line of lines) {
      if (currentChunk.length + line.length + 1 > maxLength) {
        chunks.push(currentChunk);
        currentChunk = line + '\n';
      } else {
        currentChunk += line + '\n';
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    console.log(`📝 Split into ${chunks.length} chunks`);

    // Update existing messages or send new ones if needed
    for (let i = 0; i < chunks.length; i++) {
      if (i < this.lastDistributionMessages.length) {
        try {
          console.log(`✅ Updating message ${i + 1}/${chunks.length}`);
          await this.lastDistributionMessages[i].edit(chunks[i]);
          console.log(`✅ Message ${i + 1} updated successfully`);
        } catch (error) {
          console.error(`❌ Failed to edit message ${i + 1}:`, error.message);
        }
      } else {
        console.log(`⚠️ No message ${i + 1} to update (only ${this.lastDistributionMessages.length} messages saved)`);
      }
    }
  }

  /**
   * Create interactive buttons for distribution message
   */
  createDistributionButtons() {
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('show_swaps_left')
          .setLabel('Show Swaps Left')
          .setEmoji('📋')
          .setStyle(ButtonStyle.Primary),
        
        new ButtonBuilder()
          .setCustomId('refresh_data')
          .setLabel('Refresh')
          .setEmoji('🔄')
          .setStyle(ButtonStyle.Secondary),
        
        new ButtonBuilder()
          .setCustomId('mark_done')
          .setLabel('Mark Done')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Success)
      );
    
    return row;
  }

  /**
   * Send long message in chunks
   */
  async sendLongMessage(channel, text, saveMessages = false, addButtons = false) {
    const maxLength = 2000;
    const chunks = [];
    
    let currentChunk = '';
    const lines = text.split('\n');

    for (const line of lines) {
      if (currentChunk.length + line.length + 1 > maxLength) {
        chunks.push(currentChunk);
        currentChunk = line + '\n';
      } else {
        currentChunk += line + '\n';
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    const sentMessages = [];

    // Clear previous messages if saving new ones
    if (saveMessages) {
      this.lastDistributionMessages = [];
      this.lastChannelId = channel.id;
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const isLastChunk = i === chunks.length - 1;
      
      // Add buttons to the last chunk if requested
      const messageOptions = { content: chunk };
      if (addButtons && isLastChunk) {
        messageOptions.components = [this.createDistributionButtons()];
      }
      
      const message = await channel.send(messageOptions);
      sentMessages.push(message);
      if (saveMessages) {
        this.lastDistributionMessages.push(message);
      }
    }

    // Save message IDs to file
    if (saveMessages) {
      this.saveMessageIds();
    }

    return sentMessages;
  }
}
