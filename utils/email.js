const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const sendConfirmationEmail = async (email, token) => {
  const confirmationUrl = `${process.env.FRONTEND_URL}/set-password?token=${token}`;
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Set Your Password',
    html: `
      <h2>Welcome to FirstCraft!</h2>
      <p>Please set your password by clicking the link below. It should contain a minimum of 8 characters (Uppercase, Lowercase, numbers and special characters):</p>
      <a href="${confirmationUrl}">Set Your Password</a>
      <p>If you did not register, please ignore this email.</p>
    `,
  };

  await transporter.sendMail(mailOptions);
};

const sendAgentConfirmationEmail = async (email, name, token) => {
  const confirmationUrl = `${process.env.FRONTEND_URL}/set-password?token=${token}`;
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Welcome to FirstCraft - Sales Agent Registration',
    html: `
      <h2>Welcome, ${name}!</h2>
      <p>Congratulations! You have been successfully registered as a sales agent for FirstCraft.</p>
      <p>Please set your password by clicking the link below. It should contain a minimum of 8 characters (Uppercase, Lowercase, numbers and special characters):</p>
      <a href="${confirmationUrl}">Set Your Password</a>
      <p>This link will expire in 24 hours. If you did not expect this email, please contact your administrator.</p>
      <p>Thank you,<br>FirstCraft Team</p>
    `,
  };

  await transporter.sendMail(mailOptions);
};

const sendResetEmail = async (email, name, token) => {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
  console.log('Sending reset email to:', email, 'with URL:', resetUrl);
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Password Reset Request',
    html: `
      <h2>Password Reset</h2>
      <p>Hi ${name || 'User'},</p>
      <p>You requested a password reset for your FirstCraft account. Click the link below to set a new password:</p>
      <a href="${resetUrl}">Reset Password</a>
      <p>This link will expire in 1 hour. If you did not request a password reset, please ignore this email.</p>
      <p>Thank you,<br>FirstCraft Team</p>
    `,
  };

  await transporter.sendMail(mailOptions);
};

module.exports = { sendConfirmationEmail, sendAgentConfirmationEmail, sendResetEmail };