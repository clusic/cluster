const fs = require('fs');
const path = require('path');
const IPC = require('@clusic/ipc');
const { processArgvFormatter, loadFile } = require('@clusic/utils');

const [killStatus, killing, appFramework, argv, init, onMessage, eventTree, installed, destroy, logger, processTimer] = [
  Symbol('Application#kill.status'),
  Symbol('Application#killing'),
  Symbol('Application#app'),
  Symbol('Application#config'),
  Symbol('Application#init'),
  Symbol('Application#message'),
  Symbol('Application#event'),
  Symbol('Application#installed'),
  Symbol('Application#destroy'),
  Symbol('Application#logger'),
  Symbol('Application#timer')
];

new (class Application extends IPC {
  constructor(processArgvArray) {
    const _argv = processArgvFormatter(processArgvArray);
    if (!_argv.name) _argv.name = process.pid;
    super(_argv.type === 'agent');
    this[killStatus] = 0;
    this[installed] = false;
    this[eventTree] = {};
    this[argv] = _argv;
    
    const framework = path.isAbsolute(this[argv].framework)
      ? this[argv].framework
      : path.resolve(this[argv].cwd || process.cwd(), 'node_module', this[argv].framework);
    
    if (!fs.existsSync(framework)) throw new Error('找不到framework应用架构:' + framework);
    
    this[appFramework] = new (this[argv].type === 'agent'
      ? loadFile(framework + '/agent.js')
      : loadFile(framework + '/app.js'))(this, this[argv]);
    this[processTimer] = setInterval(() => {}, 24 * 60 * 60 * 1000);
    
    this.on('message', (msg, socket) => this[onMessage](msg, socket));
    process.on('SIGTERM', this[killing].bind(this, 'SIGTERM'));
    process.on('SIGINT', this[killing].bind(this, 'SIGINT'));
    process.on('SIGQUIT', this[killing].bind(this, 'SIGQUIT'));
    ['error', 'rejectionHandled', 'uncaughtException', 'unhandledRejection'].forEach(ErrType => process.on(ErrType, e => {
      if (this[installed]) return this[logger].error(e);
      this.kill();
    }));
    
    this[init]();
  }
  
  get [logger]() {
    return this[appFramework].logger || console;
  }
  
  [onMessage](msg, socket) {
    if (this[eventTree][msg.action]) {
      this[eventTree][msg.action]();
      delete this[eventTree][msg.action];
      return;
    }
    if (typeof this[appFramework].processMessage === 'function') {
      this[appFramework].processMessage(msg, socket);
    }
  }
  
  [init]() {
    if (typeof this[appFramework].processCreate === 'function') {
      this[appFramework].processCreate().then(() => new Promise(resolve => {
        this[eventTree]['process:created'] = resolve;
        this.send('master', this[argv].type + ':created', { name: this[argv].name });
      })).catch(e => new Promise((resolve, reject) => {
        this[logger].error(e);
        this[eventTree]['process:failed'] = reject;
        this.send('master', this[argv].type + ':failed', { name: this[argv].name });
      })).then(() => this[installed] = true);
    } else {
      this.send('master', this[argv].type + ':created', { name: this[argv].name });
    }
  }
  
  kill() {
    this.send('master', 'shutdown');
  }
  
  /**
   * kill this process
   * @param killStatus {number}
   *  - 0: 未开始
   *  - 1: 队列中
   *  - 2: 开始关闭
   *  - 3: 执行脚本
   *  - 4: 关闭进程
   * @param signal
   */
  [killing](signal) {
    if (this[killStatus]) return;
    this[killStatus] = 1;
    this[eventTree]['process:kill'] = () => {
      if (this[killStatus] < 2) {
        this[killStatus] = 2;
      }
    };
    const timer = setInterval(() => {
      switch (this[killStatus]) {
        case 2:
          this[killStatus] = 3;
          this[destroy]();
          break;
        case 4:
          clearInterval(timer);
          clearInterval(this[processTimer]);
          this.send('master', this[argv].type + ':dead', { name: this[argv].name });
          process.exit(0);
          break;
      }
    }, 10);
    this.send('master', this[argv].type + ':kill', { name: this[argv].name });
  }
  
  [destroy]() {
    if (typeof this[appFramework].processDestroy === 'function') {
      this[appFramework].processDestroy().then(() => {
        this[killStatus] = 4;
      }).catch(e => {
        this[logger].error(e);
        this[killStatus] = 4;
      });
    } else {
      this[killStatus] = 4;
    }
  }
})(process.argv.slice(2));