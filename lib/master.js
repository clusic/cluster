const os = require('os');
const path = require('path');
const net = require('net');
const IPC = require('@clusic/ipc');
const cluster = require('cluster');
const cTable = require('console.table');
const childProcess = require('child_process');
const { stickyWorker, checkPortCanUse } = require('@clusic/utils');
const applicationFile = path.resolve(__dirname, './application.js');

const [killing, config, createSocketServer, socketServer, onMessage, forkAgents, agentSendBack, waitAgentsDone, workerSendBack, workerDead, forkWorkers, waitWorksDone, startInfo] = [
  Symbol('Cluster#killing'),
  Symbol('Cluster#config'),
  Symbol('Cluster#create.socket.server'),
  Symbol('Cluster#socket.server'),
  Symbol('Cluster#message'),
  Symbol('Cluster#fork.agents'),
  Symbol('Cluster#fork.agent.send.back'),
  Symbol('Cluster#fork.agents.wait'),
  Symbol('Cluster#fork.worker.send.back'),
  Symbol('Cluster#fork.worker.dead'),
  Symbol('Cluster#fork.workers'),
  Symbol('Cluster#fork.workers.wait'),
  Symbol('Cluster#start.info')
];

/**
 * IPC Master process
 *
 * OPTIONS:
 * @param socket {boolean} <default: false> 是否开启socket模式
 * @param port {number} <default: 8080> 服务启动端口
 * @param cwd {string} <default: process.cwd()> 服务运行基址
 * @param env {string} <default: 'development'> 环境变量
 * @param debug {boolean|string} <default: false> 是否开启调试以及调试模式 eg: 'inspect-brk'
 * @param framework {string} <default: __dirname> 服务启动框架
 * @param max {Number} <default: os.cpus().length> 最大worker进程个数
 * @type {module.MasterProcess}
 */
