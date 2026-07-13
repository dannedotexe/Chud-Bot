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

async function handleOpenTicket(interaction, ticketType) {
  const existing = interaction.guild.channels.cache.find(ch => 
    ch.topic === interaction.user.id && ch.parentId === TICKET_CATEGORY_ID
  );
  
  if (existing) {
    return interaction.reply({ 
      content: `You already have an open ticket: ${existing}`, 
      ephemeral: true 
    });
  }

  const channelName = `${ticketType}-${interaction.user.username}`.toLowerCase().slice(0, 90);

  const channel = await interaction.guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText, 
    parent: TICKET_CATEGORY_ID, 
    topic: interaction.user.id,
    permissionOverwrites: [
      { 
        id: interaction.guild.roles.everyone.id, 
        deny: [PermissionFlagsBits.ViewChannel] 
      },
      { 
        id: interaction.user.id, 
        allow: [
          PermissionFlagsBits.ViewChannel, 
          PermissionFlagsBits.SendMessages, 
          PermissionFlagsBits.ReadMessageHistory
        ] 
      },
      { 
        id: SUPPORT_ROLE_ID, 
        allow: [
          PermissionFlagsBits.ViewChannel, 
          PermissionFlagsBits.SendMessages, 
          PermissionFlagsBits.ReadMessageHistory
        ] 
      },
    ],
  });

  const titleText = ticketType === 'order' ? '🛒 New Order Ticket' : '🎫 New Support Ticket';
  const descText = ticketType === 'order' 
    ? `Hi ${interaction.user}, thanks for wanting to place an order!\n\nPlease describe what you would like to buy.`
    : `Hi ${interaction.user}, thanks for reaching out!\n\nPlease describe your issue. Our team will help you shortly.`;

  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle(titleText)
    .setDescription(descText);
    
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('close_ticket')
      .setLabel('Close Ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({ 
    content: `${interaction.user} | <@&${SUPPORT_ROLE_ID}>`, 
    embeds: [embed], 
    components: [row] 
  });
  
  await interaction.reply({ content: `Ticket created: ${channel}`, ephemeral: true });
}

async function handleCloseTicket(interaction) {
  const channel = interaction.channel;
  const ownerId = channel.topic;
  
  await interaction.reply({ content: '🔒 Closing in 5 seconds...' });
  
  if (ownerId) {
    // Verschönertes Vouch-Embed mit strukturierter Anordnung
    const embed = new EmbedBuilder()
      .setColor(0xf5c518)
      .setTitle('⭐ Vielen Dank für deinen Support!')
      .setDescription(
        `Dein Ticket **${channel.name}** wurde soeben erfolgreich geschlossen.\n\n` +
        `Wenn alles zu deiner Zufriedenheit verlaufen ist, würden wir uns riesig über eine kurze Bewertung freuen. Das hilft unserem Marktplatz und neuen Kunden sehr! 🙏`
      )
      .addFields(
        { name: '📌 Ticket-Referenz', value: `\`${channel.name}\``, inline: true },
        { name: '⏱️ Dauer', value: 'Abgeschlossen', inline: true }
      )
      .setThumbnail('https://imgur.com') // Ein schönes Standard-Stern-Icon als Thumbnail
      .setFooter({ text: 'HugoSMP Market • Deine Meinung zählt', iconURL: interaction.guild.iconURL() })
      .setTimestamp();
      
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`vouch_start_${channel.name}`)
        .setLabel('Bewertung abgeben')
        .setEmoji('⭐')
        .setStyle(ButtonStyle.Success)
    );
    
    try { 
      const user = await client.users.fetch(ownerId); 
      await user.send({ embeds: [embed], components: [row] }); 
    } catch (e) { 
      await channel.send({ 
        content: `<@${ownerId}>`, 
        embeds: [embed], 
        components: [row] 
      }).catch(() => {}); 
    }
  }
  
  setTimeout(() => { 
    channel.delete().catch(() => {}); 
  }, 5000);
}

// ==================== VOUCH SYSTEM ====================

