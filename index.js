require('dotenv').config();
const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js');
const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID, TICKET_CATEGORY_ID, SUPPORT_ROLE_ID, VOUCH_CHANNEL_ID } = process.env;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel],
});

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  try {
    const commands = [new SlashCommandBuilder().setName('setup-tickets').setDescription('Posts the ticket panel').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).toJSON()];
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Commands registered.');
  } catch (err) { console.error('❌ Reg failed:', err); }
}

async function handleOpenTicket(interaction) {
  const existing = interaction.guild.channels.cache.find(ch => ch.topic === interaction.user.id && ch.parentId === TICKET_CATEGORY_ID);
  if (existing) return interaction.reply({ content: `You already have a ticket: ${existing}`, ephemeral: true });

  const channel = await interaction.guild.channels.create({
    name: `ticket-${interaction.user.username}`.toLowerCase().slice(0, 90),
    type: ChannelType.GuildText, parent: TICKET_CATEGORY_ID, topic: interaction.user.id,
    permissionOverwrites: [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: SUPPORT_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    ],
  });

  const embed = new EmbedBuilder().setColor(0x2b2d31).setTitle('🎫 New Ticket').setDescription(`Hi ${interaction.user}, please describe your request.`);
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger));
  await channel.send({ content: `${interaction.user} | <@&${SUPPORT_ROLE_ID}>`, embeds: [embed], components: [row] });
  await interaction.reply({ content: `Ticket created: ${channel}`, ephemeral: true });
}

async function handleCloseTicket(interaction) {
  const channel = interaction.channel;
  const ownerId = channel.topic;
  await interaction.reply({ content: '🔒 Closing in 5 seconds...' });
  if (ownerId) {
    const embed = new EmbedBuilder().setColor(0x2b2d31).setTitle('⭐ Vouch').setDescription(`Your ticket **${channel.name}** closed. Leave a vouch!`);
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`vouch_start_${channel.name}`).setLabel('Leave a Vouch').setEmoji('⭐').setStyle(ButtonStyle.Success));
    try { const user = await client.users.fetch(ownerId); await user.send({ embeds: [embed], components: [row] }); }
    catch (e) { await channel.send({ content: `<@${ownerId}>`, embeds: [embed], components: [row] }).catch(() => {}); }
  }
  setTimeout(() => { channel.delete().catch(() => {}); }, 5000);
}

async function handleVouchStartButton(interaction) {
  const ref = interaction.customId.replace('vouch_start_', '');
  const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`vouch_rating_${ref}`).setPlaceholder('Rating')
    .addOptions([{ label: '⭐ 1', value: '1' }, { label: '⭐⭐ 2', value: '2' }, { label: '⭐⭐⭐ 3', value: '3' }, { label: '⭐⭐⭐⭐ 4', value: '4' }, { label: '⭐⭐⭐⭐⭐ 5', value: '5' }]));
  await interaction.reply({ content: 'Stars?', components: [row], ephemeral: true });
}

async function handleVouchRatingSelect(interaction) {
  const ref = interaction.customId.replace('vouch_rating_', '');
  const modal = new ModalBuilder().setCustomId(`vouch_modal_${ref}_${interaction.values[0]}`).setTitle('Submit Vouch');
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vouch_text').setLabel('Experience').setStyle(TextInputStyle.Paragraph).setRequired(false)));
  await interaction.showModal(modal);
}

async function handleVouchModalSubmit(interaction) {
  const parts = interaction.customId.split('_');
  const rating = parts.pop();
  const text = interaction.fields.getTextInputValue('vouch_text') || '*No comment*';
  const embed = new EmbedBuilder().setColor(0xf5c518).setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
    .setTitle('New Vouch! ⭐').setDescription(`**Rating:** ${'⭐'.repeat(Number(rating))}\n\n**Comment:**\n${text}`).setTimestamp();
  const ch = interaction.guild?.channels.cache.get(VOUCH_CHANNEL_ID) || await client.channels.fetch(VOUCH_CHANNEL_ID).catch(() => null);
  if (ch) { await ch.send({ embeds: [embed] }); await interaction.reply({ content: 'Posted!', ephemeral: true }); }
  else { await interaction.reply({ content: '❌ Channel not found.', ephemeral: true }); }
}

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup-tickets') {
      const emb = new EmbedBuilder().setColor(0x2b2d31).setTitle('🎫 Tickets').setDescription('Click below to open a ticket.');
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('open_ticket').setLabel('Open Ticket').setEmoji('🎫').setStyle(ButtonStyle.Primary));
      return await interaction.reply({ embeds: [emb], components: [row] });
    }
    if (interaction.isButton()) {
      if (interaction.customId === 'open_ticket') return await handleOpenTicket(interaction);
      if (interaction.customId === 'close_ticket') return await handleCloseTicket(interaction);
      if (interaction.customId.startsWith('vouch_start_')) return await handleVouchStartButton(interaction);
    }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('vouch_rating_')) return await handleVouchRatingSelect(interaction);
    if (interaction.isModalSubmit() && interaction.customId.startsWith('vouch_modal_')) return await handleVouchModalSubmit(interaction);
  } catch (err) { console.error(err); }
});

client.once('ready', async () => { console.log(`🤖 Online as ${client.user.tag}`); await registerCommands(); });
client.login(DISCORD_TOKEN);
