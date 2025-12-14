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
    .setName('help')
    .setDescription('Show all available commands and usage instructions'),

  new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Show Admin Controls panel'),
];
