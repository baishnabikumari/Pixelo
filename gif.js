const GIF_TRANSPARENT_INDEX = 0;
const GIF_MAX_COLORS = 255;

function colorKey(red, green, blue) {
    return (red << 16) | (green << 8) | blue;
}

function quantizeChannel(value, shift) {
    if (shift === 0) return value;
    return ((value >> shift) << shift) | (1 << (shift - 1));
}

function collectColorKeys(rgbaFrames, shift) {
    const keys = new Set();

    for (const rgba of rgbaFrames) {
        for (let i = 0; i < rgba.length; i += 4) {
            if (rgba[i + 3] < 128) continue;

            keys.add(
                colorKey(
                    quantizeChannel(rgba[i], shift),
                    quantizeChannel(rgba[i + 1], shift),
                    quantizeChannel(rgba[i + 2], shift)
                )
            );
            if (keys.size > GIF_MAX_COLORS) return keys;
        }
    }
    return keys;
}

function buildGifPalette(rgbaFrames) {
    let shift = 0;
    let keys = collectColorKeys(rgbaFrames, shift);

    while (keys.size > GIF_MAX_COLORS) {
        shift += 1;
        keys = collectColorKeys(rgbaFrames, shift);
    }

    const colors = [[0, 0, 0]];
    const indexByKey = new Map();
    for (const key of keys) {
        indexByKey.set(key, colors.length);
        colors.push([(key >> 16) & 255, (key >> 8) & 255, key & 255]);
    }
    return { colors, indexByKey, shift };
}

function frameToIndices(rgba, palette) {
    const indices = new Uint8Array(rgba.length / 4);

    for (let pixel = 0; pixel < indices.length; pixel++) {
        const i = pixel * 4;
        if (rgba[i + 3] < 128) {
            indices[pixel] = GIF_TRANSPARENT_INDEX;
            continue;
        }

        const key = colorKey(
            quantizeChannel(rgba[i], palette.shift),
            quantizeChannel(rgba[i + 1], palette.shift),
            quantizeChannel(rgba[i + 2], palette.shift)
        );
        indices[pixel] = palette.indexByKey.get(key);
    }
    return indices;
}

function lzwEncode(indices, minCodeSize) {
    const clearCode = 1 << minCodeSize;
    const endCode = clearCode + 1;

    const output = [];
    let bitBuffer = 0;
    let bitCount = 0;
    let codeSize = minCodeSize + 1;
    let nextCode = endCode + 1;
    let dictionary = new Map();

    function writeCode(code) {
        bitBuffer |= code << bitCount;
        bitCount += codeSize;
        while (bitCount >= 8) {
            output.push(bitBuffer & 255);
            bitBuffer >>>= 8;
            bitCount -= 8;
        }
    }

    writeCode(clearCode);

    let current = indices[0];
    for (let i = 1; i < indices.length; i++) {
        const next = indices[i];
        const key = (current << 8) | next;
        const knownCode = dictionary.get(key);

        if (knownCode !== undefined) {
            current = knownCode;
            continue;
        }

        writeCode(current);

        if (nextCode === 4096) {
            writeCode(clearCode);
            dictionary = new Map();
            codeSize = minCodeSize + 1;
            nextCode = endCode + 1;
        } else {
            if (nextCode >= 1 << codeSize) codeSize += 1;
            dictionary.set(key, nextCode);
            nextCode += 1;
        }
        current = next;
    }

    writeCode(current);
    writeCode(endCode);
    if (bitCount > 0) output.push(bitBuffer & 255);

    return output;
}

