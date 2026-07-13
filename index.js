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

  // Holt alle Kanäle aus der Kategorie & ermittelt die höchste Nummer
  const categoryChannels = interaction.guild.channels.cache.filter(ch => ch.parentId === TICKET_CATEGORY_ID);
  
  let maxNumber = 0;
  
  categoryChannels.forEach(ch => {
    const parts = ch.name.split('-');
    // Sucht nach dem Teil im Namen, der nur aus Zahlen besteht (die Ticketnummer)
    const numPart = parts.find(part => /^\d+$/.test(part));
    if (numPart) {
      const num = parseInt(numPart, 10);
      if (num > maxNumber) {
        maxNumber = num;
      }
    }
  });

  // Die neue Ticketnummer ist die höchste gefundene Nummer + 1 (zählt auch nach Löschungen richtig weiter)
  const nextTicketNum = maxNumber + 1;
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
        // Custom-Emoji als Objekt übergeben (Kein Absturz)
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
      .addOptions([
        { label: '⭐ 1 - Very Unsatisfied', value: '1' }, 
        { label: '⭐⭐ 2 - Poor', value: '2' }, 
        { label: '⭐⭐⭐ 3 - Satisfied', value: '3' }, 
        { label: '⭐⭐⭐⭐ 4 - Very Good', value: '4' }, 
        { label: '⭐⭐⭐⭐⭐ 5 - Perfect Service!', value: '5' }
      ])
  );
  await interaction.reply({ content: 'How many stars would you like to give us?', components: [row], ephemeral: true });
}

async function handleVouchRatingSelect(interaction) {
  const sessionID = interaction.customId.replace('vrating-', '');
  const rating = interaction.values[0];
  
  const modal = new ModalBuilder()
    .setCustomId(`vmodal-${sessionID}-${rating}`)
    .setTitle('Submit Your Vouch');
    
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('vouch_text')
        .setLabel('Your Experience (Optional)')
        .setPlaceholder('e.g., Super fast delivery!')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
    )
  );
  await interaction.showModal(modal);
}

async function handleVouchModalSubmit(interaction) {
  const parts = interaction.customId.replace('vmodal-', '').split('-');
  const sessionID = parts[0];
  const rating = parts[1];
  
  const cachedData = vouchCache.get(sessionID) || { product: 'General Support', staff: 'none' };
  vouchCache.delete(sessionID); 

  const text = interaction.fields.getTextInputValue('vouch_text') || '*No comment left*';
  const stars = '⭐'.repeat(Number(rating || 5));
  const guild = client.guilds.cache.get(GUILD_ID);
  
  let staffMention = 'Unknown Staff';
  if (cachedData.staff && cachedData.staff !== 'none') staffMention = `<@${cachedData.staff}>`;

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('📥 New Customer Vouch')
    .setDescription('A customer has just submitted a new review!')
    .addFields(
      { name: '👤 Customer', value: `${interaction.user} (\`${interaction.user.tag}\`)`, inline: false }, 
      { name: '⭐ Rating', value: `${stars} (\`${rating || 5}/5\`)`, inline: true }, 
      { name: '🛒 Product', value: `\`${cachedData.product}\``, inline: true }, 
      { name: '🛠️ Handled By', value: staffMention, inline: false }, 
      { name: '💬 Comment', value: `\`\`\`\n${text}\n\`\`\``, inline: false }
    )
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: 'Chud Hub • Verified Review', iconURL: guild?.iconURL() || null })
    .setTimestamp();
  
  const ch = guild?.channels.cache.get(VOUCH_CHANNEL_ID) || await client.channels.fetch(VOUCH_CHANNEL_ID).catch(() => null);
  if (ch) {
    await ch.send({ embeds: [embed] });
    await interaction.reply({ content: 'Your vouch has been successfully posted! Thank you.', ephemeral: true });
    
    if (guild && CUSTOMER_ROLE_ID) {
      try {
        const member = await guild.members.fetch(interaction.user.id).catch(() => null);
        if (member && !member.roles.cache.has(CUSTOMER_ROLE_ID)) {
          await member.roles.add(CUSTOMER_ROLE_ID);
        }
      } catch (err) { console.error('❌ Rollenfehler:', err); }
    }

    // "Buy Again" nach 2 Sekunden senden
    setTimeout(async () => {
      if (!GUILD_ID || !TICKET_PANEL_CHANNEL_ID) {
        console.warn("⚠️ Warnung: GUILD_ID oder TICKET_PANEL_CHANNEL_ID fehlt in der .env!");
      }

      const channelLink = `https://discord.com/channels/${GUILD_ID}/${TICKET_PANEL_CHANNEL_ID || '0'}`;
      console.log(`🔗 Versuche 'Buy Again' zu senden mit URL: ${channelLink}`);

      const upsellEmbed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🛍️ Ready for more?')
        .setDescription(`Thank you again for buying at **Chud Hub**!\n\nIf you want to place another order or browse our packages again, click the button below to go straight to our ticket channel! Our team is always ready to assist you! 🌟`);
      
      // Fehlerfreier ButtonBuilder ohne Custom ID und direkter Link-Zuweisung
      const buyAgainBtn = new ButtonBuilder()
        .setLabel('Buy Again')
        .setEmoji('🛒')
        .setStyle(ButtonStyle.Link)
        .setUrl(channelLink);

      const upsellRow = new ActionRowBuilder().addComponents(buyAgainBtn);
      
      try {
        await interaction.user.send({ embeds: [upsellEmbed], components: [upsellRow] });
        console.log("✅ 'Buy Again' wurde erfolgreich per DM gesendet.");
      } catch (dmError) {
        console.error("❌ DM gescheitert. Grund:", dmError.message, "- Versuche Fallback im Chat...");
        
        // Fallback im Kanal
        await interaction.followUp({ 
          embeds: [upsellEmbed], 
          components: [upsellRow], 
          ephemeral: true 
        }).then(() => {
          console.log("✅ 'Buy Again' wurde erfolgreich als flüchtiges Followup im Kanal gepostet.");
        }).catch((followUpError) => {
          console.error("❌ Fallback im Kanal ist ebenfalls gescheitert! Grund:", followUpError.message);
        });
      }
    }, 2000);

  } else { 
    await interaction.reply({ content: '❌ Vouch channel could not be found.', ephemeral: true }); 
  }
}

