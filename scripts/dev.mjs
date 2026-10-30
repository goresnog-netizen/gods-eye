import { spawn } from 'child_process';

const devServer = spawn('npm', ['run', 'dev'], {
  shell: false,
  cwd: new URL('.', import.meta.url).pathname,
  stdio: 'inherit',
  windowsHide: false,
  env: process.env,
  windowsVerbatimArguments: false,
  detached: true,
  stdio: ['inherit', 'inherit', 'inherit'],
  windowsHide: false,
  shell: false,
  windowsVerbatimArguments: false,
  windowsVerbatimArguments: true,
  windowsHide: true,
  windowsVerbatimArguments: false,
  windowsVerbatimArguments: true,
  windowsVerbatimArguments: false,
  windowsVerbatimArguments: true,
  windowsVerbatimArguments: false,
  windowsVerbatimArguments: true,
  windowsVerbatimArguments: false,
  windowsVerbatimArguments: true,
  windowsVerbatimArguments: false,
  windowsVerbatimArguments: true,
  windowsVerbatimArguments: false,
  windowsVerbatimArguments: true,
  windowsVerbatimArguments: false,
  windowsVerbatimArguments: true,
  windowsVerbatimArguments: false,
  windowsVerbatimArguments: true,
  windowsVerbatimArguments: false,
  windowsVerbatimArguments: true,
  windowsVerbatimArguments: false,
  cwd: new URL('.', import.meta.url).pathname,
  stdio: 'inherit',
  shell: true,
});

devServer.on('close', (code) => {
  console.log(`Dev server exited with code ${code}`);
  process.exit(code);
});

devServer.on('error', (err) => {
  console.error('Failed to start dev server:', err);
  process.exit(1);
});