function encodeGif(rgbaFrames, width, height, delayCentiseconds) {
    const palette = buildGifPalette(rgbaFrames);

    let tableBits = 2;
    while (1 << tableBits < palette.colors.length) tableBits += 1;
    const tableSize = 1 << tableBits;

    const bytes = [];
    const pushText = (text) => {
        for (let i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i));
    };
    const pushWord = (value) => bytes.push(value & 255, (value >> 8) & 255);

    pushText("GIF89a");

    pushWord(width);
    pushWord(height);
    bytes.push(0x80 | 0x70 | (tableBits - 1), 0, 0);

    for (let i = 0; i < tableSize; i++) {
        const color = palette.colors[i] || [0, 0, 0];
        bytes.push(color[0], color[1], color[2]);
    }

    bytes.push(0x21, 0xff, 0x0b);
    pushText("NETSCAPE2.0");
    bytes.push(0x03, 0x01, 0x00, 0x00, 0x00);

    for (const rgba of rgbaFrames) {
        bytes.push(0x21, 0xf9, 0x04, (2 << 2) | 1);
        pushWord(delayCentiseconds);
        bytes.push(GIF_TRANSPARENT_INDEX, 0x00);

        bytes.push(0x2c);
        pushWord(0);
        pushWord(0);
        pushWord(width);
        pushWord(height);
        bytes.push(0x00);

        bytes.push(tableBits);
        const compressed = lzwEncode(frameToIndices(rgba, palette), tableBits);

        for (let start = 0; start < compressed.length; start += 255) {
            const chunk = compressed.slice(start, start + 255);
            bytes.push(chunk.length, ...chunk);
        }
        bytes.push(0x00);
    }

    bytes.push(0x3b);
    return new Uint8Array(bytes);
}

function lzwDecode(data, minCodeSize, pixelCount) {
    const clearCode = 1 << minCodeSize;
    const endCode = clearCode + 1;

    const prefixes = new Uint16Array(4096);
    const suffixes = new Uint8Array(4096);
    const stack = new Uint8Array(4097);
    const pixels = new Uint8Array(pixelCount);

    for (let code = 0; code < clearCode; code++) suffixes[code] = code;

    let codeSize = minCodeSize + 1;
    let nextCode = endCode + 1;
    let previousCode = -1;
    let firstChar = 0;
    let bitBuffer = 0;
    let bitCount = 0;
    let position = 0;
    let written = 0;

    while (written < pixelCount) {
        while (bitCount < codeSize) {
            if (position >= data.length) return pixels;
            bitBuffer |= data[position++] << bitCount;
            bitCount += 8;
        }

        let code = bitBuffer & ((1 << codeSize) - 1);
        bitBuffer >>>= codeSize;
        bitCount -= codeSize;

        if (code === clearCode) {
            codeSize = minCodeSize + 1;
            nextCode = endCode + 1;
            previousCode = -1;
            continue;
        }
        if (code === endCode) break;

        if (previousCode === -1) {
            firstChar = suffixes[code];
            pixels[written++] = firstChar;
            previousCode = code;
            continue;
        }

        if (code > nextCode) break;

        const incomingCode = code;
        let top = 0;
        if (code === nextCode) {
            stack[top++] = firstChar;
            code = previousCode;
        }
        while (code >= clearCode) {
            stack[top++] = suffixes[code];
            code = prefixes[code];
        }
        firstChar = suffixes[code];
        stack[top++] = firstChar;

        while (top > 0 && written < pixelCount) pixels[written++] = stack[--top];

        if (nextCode < 4096) {
            prefixes[nextCode] = previousCode;
            suffixes[nextCode] = firstChar;
            nextCode += 1;
            if (nextCode === 1 << codeSize && codeSize < 12) codeSize += 1;
        }
        previousCode = incomingCode;
    }

    return pixels;
}

function interlacedRowOrder(height) {
    const order = [];
    const passes = [[0, 8], [4, 8], [2, 4], [1, 2]];

    for (const [start, step] of passes) {
        for (let row = start; row < height; row += step) order.push(row);
    }
    return order;
}

