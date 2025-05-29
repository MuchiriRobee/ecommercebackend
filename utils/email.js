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
      <p>Please set your password by clicking the link below:</p>
      <a href="${confirmationUrl}">Set Your Password</a>
      <p>If you did not register, please ignore this email.</p>
    `,
  };

  await transporter.sendMail(mailOptions);
};

module.exports = { sendConfirmationEmail };