async function handleVouchStartButton(interaction) {
  const ref = interaction.customId.replace('vouch_start_', '');
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`vouch_rating_${ref}`)
      .setPlaceholder('Wähle eine Sterneanzahl...')
      .addOptions([
        { label: '⭐ 1 - Sehr unzufrieden', value: '1' }, 
        { label: '⭐⭐ 2 - Mangelhaft', value: '2' }, 
        { label: '⭐⭐⭐ 3 - Zufriedenstellend', value: '3' }, 
        { label: '⭐⭐⭐⭐ 4 - Sehr gut', value: '4' }, 
        { label: '⭐⭐⭐⭐⭐ 5 - Perfekter Service!', value: '5' }
      ])
  );
  await interaction.reply({ content: 'Wie viele Sterne möchtest du uns geben?', components: [row], ephemeral: true });
}

async function handleVouchRatingSelect(interaction) {
  const ref = interaction.customId.replace('vouch_rating_', '');
  const modal = new ModalBuilder()
    .setCustomId(`vouch_modal_${ref}_${interaction.values}`)
    .setTitle('Bewertung absenden');
    
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('vouch_text')
        .setLabel('Dein Feedback (Optional)')
        .setPlaceholder('z.B. Super schnelle Lieferung, sehr freundlicher Support!')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
    )
  );
  await interaction.showModal(modal);
}

async function handleVouchModalSubmit(interaction) {
  const parts = interaction.customId.split('_');
  const rating = parts.pop();
  const text = interaction.fields.getTextInputValue('vouch_text') || '*Kein Kommentar hinterlassen*';
  
  const embed = new EmbedBuilder()
    .setColor(0xf5c518)
    .setAuthor({ 
      name: interaction.user.tag, 
      iconURL: interaction.user.displayAvatarURL() 
    })
    .setTitle('Neues Vouch erhalten! ⭐')
    .setDescription(`**Sterne:** ${'⭐'.repeat(Number(rating))}\n\n**Erfahrung:**\n${text}`)
    .setTimestamp();
    
  const ch = interaction.guild?.channels.cache.get(VOUCH_CHANNEL_ID) 
    || await client.channels.fetch(VOUCH_CHANNEL_ID).catch(() => null);
    
  if (ch) { 
    await ch.send({ embeds: [embed] }); 
    await interaction.reply({ content: 'Deine Bewertung wurde erfolgreich gepostet! Vielen Dank.', ephemeral: true }); 
  } else { 
    await interaction.reply({ content: '❌ Bewertungschannel wurde nicht gefunden.', ephemeral: true }); 
  }
}

// ==================== EVENTS ====================

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup-tickets') {
      const emb = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle('🎫 Tickets & Orders')
        .setDescription('Need help or want to buy something? Choose the right option below to open a ticket.');
        
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('open_ticket_order')
          .setLabel('Place Order')
          .setEmoji('🛒')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('open_ticket_support')
          .setLabel('Support')
          .setEmoji('🎫')
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.channel.send({ embeds: [emb], components: [row] });
      return await interaction.reply({ content: '✅ Ticket panel successfully setup!', ephemeral: true });
    }
    
    if (interaction.isButton()) {
      if (interaction.customId === 'open_ticket_order') return await handleOpenTicket(interaction, 'order');
      if (interaction.customId === 'open_ticket_support') return await handleOpenTicket(interaction, 'support');
      if (interaction.customId === 'close_ticket') return await handleCloseTicket(interaction);
      if (interaction.customId.startsWith('vouch_start_')) return await handleVouchStartButton(interaction);
    }
    
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('vouch_rating_')) {
      return await handleVouchRatingSelect(interaction);
    }
    
    if (interaction.isModalSubmit() && interaction.customId.startsWith('vouch_modal_')) {
      return await handleVouchModalSubmit(interaction);
    }
  } catch (err) { 
    console.error(err); 
  }
});

client.on('ready', async () => { 
  console.log(`🤖 Online as ${client.user.tag}`); 
  await registerCommands(); 
});

client.login(DISCORD_TOKEN);
