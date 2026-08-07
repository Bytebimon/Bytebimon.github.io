const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

function getContentType(filePath) {
    const extname = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.htm': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.map': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.wav': 'audio/wav',
        '.mp3': 'audio/mpeg',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.txt': 'text/plain; charset=utf-8',
        '.xml': 'application/xml; charset=utf-8',
        '.pdf': 'application/pdf',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.otf': 'font/otf',
        '.wasm': 'application/wasm',
        '.exe': 'application/x-msdownload',
        '.dll': 'application/octet-stream',
        '.bat': 'application/x-msdownload',
        '.cmd': 'application/x-msdownload',
        '.msi': 'application/octet-stream',
        '.zip': 'application/zip',
        '.apk': 'application/vnd.android.package-archive'
    };

    return mimeTypes[extname] || 'application/octet-stream';
}

function getResponseHeaders(filePath) {
    const contentType = getContentType(filePath);
    const headers = {
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff'
    };

    const downloadExtensions = new Set(['.exe', '.dll', '.bat', '.cmd', '.msi', '.zip', '.apk']);
    if (downloadExtensions.has(path.extname(filePath).toLowerCase())) {
        headers['Content-Disposition'] = 'attachment';
    }

    return headers;
}

// Create HTTP server to serve static files and handle API requests
const server = http.createServer((req, res) => {
    // API endpoint for packaging a folder
    if (req.url === '/api/package' && req.method === 'POST') {
        let body = [];
        req.on('data', chunk => {
            body.push(chunk);
        });
        req.on('end', () => {
            const buffer = Buffer.concat(body);
            try {
                const data = JSON.parse(buffer.toString('utf-8'));
                handlePackageRequest(req, res, data);
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Invalid JSON payload: ' + err.message);
            }
        });
        return;
    }

    // Serve static files
    let filePath = path.join(__dirname, req.url);
    if (req.url === '/') filePath = path.join(__dirname, 'index.html');

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('File not found');
        } else {
            res.writeHead(200, getResponseHeaders(filePath));
            res.end(content);
        }
    });
});

// Simple WebSocket upgrade handling
const clients = new Set();
server.on('upgrade', (req, socket) => {
    if (req.headers['upgrade'] !== 'websocket') {
        socket.destroy();
        return;
    }
    
    // Perform handshake
    const key = req.headers['sec-websocket-key'];
    const hash = crypto.createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5ABDC25D7B5')
        .digest('base64');
        
    socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${hash}\r\n\r\n`
    );
    
    clients.add(socket);
    console.log(`Player connected. Total players: ${clients.size}`);
    
    // Read WebSocket frames
    socket.on('data', (buf) => {
        // Parse simple text frame
        const firstByte = buf[0];
        const opCode = firstByte & 0x0F;
        if (opCode === 8) { // Close connection
            clients.delete(socket);
            socket.destroy();
            console.log(`Player disconnected. Total players: ${clients.size}`);
            return;
        }
        
        if (opCode === 1) { // Text frame
            const secondByte = buf[1];
            const isMasked = (secondByte & 0x80) !== 0;
            let payloadLen = secondByte & 0x7F;
            let dataOffset = 2;
            
            if (payloadLen === 126) {
                payloadLen = buf.readUInt16BE(2);
                dataOffset = 4;
            } else if (payloadLen === 127) {
                return;
            }
            
            let maskingKey;
            if (isMasked) {
                maskingKey = buf.slice(dataOffset, dataOffset + 4);
                dataOffset += 4;
            }
            
            const payload = buf.slice(dataOffset, dataOffset + payloadLen);
            if (isMasked) {
                for (let i = 0; i < payload.length; i++) {
                    payload[i] ^= maskingKey[i % 4];
                }
            }
            
            const message = payload.toString('utf-8');
            // Broadcast message to all other connected clients
            for (const client of clients) {
                if (client !== socket) {
                    sendFrame(client, message);
                }
            }
        }
    });
    
    socket.on('close', () => {
        clients.delete(socket);
        console.log(`Player disconnected. Total players: ${clients.size}`);
    });
    socket.on('error', () => {
        clients.delete(socket);
    });
});

function sendFrame(socket, message) {
    const payload = Buffer.from(message, 'utf-8');
    const len = payload.length;
    let header;
    if (len < 126) {
        header = Buffer.alloc(2);
        header[0] = 0x81; // Text frame, FIN bit set
        header[1] = len;
    } else {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
    }
    try {
        socket.write(Buffer.concat([header, payload]));
    } catch (e) {
        clients.delete(socket);
    }
}

// Package Custom Folder Request Handler
function handlePackageRequest(req, res, data) {
    res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    const tempId = crypto.randomBytes(8).toString('hex');
    const tempDir = path.join(__dirname, 'temp_builds', tempId);

    try {
        res.write("STEP: Creating temporary build environment...\n");
        fs.mkdirSync(tempDir, { recursive: true });

        res.write(`STEP: Writing ${data.files.length} project files...\n`);
        data.files.forEach(file => {
            const filePath = path.join(tempDir, file.path);
            const dirPath = path.dirname(filePath);
            fs.mkdirSync(dirPath, { recursive: true });
            fs.writeFileSync(filePath, Buffer.from(file.content, 'base64'));
        });

        res.write("STEP: Writing application launcher...\n");
        const isHtml = data.entryFile.endsWith('.html');
        let launcherContent = '';

        if (isHtml) {
            launcherContent = `
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const server = http.createServer((req, res) => {
    let filePath = path.join(__dirname, req.url);
    if (req.url === '/') filePath = path.join(__dirname, '${data.entryFile.replace(/\\/g, '/')}');

    const extname = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.htm': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.map': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.wav': 'audio/wav',
        '.mp3': 'audio/mpeg',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.txt': 'text/plain; charset=utf-8',
        '.xml': 'application/xml; charset=utf-8',
        '.pdf': 'application/pdf',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.otf': 'font/otf',
        '.wasm': 'application/wasm',
        '.exe': 'application/x-msdownload',
        '.dll': 'application/octet-stream',
        '.bat': 'application/x-msdownload',
        '.cmd': 'application/x-msdownload',
        '.msi': 'application/octet-stream',
        '.zip': 'application/zip',
        '.apk': 'application/vnd.android.package-archive'
    };
    const contentType = mimeTypes[extname] || 'application/octet-stream';
    const headers = { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff' };
    if (['.exe', '.dll', '.bat', '.cmd', '.msi', '.zip', '.apk'].includes(extname)) {
        headers['Content-Disposition'] = 'attachment';
    }

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('File not found');
        } else {
            res.writeHead(200, headers);
            res.end(content);
        }
    });
});

