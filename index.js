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

async function sendVouchPrompt(clientRef, userId, ticketRef, fallbackChannel = null) {
  const embed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle('⭐ How was your ticket?')
    .setDescription(`Your ticket **${ticketRef}** has been closed.\n\nLeave a quick vouch if you want to support us!`)
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
  await interaction.reply({ content: 'How many stars?', components: [row], ephemeral: true });
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
    .setRequired(false)
    .setMaxLength(500);

  modal.addComponents(new ActionRowBuilder().addComponents(textInput));
  await interaction.showModal(modal);
}

async function handleVouchModalSubmit(interaction) {
  const parts = interaction.customId.split('_');
  const rating = parts.pop();
  const ticketRef = parts.slice(2).join('_');
  const text = interaction.fields.getTextInputValue('vouch_text') || '*No comment left*';
  const stars = '⭐'.repeat(Number(rating)) + '☆'.repeat(5 - Number(rating));

  const embed = new EmbedBuilder()
    .setColor(0xf5c518)
    .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
    .setTitle('New Vouch Received! ⭐')
    .setDescription(`**Rating:** ${stars}\n\n**Comment:**\n${text}`)
    .setTimestamp();

  const vouchChannel = interaction.guild?.channels.cache.get(VOUCH_CHANNEL_ID) 
    || await interaction.client.channels.fetch(VOUCH_CHANNEL_ID).catch(() => null);

  if (vouchChannel) {
    await vouchChannel.send({ embeds: [embed] });
    await interaction.reply({ content: 'Vouch posted!', ephemeral: true });
  } else {
    await interaction.reply({ content: '❌ Vouch channel not found.', ephemeral: true });
  }
}

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'setup-tickets') {
      return await interaction.reply({ embeds: [buildTicketPanelEmbed()], components: [buildTicketPanelRow()] });
    }
    if (interaction.isButton()) {
      if (interaction.customId === 'open_ticket') return await handleOpenTicket(interaction);
      if (interaction.customId === 'close_ticket') return await handleCloseTicket(interaction);
      if (interaction.customId.startsWith('vouch_start_')) return await handleVouchStartButton(interaction);
    }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('vouch_rating_')) {
      return await handleVouchRatingSelect(interaction);
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith('vouch_modal_')) {
      return await handleVouchModalSubmit(interaction);
    }
  } catch (error) {
    console.error(error);
  }
});

client.once('ready', async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  await registerCommands();
});

client.login(DISCORD_TOKEN);
