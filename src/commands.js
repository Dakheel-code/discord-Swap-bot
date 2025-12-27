import { SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('swap')
    .setDescription('Distribute players into groups based on Trophies')
    .addStringOption(option =>
      option
        .setName('season')
        .setDescription('Season number (e.g., 156)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Show Admin Controls panel'),

  new SlashCommandBuilder()
    .setName('refresh')
    .setDescription('Refresh the last posted distribution message with latest sheet data'),

  new SlashCommandBuilder()
    .setName('done_temp')
    .setDescription('Temporary solution: Mark players as done by directly editing the 3 messages'),

  new SlashCommandBuilder()
    .setName('restore_fixed')
    .setDescription('Restore the 3 fixed distribution messages and preserve ✅ from message content'),
];