const serverListener = server.listen(0, '127.0.0.1', () => {
    const port = serverListener.address().port;
    const url = 'http://127.0.0.1:' + port + '/';
    console.log('App running at ' + url);
    const startCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    exec(startCmd + ' ' + url);
});
`;
        } else {
            launcherContent = `require('./${data.entryFile.replace(/\\/g, '/')}');`;
        }
        
        fs.writeFileSync(path.join(tempDir, 'launcher.js'), launcherContent);

        res.write("STEP: Writing package manifest...\n");
        const packageJson = {
            name: data.appName.toLowerCase().replace(/[^a-z0-9-_]/g, ''),
            version: '1.0.0',
            bin: 'launcher.js',
            pkg: {
                assets: ['**/*']
            }
        };
        fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(packageJson, null, 2));

        res.write("STEP: Running compiler engine (npx pkg). This may take a moment...\n");
        const distDir = path.join(__dirname, 'dist');
        fs.mkdirSync(distDir, { recursive: true });

        const targets = [];
        if (data.targets.win) targets.push('node18-win-x64');
        if (data.targets.mac) targets.push('node18-macos-x64');
        const targetArg = targets.join(',');

        const pkgCmd = `npx --yes pkg . --targets ${targetArg} --out-path "${distDir}"`;
        
        const child = exec(pkgCmd, { cwd: tempDir, env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: "0" } });
        
        child.stdout.on('data', chunk => {
            res.write(chunk.toString());
        });

        child.stderr.on('data', chunk => {
            res.write(chunk.toString());
        });

        child.on('close', code => {
            // Clean up temp environment
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (err) {
                res.write("WARN: Could not clean up temporary build folder: " + err.message + "\n");
            }

            if (code === 0) {
                res.write("SUCCESS: Application compiled successfully!\n");
                res.write(`SUCCESS: Executables are located in your "dist" folder.\n`);
                
                // Automatically open the dist folder
                try {
                    const openCmd = process.platform === 'win32' ? 'explorer' : 'open';
                    exec(`${openCmd} "${distDir}"`);
                } catch(e) {}
                res.end();
            } else {
                res.write(`ERROR: Compiler exited with code ${code}.\n`);
                res.end();
            }
        });

    } catch (error) {
        res.write(`ERROR: Exception occurred: ${error.message}\n`);
        // Clean up temp environment
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (err) {}
        res.end();
    }
}

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running at http://localhost:${PORT}/`);
    console.log(`To open the packager, go to http://localhost:${PORT}/packager.html`);
});
