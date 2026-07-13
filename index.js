/**
 * ============================================================
 *  HugoSMP Ticket + Vouch Bot
 * ============================================================
 *
 * Features:
 * - /setup-tickets  -> posts a panel with an "Open Ticket" button
 * - Clicking it creates a private ticket channel (user + support role only)
 * - "Close Ticket" button inside the channel closes the ticket
 * - On close, the ticket creator gets a "Leave a Vouch" prompt (DM,
 *   with a fallback message in the channel if DMs are closed)
 * - Submitted vouches (star rating + comment) get posted as an embed
 *   to your vouch channel
 *
 * SETUP:
 * 1. npm install
 * 2. Copy .env.example to .env and fill in all values
 * 3. npm start   (locally)  /  deploy to Railway (see README.md)
 * ============================================================
 */

require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  EmbedBuilder,
} = require('discord.js');

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  TICKET_CATEGORY_ID,
  SUPPORT_ROLE_ID,
  VOUCH_CHANNEL_ID,
} = process.env;

// ---- basic env validation, so mistakes fail loudly instead of silently ----
for (const [name, value] of Object.entries({
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  TICKET_CATEGORY_ID,
  SUPPORT_ROLE_ID,
  VOUCH_CHANNEL_ID,
})) {
  if (!value) {
    console.warn(`⚠️  Missing environment variable: ${name} (check your .env / Railway variables)`);
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

// ==================== SLASH COMMAND DEFINITION ====================

const commands = [
  new SlashCommandBuilder()
    .setName('setup-tickets')
    .setDescription('Posts the ticket panel in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map((c) => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Slash commands registered.');
  } catch (err) {
    console.error('❌ Failed to register slash commands:', err);
  }
}

// ==================== TICKET PANEL ====================

function buildTicketPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle('🎫 Support Tickets')
    .setDescription('Need help or want to place an order? Click the button below to open a private ticket.')
    .setFooter({ text: 'HugoSMP Market' });
}

function buildTicketPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('open_ticket')
      .setLabel('Open Ticket')
      .setEmoji('🎫')
      .setStyle(ButtonStyle.Primary)
  );
}

// ==================== TICKET CREATION ====================

