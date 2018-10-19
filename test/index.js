const path = require('path');
const master = require('../lib/master');
const app = new master({
  cwd: __dirname,
  env: 'dev',
  // agents: ['agent', 'test', 'abc'],
  framework: path.resolve(__dirname, 'framework'),
  // max: 2
});

app.createServer().catch(e => app.kill());