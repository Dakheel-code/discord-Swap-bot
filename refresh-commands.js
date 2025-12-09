import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import { config } from './src/config.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function refreshCommands() {
  try {
    console.log('🔐 Logging in to Discord...');
    await client.login(config.discord.token);
    
    const clientId = client.user.id;
    console.log(`✅ Logged in as ${client.user.tag}`);
    console.log(`📋 Client ID: ${clientId}`);
    console.log('');
    
    const rest = new REST({ version: '10' }).setToken(config.discord.token);
    
    console.log('🗑️ Deleting all existing commands...');
    
    // Delete all guild commands
    const guildCommands = await rest.get(
      Routes.applicationGuildCommands(clientId, config.discord.guildId)
    );
    
    console.log(`   Found ${guildCommands.length} commands to delete`);
    
    for (const command of guildCommands) {
      console.log(`   Deleting: ${command.name}`);
      await rest.delete(
        Routes.applicationGuildCommand(clientId, config.discord.guildId, command.id)
      );
    }
    
    console.log('');
    console.log('✅ All commands deleted!');
    console.log('');
    console.log('🔄 Now restarting bot to register new commands...');
    
    await client.destroy();
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

refreshCommands();