async function handleOpenTicket(interaction) {
  const guild = interaction.guild;
  const existing = guild.channels.cache.find(
    (ch) => ch.topic === interaction.user.id && ch.parentId === TICKET_CATEGORY_ID
  );

  if (existing) {
    return interaction.reply({
      content: `You already have an open ticket: ${existing}`,
      ephemeral: true,
    });
  }

  const channel = await guild.channels.create({
    name: `ticket-${interaction.user.username}`.toLowerCase().slice(0, 90),
    type: ChannelType.GuildText,
    parent: TICKET_CATEGORY_ID,
    topic: interaction.user.id, // used later to know who owns this ticket
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
      {
        id: SUPPORT_ROLE_ID,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
    ],
  });

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle('🎫 New Ticket')
    .setDescription(
      `Hi ${interaction.user}, thanks for reaching out!\n\nPlease describe your request. Our team will be with you shortly.`
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('close_ticket')
      .setLabel('Close Ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({ content: `${interaction.user} | <@&${SUPPORT_ROLE_ID}>`, embeds: [embed], components: [row] });

  await interaction.reply({ content: `Ticket created: ${channel}`, ephemeral: true });
}

// ==================== TICKET CLOSING ====================

async function handleCloseTicket(interaction) {
  const channel = interaction.channel;
  const ownerId = channel.topic;

  await interaction.reply({ content: '🔒 Closing this ticket in 5 seconds...' });

  if (ownerId) {
    await sendVouchPrompt(interaction.client, ownerId, channel.name, channel);
  }

  setTimeout(() => {
    channel.delete().catch(() => {});
  }, 5000);
}

// ==================== VOUCH SYSTEM ====================

async function sendVouchPrompt(clientRef, userId, ticketRef, fallbackChannel = null) {
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle('⭐ How was your ticket?')
    .setDescription(
      `Your ticket **${ticketRef}** has been closed.\n\n` +
      `If everything went well, we'd really appreciate a quick **vouch** – ` +
      `it helps us and other customers out! 🙏`
    )
    .setFooter({ text: 'HugoSMP Market' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vouch_start_${ticketRef}`)
      .setLabel('Leave a Vouch')
      .setEmoji('⭐')
      .setStyle(ButtonStyle.Success)
  );

  const payload = { embeds: [embed], components: [row] };

  try {
    const user = await clientRef.users.fetch(userId);
    await user.send(payload);
  } catch (err) {
    if (fallbackChannel) {
      await fallbackChannel.send({ content: `<@${userId}>`, ...payload }).catch(() => {});
    }
  }
}

async function handleVouchStartButton(interaction) {
  const ticketRef = interaction.customId.replace('vouch_start_', '');

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`vouch_rating_${ticketRef}`)
      .setPlaceholder('Select a rating')
      .addOptions([
        { label: '⭐ 1 - Poor', value: '1' },
        { label: '⭐⭐ 2', value: '2' },
        { label: '⭐⭐⭐ 3 - Okay', value: '3' },
        { label: '⭐⭐⭐⭐ 4', value: '4' },
        { label: '⭐⭐⭐⭐⭐ 5 - Excellent!', value: '5' },
      ])
  );

  await interaction.reply({
    content: 'How many stars would you like to give?',
    components: [row],
    ephemeral: true,
  });
}

async function handleVouchRatingSelect(interaction) {
  const ticketRef = interaction.customId.replace('vouch_rating_', '');
  const rating = interaction.values[0];

  const modal = new ModalBuilder()
    .setCustomId(`vouch_modal_${ticketRef}_${rating}`)
    .setTitle('Submit Vouch');

  const textInput = new TextInputBuilder()
    .setCustomId('vouch_text')
    .setLabel('Your experience (optional)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('e.g. Super fast delivery, friendly support!')
    .setRequired(false)
    .setMaxLength(500);

  modal.addComponents(new ActionRowBuilder().addComponents(textInput));

  await interaction.showModal(modal);
}

async function handleVouchModalSubmit(interaction) {
  const parts = interaction.customId.split('_'); // vouch_modal_<ticketRef>_<rating>
  const rating = parts.pop();
  const ticketRef = parts.slice(2).join('_');
  const text = interaction.fields.getTextInputValue('vouch_text') || '*No comment left*';
  const stars = '⭐'.repeat(Number(rating)) + '☆'.repeat(5 - Number(rating));

  const embed = new EmbedBuilder()
    .setColor(0xf5c518)
    .setAuthor({
      name: interaction.user.tag,
      iconURL: interaction.user.displayAvatarURL(),
    })
    .setTitle('New Vouch')
    .addFields(
      { name: 'Rating', value: stars, inline: true },
      { name: 'Ticket', value: `${ticketRef}`, inline: true },
      { name: 'Comment', value: text }
    )
    .setTimestamp();

  const vouchChannel = await interaction.client.channels.fetch(VOUCH_CHANNEL_ID).catch(() => null);

  if (vouchChannel) {
    await vouchChannel.send({ embeds: [embed] });
    await interaction.reply({ content: '✅ Thanks for your vouch!', ephemeral: true });
  } else {
    await interaction.reply({
      content: '⚠️ Could not post the vouch (channel not found). Please check VOUCH_CHANNEL_ID.',
      ephemeral: true,
    });
  }
}

// ==================== EVENT HANDLERS ====================

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
});

client.on('interactionCreate', async (interaction) => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'setup-tickets') {
        await interaction.channel.send({
          embeds: [buildTicketPanelEmbed()],
          components: [buildTicketPanelRow()],
        });
        return interaction.reply({ content: '✅ Ticket panel posted.', ephemeral: true });
      }
    }

    // Buttons
    if (interaction.isButton()) {
      if (interaction.customId === 'open_ticket') return handleOpenTicket(interaction);
      if (interaction.customId === 'close_ticket') return handleCloseTicket(interaction);
      if (interaction.customId.startsWith('vouch_start_')) return handleVouchStartButton(interaction);
    }

    // Select menus
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith('vouch_rating_')) return handleVouchRatingSelect(interaction);
    }

    // Modals
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('vouch_modal_')) return handleVouchModalSubmit(interaction);
    }
  } catch (err) {
    console.error('Interaction error:', err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ Something went wrong.', ephemeral: true }).catch(() => {});
    }
  }
});

client.login(DISCORD_TOKEN);
