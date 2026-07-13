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
  EmbedBuilder 
} = require('discord.js');

const { 
  DISCORD_TOKEN, 
  CLIENT_ID, 
  GUILD_ID, 
  TICKET_CATEGORY_ID, 
  SUPPORT_ROLE_ID, 
  VOUCH_CHANNEL_ID 
} = process.env;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages
  ],
  partials: [Partials.Channel],
});

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

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), 
      { body: commands }
    );
    console.log('✅ Commands registered.');
  } catch (err) { 
    console.error('❌ Reg failed:', err); 
  }
}

// ==================== TICKET LOGIC ====================

async function handleOpenTicket(interaction, ticketType, selectedItem = null) {
  const existing = interaction.guild.channels.cache.find(ch => 
    ch.topic && ch.topic.startsWith(interaction.user.id) && ch.parentId === TICKET_CATEGORY_ID
  );
  
  if (existing) {
    return interaction.reply({ 
      content: `You already have an open ticket: ${existing}`, 
      ephemeral: true 
    });
  }

  const channelName = `${ticketType}-${interaction.user.username}`.toLowerCase().slice(0, 90);
  const productString = selectedItem || 'General Support';

  const channel = await interaction.guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText, 
    parent: TICKET_CATEGORY_ID, 
    // Im Topic steht standardmäßig: UserID | Produkt | (Noch kein Staff)
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
    descText = `Hi ${interaction.user}, thanks for wanting to place an order!\n\n` +
               `**Selected Product:** \`${productString}\`\n\n` +
               `Our team will assist you with the payment and delivery shortly.`;
  }

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(titleText)
    .setDescription(descText);
    
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('close_ticket_vouch')
      .setLabel('Close & Vouch')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('close_ticket_cancel')
      .setLabel('Cancel Ticket')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Secondary)
  );

  await channel.send({ 
    content: `${interaction.user} | <@&${SUPPORT_ROLE_ID}>`, 
    embeds: [embed], 
    components: [row] 
  });
  
  await interaction.reply({ content: `Ticket created: ${channel}`, ephemeral: true });
}
async function handleCloseTicket(interaction, sendVouch) {
  if (!interaction.member.roles.cache.has(SUPPORT_ROLE_ID)) return interaction.reply({ content: '❌ Only support staff members can close or cancel tickets!', ephemeral: true });
  const channel = interaction.channel;
  const [ownerId, productString] = (channel.topic || '').split('|');
  const finalProduct = productString || 'General Support', staffId = interaction.user.id;
  await interaction.reply({ content: '🔒 Closing this ticket in 5 seconds...' });
  if (sendVouch && ownerId) {
    const embed = new EmbedBuilder().setColor(0xf5c518).setTitle('⭐ Thank you for your support!').setDescription(`Your ticket regarding **${channel.name}** has been successfully closed.\n\nIf you were satisfied, please leave us a quick vouch! 🙏`)
      .addFields({ name: '📌 Product', value: `\`${finalProduct}\``, inline: true }, { name: '✅ Status', value: 'Completed', inline: true }).setThumbnail('https://imgur.com').setFooter({ text: 'Chud Hub • Your opinion matters', iconURL: interaction.guild.iconURL() }).setTimestamp();
    const hexData = Buffer.from(`${finalProduct}|${staffId}`, 'utf8').toString('hex');
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`vouch_start_${hexData}`).setLabel('Leave a Vouch').setEmoji('⭐').setStyle(ButtonStyle.Success));
    try { const user = await client.users.fetch(ownerId); await user.send({ embeds: [embed], components: [row] }); } 
    catch (e) { await channel.send({ content: `<@${ownerId}>`, embeds: [embed], components: [row] }).catch(() => {}); }
  }
  setTimeout(() => { channel.delete().catch(() => {}); }, 5000);
}

// ==================== VOUCH SYSTEM ====================

async function handleVouchStartButton(interaction) {
  const hexData = interaction.customId.replace('vouch_start_', '');
  const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`vouch_rating_${hexData}`).setPlaceholder('Select a star rating...')
    .addOptions([{ label: '⭐ 1 - Very Unsatisfied', value: '1' }, { label: '⭐⭐ 2 - Poor', value: '2' }, { label: '⭐⭐⭐ 3 - Satisfied', value: '3' }, { label: '⭐⭐⭐⭐ 4 - Very Good', value: '4' }, { label: '⭐⭐⭐⭐⭐ 5 - Perfect Service!', value: '5' }]));
  await interaction.reply({ content: 'How many stars would you like to give us?', components: [row], ephemeral: true });
}

async function handleVouchRatingSelect(interaction) {
  const hexData = interaction.customId.replace('vouch_rating_', ''), rating = interaction.values;
  const modal = new ModalBuilder().setCustomId(`vouch_modal_${hexData}_${rating}`).setTitle('Submit Your Vouch');
  modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('vouch_text').setLabel('Your Experience (Optional)').setPlaceholder('e.g., Super fast delivery!').setStyle(TextInputStyle.Paragraph).setRequired(false)));
  await interaction.showModal(modal);
}

