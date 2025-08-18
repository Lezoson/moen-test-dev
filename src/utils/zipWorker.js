const { parentPort, workerData } = require('worker_threads');
const archiver = require('archiver');
const fs = require('fs');
const { PassThrough } = require('stream');

try {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const pass = new PassThrough();
  const chunks = [];

  pass.on('data', chunk => {
    chunks.push(chunk);
  });

  pass.on('end', () => {
    const buffer = Buffer.concat(chunks);
    parentPort.postMessage(buffer);
  });

  archive.on('error', err => {
    parentPort.postMessage({ error: err.message });
  });

  archive.pipe(pass);

  // Add files to the archive
  workerData.forEach(({ path, name }) => {
    archive.file(path, { name });
  });

  archive.finalize();
} catch (error) {
  parentPort.postMessage({ error: error.message });
}
