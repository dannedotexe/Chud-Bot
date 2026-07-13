require('dotenv').config();
const fs = require('fs');
const path = require('path');

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
  ActivityType
} = require('discord.js');

const { 
  DISCORD_TOKEN, 
  CLIENT_ID, 
  GUILD_ID, 
  TICKET_CATEGORY_ID, 
  SUPPORT_ROLE_ID, 
  VOUCH_CHANNEL_ID,
  TICKET_PANEL_CHANNEL_ID,
  CUSTOMER_ROLE_ID
} = process.env;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel],
});

// Globale Zwischenspeicherung im RAM
const vouchCache = new Map();

// Pfad zum permanenten Volume-Ordner auf Railway
const volumeDirectory = '/app/data';
const counterFilePath = path.join(volumeDirectory, 'counter.json');

// ==================== COUNTER SYSTEM (MIT VOLUME) ====================

function getNextTicketNumber() {
  try {
    // Überprüfen, ob der Volume-Ordner existiert (falls lokal getestet wird, wird er erstellt)
    if (!fs.existsSync(volumeDirectory)) {
      fs.mkdirSync(volumeDirectory, { recursive: true });
    }

    // Wenn die Zähler-Datei noch nicht existiert, erstellen wir sie mit dem Startwert 0
    if (!fs.existsSync(counterFilePath)) {
      fs.writeFileSync(counterFilePath, JSON.stringify({ lastTicketNumber: 0 }));
    }

    const data = JSON.parse(fs.readFileSync(counterFilePath, 'utf8'));
    data.lastTicketNumber += 1;
    
    // Neue Ticketnummer im persistenten Volume speichern
    fs.writeFileSync(counterFilePath, JSON.stringify(data, null, 2));
    return data.lastTicketNumber;
  } catch (error) {
    console.error("❌ Fehler beim Lesen/Schreiben im Volume Zähler:", error);
    return Math.floor(Math.random() * 1000); // Sicherheits-Fallback
  }
}

// ==================== COMMAND REGISTRATION ====================

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  try {
    const commands = [
      new SlashCommandBuilder()
        .setName('setup-tickets')
        .setDescription('Posts the ticket panel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .toJSON()
    ];
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Commands registered.');
  } catch (err) { 
    console.error('❌ Reg failed:', err); 
  }
}

// ==================== TICKET LOGIC ====================

async function handleOpenTicket(interaction, ticketType, selectedItem = null) {
  // Verhindert doppelte geöffnete Tickets desselben Users in dieser Kategorie
  const existing = interaction.guild.channels.cache.find(ch => 
    ch.topic && ch.topic.startsWith(interaction.user.id) && ch.parentId === TICKET_CATEGORY_ID
  );
  
  if (existing) {
    return interaction.reply({ content: `You already have an open ticket: ${existing}`, ephemeral: true });
  }

  // Holt die fortlaufende Ticketnummer aus dem permanenten Volume
  const nextTicketNum = getNextTicketNumber();
  const ticketNumber = String(nextTicketNum).padStart(4, '0');

  const channelName = `${ticketType}-${ticketNumber}-${interaction.user.username}`.toLowerCase().slice(0, 90);
  const productString = selectedItem || 'General Support';

  const channel = await interaction.guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText, 
    parent: TICKET_CATEGORY_ID, 
    topic: `${interaction.user.id}|${productString}|none`,
    permissionOverwrites: [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: SUPPORT_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    ],
  });

  let titleText = '🎫 New Support Ticket';
  let descText = `Hi ${interaction.user}, thanks for reaching out!\n\nPlease describe your issue or question in detail. Our support team will help you shortly.`;

  if (ticketType === 'order') {
    titleText = '🛒 New Order Ticket';
    descText = `Hi ${interaction.user}, thanks for wanting to place an order!\n\n**Selected Product:** \`${productString}\`\n\nOur team will assist you with the payment and delivery shortly.`;
  }

  const embed = new EmbedBuilder().setColor(0x2b2d31).setTitle(titleText).setDescription(descText);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('close_ticket_vouch').setLabel('Close & Vouch').setEmoji('🔒').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('close_ticket_cancel').setLabel('Cancel Ticket').setEmoji('❌').setStyle(ButtonStyle.Secondary)
  );

  await channel.send({ content: `${interaction.user} | <@&${SUPPORT_ROLE_ID}>`, embeds: [embed], components: [row] });
  await interaction.reply({ content: `Ticket created: ${channel}`, ephemeral: true });
}

async function handleCloseTicket(interaction, sendVouch) {
  if (!interaction.member.roles.cache.has(SUPPORT_ROLE_ID)) {
    return interaction.reply({ content: '❌ Only support staff members can close or cancel tickets!', ephemeral: true });
  }
  
  const channel = interaction.channel;
  const [ownerId, productString] = (channel.topic || '').split('|');
  const finalProduct = productString || 'General Support';
  const staffId = interaction.user.id;
  
  await interaction.reply({ content: '🔒 Closing this ticket in 5 seconds...' });
  
  if (sendVouch && ownerId) {
    const embed = new EmbedBuilder()
      .setColor(0xf5c518)
      .setTitle('Thank you for your support!')
      .setDescription(`Your ticket regarding **${channel.name}** has been successfully closed.\n\nIf you were satisfied, please leave us a quick vouch! 🙏`)
      .addFields(
        { name: '📌 Product', value: `\`${finalProduct}\``, inline: true }, 
        { name: '✅ Status', value: 'Completed', inline: true }
      )
      .setThumbnail(interaction.guild.iconURL({ dynamic: true, size: 512 }))
      .setFooter({ text: 'Chud Hub • Your opinion matters', iconURL: interaction.guild.iconURL() })
      .setTimestamp();

    const sessionID = Math.random().toString(36).substring(2, 10);
    vouchCache.set(sessionID, { product: finalProduct, staff: staffId });
      
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`vstart-${sessionID}`)
        .setLabel('Leave a Vouch')
        .setEmoji({ id: '1526364588474372258' })
        .setStyle(ButtonStyle.Success)
    );
    
    try { 
      const user = await client.users.fetch(ownerId); 
      await user.send({ embeds: [embed], components: [row] }); 
    } catch (e) { 
      await channel.send({ content: `<@${ownerId}>`, embeds: [embed], components: [row] }).catch(() => {}); 
    }
  }
  setTimeout(() => { channel.delete().catch(() => {}); }, 5000);
}

// ==================== VOUCH SYSTEM ====================

async function handleVouchStartButton(interaction) {
  const sessionID = interaction.customId.replace('vstart-', '');
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`vrating-${sessionID}`)
      .setPlaceholder('Select a star rating...')
      .addOptions(
