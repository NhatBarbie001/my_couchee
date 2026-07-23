const fs = require('fs');
const { xxhash64 } = require('xxhash-wasm');

let hasherInstance = null;

// Khởi tạo hasher một lần để tái sử dụng
async function initHasher() {
    if (!hasherInstance) {
        hasherInstance = await xxhash64();
    }
    return hasherInstance;
}

// Hash một chuỗi (ví dụ: URL)
async function hashString(input) {
    const hasher = await initHasher();
    const buffer = Buffer.from(input);
    const hash = hasher.hash(buffer, 0xC0FFEE); // seed tuỳ ý
    return hash.toString(16);
}

// Hash một file (buffer stream)
async function hashFile(path) {
    const hasher = await initHasher();
    return new Promise((resolve, reject) => {
        const hashState = hasher.create();
        const stream = fs.createReadStream(path);

        stream.on('data', chunk => hashState.update(chunk));
        stream.on('end', () => {
            const hash = hashState.digest();
            resolve(hash.toString(16));
        });
        stream.on('error', reject);
    });
}

module.exports = {
    hashString,
    hashFile,
};
