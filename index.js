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
    ? `Hi ${interaction.user}, thanks for wanting to place an order!\n\nPlease describe what you would like to buy. Our team will be with you shortly.`
    : `Hi ${interaction.user}, thanks for reaching out!\n\nPlease describe your issue or question in detail. Our support team will help you shortly.`;

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
  
  await interaction.reply({ content: '🔒 Closing this ticket in 5 seconds...' });
  
  if (ownerId) {
    const embed = new EmbedBuilder()
      .setColor(0xf5c518)
      .setTitle('⭐ Thank you for your support!')
      .setDescription(
        `Your ticket **${channel.name}** has been successfully closed.\n\n` +
        `If you were satisfied with our service, we would highly appreciate it if you could leave us a quick vouch. It helps our marketplace and future customers a lot! 🙏`
      )
      .addFields(
        { name: '📌 Ticket Reference', value: `\`${channel.name}\``, inline: true },
        { name: '⏱️ Status', value: 'Completed', inline: true }
      )
      .setThumbnail('https://imgur.com')
      .setFooter({ text: 'HugoSMP Market • Your opinion matters', iconURL: interaction.guild.iconURL() })
      .setTimestamp();
      
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`vouch_start_${channel.name}`)
        .setLabel('Leave a Vouch')
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
  const ref = interaction.customId.replace('vouch_rating_', '');
  const modal = new ModalBuilder()
    .setCustomId(`vouch_modal_${ref}_${interaction.values}`)
    .setTitle('Submit Your Vouch');
    
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('vouch_text')
        .setLabel('Your Experience (Optional)')
        .setPlaceholder('e.g., Super fast delivery, very friendly support team!')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
    )
  );
  await interaction.showModal(modal);
}

async function handleVouchModalSubmit(interaction) {
  const parts = interaction.customId.split('_');
  const rating = parts.pop();
  const ticketRef = parts.slice(2).join('_');
  const text = interaction.fields.getTextInputValue('vouch_text') || '*No comment left*';
  const stars = '⭐'.repeat(Number(rating));

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71) 
    .setTitle('📥 New Customer Vouch')
    .setDescription('A customer has just submitted a new review for their recent experience!')
    .addFields(
      { name: '👤 Customer', value: `${interaction.user} (\`${interaction.user.tag}\`)`, inline: false },
      { name: '⭐ Rating', value: `${stars} (\`${rating}/5\`)`, inline: true },
      { name: '🎫 Ticket', value: `\`${ticketRef || 'N/A'}\``, inline: true },
      { name: '💬 Comment', value: `\`\`\`\n${text}\n\`\`\``, inline: false }
    )
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true })) 
    .setFooter({ text: 'HugoSMP Market • Verified Review', iconURL: interaction.guild.iconURL() })
    .setTimestamp();
    
  const ch = interaction.guild?.channels.cache.get(VOUCH_CHANNEL_ID) 
    || await client.channels.fetch(VOUCH_CHANNEL_ID).catch(() => null);
    
  if (ch) { 
    await ch.send({ embeds: [embed] }); 
    await interaction.reply({ content: 'Your vouch has been successfully posted! Thank you.', ephemeral: true }); 
  } else { 
    await interaction.reply({ content: '❌ Vouch channel could not be found.', ephemeral: true }); 
  }
}

// ==================== EVENTS ====================

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup-tickets') {
      const emb = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle('🎫 Tickets & Orders')
        .setDescription('Need help or want to buy something? Choose the right option below to open a private ticket.');
        
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
