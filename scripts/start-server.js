'use strict';

// Free port 8000 if a previous server is still listening, then serve src.

const { execFileSync, spawn } = require('child_process');
const path = require('path');
const { inlineStandalone } = require('./inline-standalone');

const PORT = 8000;
const HOST = '127.0.0.1';

function listeningPids(port) {
    let output = '';
    try {
        output = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
    } catch (err) {
        console.error(err.message);
        return [];
    }
    const pids = new Set();
    for (const line of output.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5 || parts[0] !== 'TCP' || parts[3] !== 'LISTENING') {
            continue;
        }
        const match = parts[1].match(/:(\d+)$/);
        if (!match || match[1] !== String(port)) {
            continue;
        }
        if (/^\d+$/.test(parts[4]) && parts[4] !== '0') {
            pids.add(parts[4]);
        }
    }
    return Array.from(pids);
}

function stopListener(pid) {
    if (process.platform === 'win32') {
        execFileSync('taskkill', ['/PID', pid, '/F'], { stdio: 'inherit' });
        return;
    }
    process.kill(Number(pid), 'SIGTERM');
}

const pids = listeningPids(PORT).filter(function (pid) {
    return pid !== String(process.pid);
});
if (pids.length > 0) {
    for (let i = 0; i < pids.length; i++) {
        console.log('Stopping process ' + pids[i] + ' listening on port ' + PORT + '.');
        stopListener(pids[i]);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
}

inlineStandalone(path.join(__dirname, '..'));
console.log('Serving src at http://' + HOST + ':' + PORT + '/');
const child = spawn(
    'python',
    ['-m', 'http.server', String(PORT), '--bind', HOST],
    {
        cwd: path.join(__dirname, '..', 'src'),
        stdio: 'inherit',
        shell: process.platform === 'win32'
    }
);

child.on('error', function (err) {
    console.error(err.message);
    process.exit(1);
});
child.on('exit', function (code) {
    process.exit(code == null ? 1 : code);
});

function stopChild() {
    if (!child.killed) {
        child.kill();
    }
}
process.on('SIGINT', stopChild);
process.on('SIGTERM', stopChild);
