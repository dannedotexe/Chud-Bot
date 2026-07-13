// ==================== INTERACTION HANDLER ====================

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'setup-tickets') {
        const embed = buildTicketPanelEmbed();
        const row = buildTicketPanelRow();
        await interaction.reply({ embeds: [embed], components: [row] });
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'open_ticket') {
        return await handleOpenTicket(interaction);
      }
      if (interaction.customId === 'close_ticket') {
        return await handleCloseTicket(interaction);
      }
      if (interaction.customId.startsWith('vouch_start_')) {
        return await handleVouchStartButton(interaction);
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith('vouch_rating_')) {
        return await handleVouchRatingSelect(interaction);
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('vouch_modal_')) {
        return await handleVouchModalSubmit(interaction);
      }
    }

  } catch (error) {
    console.error('Error handling interaction:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'An internal error occurred.', ephemeral: true }).catch(() => {});
    }
  }
});

// ==================== START BOT ====================

client.once('ready', async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  await registerCommands();
});

client.login(DISCORD_TOKEN);