function decodeGif(bytes) {
    const signature = String.fromCharCode(...bytes.slice(0, 6));
    if (signature !== "GIF87a" && signature !== "GIF89a") {
        throw new Error("not a gif file");
    }

    let position = 6;
    const readByte = () => bytes[position++];
    const readWord = () => {
        const value = bytes[position] | (bytes[position + 1] << 8);
        position += 2;
        return value;
    };
    const readColorTable = (colorCount) => {
        const table = bytes.subarray(position, position + colorCount * 3);
        position += colorCount * 3;
        return table;
    };
    const skipSubBlocks = () => {
        let size = readByte();
        while (size) {
            position += size;
            size = readByte();
        }
    };
    const readSubBlocks = () => {
        const chunks = [];
        let total = 0;
        let size = readByte();
        while (size) {
            chunks.push(bytes.subarray(position, position + size));
            total += size;
            position += size;
            size = readByte();
        }

        const joined = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            joined.set(chunk, offset);
            offset += chunk.length;
        }
        return joined;
    };

    const width = readWord();
    const height = readWord();
    const screenFlags = readByte();
    position += 2;

    let globalTable = null;
    if (screenFlags & 0x80) {
        globalTable = readColorTable(1 << ((screenFlags & 7) + 1));
    }

    const decodedFrames = [];
    const screen = new Uint8ClampedArray(width * height * 4);
    let control = null;
    let pendingDisposal = null;

    while (position < bytes.length) {
        const blockType = readByte();
        if (blockType === 0x3b) break;

        if (blockType === 0x21) {
            const label = readByte();
            if (label === 0xf9) {
                position += 1;
                const flags = readByte();
                const delay = readWord();
                const transparentIndex = readByte();
                position += 1;
                control = {
                    disposal: (flags >> 2) & 7,
                    hasTransparency: (flags & 1) === 1,
                    transparentIndex,
                    delay,
                };
            } else {
                skipSubBlocks();
            }
            continue;
        }

        if (blockType !== 0x2c) throw new Error("unexpected block in gif file");

        const left = readWord();
        const top = readWord();
        const frameWidth = readWord();
        const frameHeight = readWord();
        const flags = readByte();

        let table = globalTable;
        if (flags & 0x80) table = readColorTable(1 << ((flags & 7) + 1));
        if (!table) throw new Error("gif has no color table");

        const isInterlaced = (flags & 0x40) !== 0;
        const minCodeSize = readByte();
        const compressed = readSubBlocks();

        if (pendingDisposal) {
            if (pendingDisposal.method === 2) {
                for (let row = 0; row < pendingDisposal.height; row++) {
                    const y = pendingDisposal.top + row;
                    if (y >= height) continue;
                    for (let col = 0; col < pendingDisposal.width; col++) {
                        const x = pendingDisposal.left + col;
                        if (x >= width) continue;
                        const offset = (y * width + x) * 4;
                        screen[offset] = 0;
                        screen[offset + 1] = 0;
                        screen[offset + 2] = 0;
                        screen[offset + 3] = 0;
                    }
                }
            } else if (pendingDisposal.method === 3 && pendingDisposal.saved) {
                screen.set(pendingDisposal.saved);
            }
            pendingDisposal = null;
        }

        const savedScreen = control && control.disposal === 3 ? screen.slice() : null;

        const indices = lzwDecode(compressed, minCodeSize, frameWidth * frameHeight);
        const rowOrder = isInterlaced ? interlacedRowOrder(frameHeight) : null;

        for (let row = 0; row < frameHeight; row++) {
            const y = top + (rowOrder ? rowOrder[row] : row);
            if (y >= height) continue;

            for (let col = 0; col < frameWidth; col++) {
                const x = left + col;
                if (x >= width) continue;

                const index = indices[row * frameWidth + col];
                if (control && control.hasTransparency && index === control.transparentIndex) continue;

                const offset = (y * width + x) * 4;
                screen[offset] = table[index * 3];
                screen[offset + 1] = table[index * 3 + 1];
                screen[offset + 2] = table[index * 3 + 2];
                screen[offset + 3] = 255;
            }
        }

        decodedFrames.push({
            rgba: screen.slice(),
            delayCentiseconds: control ? control.delay : 0,
        });

        pendingDisposal = control
            ? { method: control.disposal, left, top, width: frameWidth, height: frameHeight, saved: savedScreen }
            : null;
        control = null;
    }

    return { width, height, frames: decodedFrames };
}