// ==================== EVENTS ====================

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup-tickets') {
      const emb = new EmbedBuilder().setColor(0x2b2d31).setTitle('🎫 Tickets & Orders').setDescription('Need help or want to buy something? Choose an option below.');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('open_ticket_order').setLabel('Place Order').setEmoji('🛒').setStyle(ButtonStyle.Success), 
        new ButtonBuilder().setCustomId('open_ticket_support').setLabel('Support').setEmoji('🎫').setStyle(ButtonStyle.Primary)
      );
      await interaction.channel.send({ embeds: [emb], components: [row] });
      return await interaction.reply({ content: '✅ Ticket panel successfully setup!', ephemeral: true });
    }
    
    if (interaction.isButton()) {
      if (interaction.customId === 'open_ticket_order') {
        const itemRow = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId('order_item_select').setPlaceholder('Select the package you want to buy...')
            .addOptions([
              { label: 'Boost bundle - £9.99', value: 'Boost bundle' }, 
              { label: 'Grind pack - £13.00', value: 'Grind pack' }, 
              { label: 'Builder pack - £19.99', value: 'Builder pack' }, 
              { label: 'Empire pack - £29.99', value: 'Empire pack' }, 
              { label: 'GODMODE PACKAGE - £42.99', value: 'GODMODE PACKAGE' }, 
              { label: 'Chud Hub special - £112.31', value: 'Chud Hub special' }, 
              { label: '10 modded outfits - £10.00', value: '10 modded outfits' }
            ])
        );
        return await interaction.reply({ content: 'Please select what you would like to order:', components: [itemRow], ephemeral: true });
      }
      if (interaction.customId === 'open_ticket_support') return await handleOpenTicket(interaction, 'support');
      if (interaction.customId === 'close_ticket_vouch') return await handleCloseTicket(interaction, true);
      if (interaction.customId === 'close_ticket_cancel') return await handleCloseTicket(interaction, false);
      if (interaction.customId.startsWith('vstart-')) return await handleVouchStartButton(interaction);
    }
    
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'order_item_select') return await handleOpenTicket(interaction, 'order', interaction.values[0]);
      if (interaction.customId.startsWith('vrating-')) return await handleVouchRatingSelect(interaction);
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('vmodal-')) return await handleVouchModalSubmit(interaction);
  } catch (err) { console.error(err); }
});

client.on('ready', async () => {
  console.log(`🤖 Online as ${client.user.tag}`);
  const statuses = ['at Chud Hub! Ready for your next package? 🛒', 'with custom bundles! Open a ticket now 🎫', 'to help you! Open an order ticket ✨'];
  let counter = 0; 
  
  client.user.setActivity(statuses[counter], { type: ActivityType.Playing });
  setInterval(() => { 
    counter = (counter + 1) % statuses.length; 
    client.user.setActivity(statuses[counter], { type: ActivityType.Playing }); 
  }, 60000);
  await registerCommands();
});

client.on('error', console.error);
client.login(DISCORD_TOKEN);