module.exports = class MasterProcess extends IPC {
  constructor(options = {}) {
    super();
    this[config] = options;
    process.env.NODE_ENV = this[config].env || process.env.NODE_ENV || 'development';
    this.on('message', (msg, socket) => this[onMessage](msg, socket));
    // 进程被退出时候的处理
    // 杀掉所有进程
    process.on('SIGTERM', () => this.kill());
    process.on('SIGINT', () => this.kill());
    process.on('SIGQUIT', () => this.kill());
  }
  
  /**
   * 创建一个服务:
   *  - 1. 创建agents子进程，用于辅助worker处理进程
   *  - 2. 创建workers进程，用于服务启动
   * @returns {Promise<void>}
   */
  async createServer() {
    if (this[config].socket) await this[createSocketServer]();
    if (this[config].agents && Array.isArray(this[config].agents) && this[config].agents.length) {
      // 开始fork全部子进程
      this[forkAgents]();
      // 等待子进程全部启动完毕
      await this[waitAgentsDone]();
    }
    // 开始启动所有worker集群子进程
    this[forkWorkers](this[config].max || os.cpus().length);
    // 等待服务进程启动完毕
    await this[waitWorksDone]();
    // 通知所有进程应用启动完毕
    this.send(['workers', 'agents'], 'cluster:ready');
  }
  
  /**
   * 杀掉所有进程
   * 查杀过程：
   *  - 1. 杀掉所有workers进程
   *  - 2. 杀掉所有agents进程
   * 顺序不能相反或者随机，一定要保证进程杀死顺序。
   */
  kill() {
    if (this[killing]) return;
    this[killing] = true;
    let step = 0;
    // 遍历查杀workers进程
    for (let i = 0; i < this.workers.length; i++) {
      const worker = this.workers[i];
      // 判定此进程没有死亡，则通过kill方法杀死
      if (!worker.isDead()) {
        // 指定杀死信号源：SIGTERM
        process.kill(worker.process.pid, 'SIGTERM');
      }
    }
    /**
     * 查杀循环判定
     * @type {number}
     */
    const timer = setInterval(() => {
      let workerCount = this.workers.length;
      let agentCount = Object.keys(this.agents).length;
      // 步骤一：杀死所有workers进程
      // step: 0
      if (step === 0) {
        for (let j = 0; j < this.workers.length; j++) {
          /**
           * status:
           *  - [-2]: 表示我们按了ctrl+c后的情况
           *  - [-1]: 表示在启动过程中出错时候处理出错的进程的情况
           *  - [+1]: 表示启动过程中出错时候处理正确启动继承的情况
           */
          if (this.workers[j].status === -2 || this.workers[j].status === -1 || this.workers[j].status === 1) {
            this.workers[j].status = -3;
            this.send(this.workers[j].process.pid, 'process:kill');
          } else if (this.workers[j].status === -4) {
            // status = -4 表示此进程我们已经处理完毕destroy生命周期
            workerCount--;
          } else { return }
        }

        if (workerCount === 0) {
          // 当我们全部处理完成workers进程后
          // 将step往后推
          step = 1;
        }
      } else if (step === 1) {
        // step:2 表示开始杀死agents进程
        step = 2;
        // 杀死信号源：SIGTERM
        for (const n in this.agents) this.agents[n].kill('SIGTERM');
      } else {
        // 权利杀死agents进程
        for (const i in this.agents) {
          if (this.agents[i].status === -2) {
            this.agents[i].status = -3;
            this.send(i, 'process:kill');
          } else if (this.agents[i].status === -4) {
            // status = -4 表示此进程我们已经处理完毕destroy生命周期
            agentCount--;
          } else { return; }
        }
        if (agentCount === 0) {
          clearInterval(timer);
          process.exit(0);
        }
      }
    }, 10);
  }
  
  /**
   * Agent状态变更函数
   * 同时发送固定的信号
   * @param action
   * @param status
   * @param msg
   * @param socket
   */
  [agentSendBack](action, status, msg, socket) {
    if (this.agents[msg.body.name]) {
      this.agents[msg.body.name].status = status;
      this.send(msg.body.name, action, null, socket);
    }
  }
  
  /**
   * worker状态变更函数
   * 同时发送固定的信号
   * @param action
   * @param status
   * @param msg
   * @param socket
   */
  [workerSendBack](action, status, msg, socket) {
    const workers = this.workers.slice(0);
    for (let i = 0; i < workers.length; i++) {
      if (msg.body.name === workers[i].process.pid) {
        workers[i].status = status;
        this.send(msg.body.name, action, null, socket);
        break;
      }
    }
  }
  
  /**
   * 查询匹配worker进程
   * 同时改变状态
   * @param msg
   * @param status
   */
  [workerDead](msg, status) {
    const workers = this.workers.slice(0);
    for (let i = 0, j = workers.length; i < j; i++) {
      if (msg.body.name === workers[i].process.pid) {
        workers[i].status = status;
        break;
      }
    }
  }
  
  /**
   * 消息接收函数
   * @param msg
   * @param socket
   */
  [onMessage](msg, socket) {
    switch (msg.action) {
      case 'start:info': return this[startInfo](msg.body.data);
      case 'shutdown': return this.kill();
      case 'agent:created': this[agentSendBack]('process:created', 1, msg, socket); break;
      case 'worker:created': this[workerSendBack]('process:created', 1, msg, socket); break;
      case 'agent:failed': this[agentSendBack]('process:failed', -1, msg, socket); break;
      case 'worker:failed': this[workerSendBack]('process:failed', -1, msg, socket); break;
      case 'agent:kill': this.agents[msg.body.name].status = -2; break;
      case 'worker:kill': this[workerDead](msg, -2); break;
      case 'agent:dead': this.agents[msg.body.name].status = -4; break;
      case 'worker:dead': this[workerDead](msg, -4);break;
      default: this.emit(msg.action, msg, socket);
    }
  }
  
  /**
   * 支持socket模式启动服务
   * @returns {Promise<void>}
   */
  async [createSocketServer]() {
    if (!this[config].port) this[config].port = 8080;
    this[socketServer] = net.createServer({ pauseOnConnect: true }, socket => {
      if (!socket.remoteAddress) return socket.close();
      const hash = stickyWorker(socket.remoteAddress.replace(/(\d+\.\d+\.\d+\.\d+)/, '$1'));
      const worker = this.workers[hash % this.workers.length];
      if (!worker) return;
      worker.send('sticky:balance', socket);
    });
    this[socketServer].listen(this[config].port);
    this[config].port = await checkPortCanUse();
  }
  
  /**
   * 开始创建agents进程
   */
  [forkAgents]() {
    for (let i = 0, j = this[config].agents.length; i < j; i++) {
      const agentName = this[config].agents[i];
      
      const opts = {
        cwd: this[config].cwd || process.cwd(),
        env: process.env,
        stdio: 'inherit',
        execArgv: process.execArgv.slice(0)
      };
      const args = [
        '--cwd=' + opts.cwd,
        '--name=' + agentName,
        '--port=' + this[config].port,
        '--env=' + opts.env.NODE_ENV,
        '--framework=' + this[config].framework,
        '--type=agent'
      ];
      if (this[config].debug) opts.execArgv.push(
        typeof this[config].debug === 'boolean'
          ? '--inspect'
          : '--' + this[config].debug
      );
      const agent = childProcess.fork(applicationFile, args, opts);
      agent.status = 0;
      this.register(agentName, agent);
    }
  }
  
  /**
   * 开始创建workers进程
   * @param n
   */
  [forkWorkers](n) {
    const args = [
      '--cwd=' + this[config].cwd,
      '--port=' + this[config].port,
      '--env=' + process.env.NODE_ENV,
      '--framework=' + this[config].framework,
      '--type=worker'
    ];
    const execArgv = process.execArgv.slice(0);
    if (this[config].debug) execArgv.push(
      typeof this[config].debug === 'boolean'
        ? '--inspect'
        : '--' + this[config].debug
    );
    cluster.setupMaster({
      exec: applicationFile,
      args,
      silent: false,
      env: process.env,
      execArgv
    });
    for (let i = 0; i < n; i++) cluster.fork();
    cluster
      .on('fork', worker => worker.status = 0)
      .on('exit', () => !this[killing] && cluster.fork());
  }
  
  /**
   * 等待agents进程全部结束
   * @returns {Promise<any>}
   */
  [waitAgentsDone]() {
    return new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        let pending = 0, error = 0;
        for (const i in this.agents) {
          switch (this.agents[i].status) {
            case 0: pending++; break;
            case -1: error++; break;
          }
        }
        if (pending) return;
        clearInterval(timer);
        if (error) return reject();
        resolve();
      }, 10);
    });
  }
  
  /**
   * 等待workers进程全部结束
   * @returns {Promise<any>}
   */
  [waitWorksDone]() {
    return new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        let pending = 0, error = 0;
        for (let i = 0; i < this.workers.length; i++) {
          switch (this.workers[i].status) {
            case 0: pending++; break;
            case -1: error++; break;
          }
        }
        if (pending) return;
        clearInterval(timer);
        if (error) return reject();
        resolve();
      }, 10);
    });
  }

  [startInfo](data) {
    if (this.isGettingStartInfo) return this.getStartInfoArray.push(data);
    this.isGettingStartInfo = true;
    this.getStartInfoArray = [];
    this.getStartInfoArray.push(data);
    const max = this[config].max || os.cpus().length;
    this.startInfoTimer = setInterval(() => {
      if (max === this.getStartInfoArray.length) {
        clearInterval(this.startInfoTimer);
        const table = cTable.getTable(this.getStartInfoArray);
        console.info(table);
        this.startInfoTimer = null;
      }
    }, 10);
  }
};