# @clusic/cluster

集群启动模块

## Install

```shell
npm i @clusic/cluster
```

## Usage

```javascript
const path = require('path');
const master = require('@clusic/cluster');
const app = new master({
  cwd: __dirname,
  env: 'dev',
  agents: ['agent', 'test', 'abc'],
  framework: path.resolve(__dirname, 'framework'),
  // max: 2
});
app.createServer().catch(e => app.kill());
```

**Arguments:**

```javascript
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
```

## Framework

框架原型

```javascript
module.exports = class Application {
  constructor(app, data) {
    this.data = data;
    this.app = app;
  }
  // 进程创建周期
  async processCreate() {
    await new Promise((resolve, reject) => {
      setTimeout(() => {
        console.log('worker processWillCreate', Date.now());
        // if (process.pid % 2 === 0) {
        //   return reject(new Error('test error'))
        // }
        resolve();
      }, 2000);
    });
  }
  // 消息接收函数
  processMessage(msg, socket) {
    if (msg.action === 'cluster:ready') {
      console.log('all ready in worker ' + process.pid);
    }
    // console.log('message', msg);
  }
  //进程销毁周期
  async processDestroy() {
    await new Promise((resolve, reject) => {
      setTimeout(() => {
        console.log('worker processDestroy', Date.now());
        resolve();
      }, 2000);
    });
  }
};
```