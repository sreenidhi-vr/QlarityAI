const crypto = require('crypto');

// Simulate exactly how the server processes the form data
const formData = {
  token: 'test-token',
  team_id: 'T12345678',
  channel_id: 'C12345678',
  user_id: 'U12345678',
  user_name: 'testuser',
  command: '/domo',
  text: 'test query',
  response_url: 'https://hooks.slack.com/commands/test',
  trigger_id: 'test-trigger'
};

// This is exactly how the server reconstructs the body
const urlParams = new URLSearchParams();
for (const [key, value] of Object.entries(formData)) {
  urlParams.append(key, String(value));
}
const reconstructedBody = urlParams.toString();

const timestamp = Math.floor(Date.now() / 1000).toString();
const secret = '467b9ffb7271c83b6a021db3a4000857';

const baseString = `v0:${timestamp}:${reconstructedBody}`;
const hmac = crypto.createHmac('sha256', secret);
hmac.update(baseString);
const signature = `v0=${hmac.digest('hex')}`;

console.log('Timestamp:', timestamp);
console.log('Reconstructed body:', reconstructedBody);
console.log('Body length:', reconstructedBody.length);
console.log('Base string length:', baseString.length);
console.log('Signature:', signature);