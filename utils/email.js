const nodemailer = require('nodemailer');
require('dotenv').config();

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });

  return transporter;
}

async function sendEmail({ to, subject, html, text }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!from) {
    console.warn('SMTP_FROM/SMTP_USER not configured; skipping email send.');
    return;
  }

  const transport = getTransporter();
  await transport.sendMail({
    from,
    to,
    subject,
    text: text || '',
    html: html || text || ''
  });
}

module.exports = { sendEmail };