async function handleVouchModalSubmit(interaction) {
  const parts = interaction.customId.split('_'), rating = parts.pop(), hexData = parts.pop();
  let detectedProduct = 'General Support', detectedStaff = 'Unknown Staff';
  try { if (hexData) { const [product, staffId] = Buffer.from(hexData, 'hex').toString('utf8').split('|'); if (product) detectedProduct = product; if (staffId && staffId !== 'none') detectedStaff = `<@${staffId}>`; } } catch (e) { console.error(e); }
  const text = interaction.fields.getTextInputValue('vouch_text') || '*No comment left*', stars = '⭐'.repeat(Number(rating)), guild = client.guilds.cache.get(GUILD_ID);
  const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle('📥 New Customer Vouch').setDescription('A customer has just submitted a new review!')
    .addFields({ name: '👤 Customer', value: `${interaction.user} (\`${interaction.user.tag}\`)`, inline: false }, { name: '⭐ Rating', value: `${stars} (\`${rating}/5\`)`, inline: true }, { name: '🛒 Product', value: `\`${detectedProduct}\``, inline: true }, { name: '🛠️ Handled By', value: detectedStaff, inline: false }, { name: '💬 Comment', value: `\`\`\`\n${text}\n\`\`\``, inline: false })
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true })).setFooter({ text: 'Chud Hub • Verified Review', iconURL: guild?.iconURL() || null }).setTimestamp();
  const ch = guild?.channels.cache.get(VOUCH_CHANNEL_ID) || await client.channels.fetch(VOUCH_CHANNEL_ID).catch(() => null);
  if (ch) {
    await ch.send({ embeds: [embed] });
    await interaction.reply({ content: 'Your vouch has been successfully posted! Thank you.', ephemeral: true });
    setTimeout(async () => {
      const upsellEmbed = new EmbedBuilder().setColor(0xe74c3c).setTitle('🛍️ Ready for more?').setDescription(`Thank you again for buying at **Chud Hub**!\n\nIf you want to place another order or browse our packages again, simply open a new ticket using the button below. Our team is always ready to assist you! 🌟`);
      const upsellRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('open_ticket_order').setLabel('Buy Again').setEmoji('🛒').setStyle(ButtonStyle.Danger));
      await interaction.user.send({ embeds: [upsellEmbed], components: [upsellRow] }).catch(() => {});
    }, 2000);
  } else { await interaction.reply({ content: '❌ Vouch channel could not be found.', ephemeral: true }); }
}

// ==================== EVENTS ====================

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup-tickets') {
      const emb = new EmbedBuilder().setColor(0x2b2d31).setTitle('🎫 Tickets & Orders').setDescription('Need help or want to buy something? Choose an option below.');
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('open_ticket_order').setLabel('Place Order').setEmoji('🛒').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('open_ticket_support').setLabel('Support').setEmoji('🎫').setStyle(ButtonStyle.Primary));
      await interaction.channel.send({ embeds: [emb], components: [row] });
      return await interaction.reply({ content: '✅ Ticket panel successfully setup!', ephemeral: true });
    }
    if (interaction.isButton()) {
      if (interaction.customId === 'open_ticket_order') {
        const itemRow = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('order_item_select').setPlaceholder('Select the package you want to buy...')
          .addOptions([{ label: 'Boost bundle - £9.99', value: 'Boost bundle' }, { label: 'Grind pack - £13.00', value: 'Grind pack' }, { label: 'Builder pack - £19.99', value: 'Builder pack' }, { label: 'Empire pack - £29.99', value: 'Empire pack' }, { label: 'GODMODE PACKAGE - £42.99', value: 'GODMODE PACKAGE' }, { label: 'Chud Hub special - £112.31', value: 'Chud Hub special' }, { label: '10 modded outfits - £10.00', value: '10 modded outfits' }]));
        return await interaction.reply({ content: 'Please select what you would like to order:', components: [itemRow], ephemeral: true });
      }
      if (interaction.customId === 'open_ticket_support') return await handleOpenTicket(interaction, 'support');
      if (interaction.customId === 'close_ticket_vouch') return await handleCloseTicket(interaction, true);
      if (interaction.customId === 'close_ticket_cancel') return await handleCloseTicket(interaction, false);
      if (interaction.customId.startsWith('vouch_start_')) return await handleVouchStartButton(interaction);
    }
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'order_item_select') return await handleOpenTicket(interaction, 'order', interaction.values);
      if (interaction.customId.startsWith('vouch_rating_')) return await handleVouchRatingSelect(interaction);
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('vouch_modal_')) return await handleVouchModalSubmit(interaction);
  } catch (err) { console.error(err); }
});

client.on('ready', async () => {
  console.log(`🤖 Online as ${client.user.tag}`);
  const statuses = ['at Chud Hub! Ready for your next package? 🛒', 'with custom bundles! Open a ticket now 🎫', 'to help you! Open an order ticket ✨'];
  let counter = 0; client.user.setActivity(statuses[counter], { type: 0 });
  setInterval(() => { counter = (counter + 1) % statuses.length; client.user.setActivity(statuses[counter], { type: 0 }); }, 60000);
  await registerCommands();
});

client.on('error', console.error);
client.login(DISCORD_TOKEN);

