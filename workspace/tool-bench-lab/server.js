const http = require('http');
const fs = require('fs');
const path = require('path');

http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  const file = path.join(process.cwd(), pathname === '/' ? 'index.html' : pathname);
  fs.readFile(file, (error, data) => {
    res.writeHead(error ? 404 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(error ? 'Not found' : data);
  });
}).listen(8877, '127.0.0.1', () => console.log('tool bench ready on 8877'));
