const nodemailer = require('nodemailer');

// Read SMTP configuration from environment variables
const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM
} = process.env;

// Check if critical SMTP configuration is missing
const isEmailConfigured = SMTP_HOST && SMTP_USER && SMTP_PASS;

if (!isEmailConfigured) {
  console.warn('⚠️  Email not configured: missing SMTP_* env vars');
  console.warn('   Required: SMTP_HOST, SMTP_USER, SMTP_PASS');
  console.warn('   Optional: SMTP_PORT (default: 587), SMTP_SECURE (default: false), SMTP_FROM');
}

// Create transporter if email is configured
let transporter = null;

if (isEmailConfigured) {
  try {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: SMTP_SECURE === 'true',
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    });

    console.log(`✅ Email transporter configured: ${SMTP_HOST}:${SMTP_PORT || 587}`);
  } catch (error) {
    console.error('❌ Failed to create email transporter:', error.message);
    transporter = null;
  }
}

/**
 * Send an email using the configured SMTP transporter
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} [options.text] - Plain text email body
 * @param {string} [options.html] - HTML email body
 * @returns {Promise<Object>} - Result object with success status and message
 */
async function sendEmail({ to, subject, text, html }) {
  // If email is not configured, return a no-op that logs and resolves
  if (!isEmailConfigured || !transporter) {
    console.log(`📧 Email not sent (not configured): to=${to}, subject=${subject}`);
    return {
      success: false,
      error: 'Email not configured: missing SMTP_* environment variables'
    };
  }

  // Validate required fields
  if (!to || !subject) {
    const error = 'Missing required email fields: to and subject are required';
    console.error('❌', error);
    return {
      success: false,
      error
    };
  }

  // Use SMTP_FROM if provided, otherwise use SMTP_USER
  const from = SMTP_FROM || SMTP_USER;

  try {
    console.log(`📧 Sending email to: ${to}, subject: ${subject}`);

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text: text || html || '',
      html: html || text || ''
    });

    console.log(`✅ Email sent successfully to ${to}. Message ID: ${info.messageId}`);
    
    return {
      success: true,
      messageId: info.messageId
    };
  } catch (error) {
    console.error(`❌ Failed to send email to ${to}:`, error.message);
    
    return {
      success: false,
      error: error.message || 'Failed to send email'
    };
  }
}

module.exports = {
  sendEmail,
  isEmailConfigured
};

