const Koa = require('koa');
const app = new Koa();
module.exports = class Agent {
  constructor(app, data) {
    this.data = data;
  }
  
  async processCreate() {
    app.use(async (ctx, next) => {
      ctx.body = 'ok 123';
      // ctx.status = 200;
    });
    await new Promise((resolve, reject) => {
      this.server = app.listen(8080, (err, str) => {
        if (err) return reject(err);
        resolve();
        console.log('start at', 'http://120.0.0.1:8080', str);
      })
    });
  }
  
  processMessage(msg, socket) {
    // if (msg.action === 'cluster:ready') {
    //   console.log('all ready in worker ' + process.pid);
    // }
    // console.log('message', msg);
  }
  
  async processDestroy() {
    // await new Promise((resolve, reject) => {
    //   setTimeout(() => {
    //     console.log('worker processDestroy', Date.now());
    //     resolve();
    //   }, 2000);
    // });
    this.server.close();
  }
};