module.exports = class Agent {
  constructor(app, data) {
    this.data = data;
  }
  
  async processCreate() {
    await new Promise((resolve, reject) => {
      setTimeout(() => {
        console.log('agent processWillCreate', Date.now());
        // if (process.pid % 2 === 0) {
        //   return reject(new Error('test error'))
        // }
        resolve();
      }, 2000);
    });
  }
  
  processMessage(msg, socket) {
    if (msg.action === 'cluster:ready') {
      console.log('all ready in agent ' + process.pid);
    }
    // console.log('message', msg);
  }
  
  async processDestroy() {
    await new Promise((resolve, reject) => {
      setTimeout(() => {
        console.log('agent processDestroy', Date.now());
        resolve();
      }, 2000);
    });
  }
};