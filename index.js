// Railway 引导文件 - 启动 api-server
const { spawn } = require('child_process');
const path = require('path');

const apiServerDir = path.join(__dirname, 'artifacts', 'api-server');

console.log('🚀 Starting api-server from:', apiServerDir);

const child = spawn('pnpm', ['run', 'start'], {
  cwd: apiServerDir,
  stdio: 'inherit',
  shell: true
});

child.on('exit', (code) => {
  console.log(`api-server exited with code ${code}`);
  process.exit(code);
});
