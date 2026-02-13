const crypto = require('crypto');

const timestamp = Math.floor(Date.now() / 1000).toString();
const body = 'token=test-token&team_id=T12345678&channel_id=C12345678&user_id=U12345678&user_name=testuser&command=/domo&text=test+query&response_url=https://hooks.slack.com/commands/test&trigger_id=test-trigger';
const secret = '467b9ffb7271c83b6a021db3a4000857';

const baseString = `v0:${timestamp}:${body}`;
const hmac = crypto.createHmac('sha256', secret);
hmac.update(baseString);
const signature = `v0=${hmac.digest('hex')}`;

console.log('Timestamp:', timestamp);
console.log('Signature:', signature);
console.log('Body length:', body.length);
console.log('Base string length:', baseString.length);