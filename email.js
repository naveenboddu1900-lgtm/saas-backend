const nodemailer = require('nodemailer');
const logger = require('./logger');

const transporter = nodemailer.createTransporter({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendEmail = async ({ to, subject, html, text, from = process.env.SMTP_USER }) => {
  try {
    const info = await transporter.sendMail({
      from: `"SaaS Platform" <${from}>`,
      to,
      subject,
      text,
      html,
    });

    logger.info(`Email sent: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error('Email sending failed:', error);
    return { success: false, error: error.message };
  }
};

const emailTemplates = {
  welcome: (data) => ({
    subject: `Welcome to ${data.tenantName || 'SaaS Platform'}!`,
    html: `
      <h1>Welcome, ${data.firstName}!</h1>
      <p>Your account has been created successfully.</p>
      <p>You can login at: <a href="${data.loginUrl}">${data.loginUrl}</a></p>
    `,
  }),
  passwordReset: (data) => ({
    subject: 'Password Reset Request',
    html: `
      <h1>Password Reset</h1>
      <p>Click the link below to reset your password:</p>
      <a href="${data.resetUrl}">${data.resetUrl}</a>
      <p>This link expires in 1 hour.</p>
    `,
  }),
  emailVerification: (data) => ({
    subject: 'Verify Your Email',
    html: `
      <h1>Email Verification</h1>
      <p>Click the link below to verify your email:</p>
      <a href="${data.verificationUrl}">${data.verificationUrl}</a>
    `,
  }),
  orderConfirmation: (data) => ({
    subject: `Order Confirmation - ${data.orderNumber}`,
    html: `
      <h1>Thank you for your order!</h1>
      <p>Order Number: ${data.orderNumber}</p>
      <p>Total: $${data.total}</p>
    `,
  }),
};

module.exports = { sendEmail, emailTemplates };