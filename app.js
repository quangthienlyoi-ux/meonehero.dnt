/* ============================================================
   UTMTweb.js — Undertale Mod Tool Web Edition
   8 SECTION • Không thư viện ngoài • 1 IIFE duy nhất
   ============================================================ */
window.UTMT = (function () {
    'use strict';

    /* --------------------------------------------------------
       SECTION 1: UTILS
       -------------------------------------------------------- */
    const Utils = {
        readString(view, off, len) {
            let s = '';
            for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(off + i));
            return s;
        },
        formatBytes(b) {
            if (b < 1024) return b + ' B';
            if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
            return (b / 1048576).toFixed(2) + ' MB';
        },
        dosDateTime() {
            const d = new Date();
            return {
                time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
                date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
            };
        }
    };

    /* --------------------------------------------------------
       SECTION 2: BINARY READER
       -------------------------------------------------------- */
    class BinaryReader {
        constructor(buffer) {
            this.buffer = buffer;
            this.bytes = new Uint8Array(buffer);
            this.view = new DataView(buffer);
            this.offset = 0;
        }
        get length()    { return this.bytes.length; }
        get remaining() { return this.length - this.offset; }
        seek(p) { this.offset = p; return this; }
        skip(n) { this.offset += n; return this; }
        readBytes(n) {
            const b = this.bytes.slice(this.offset, this.offset + n);
            this.offset += n;
            return b;
        }
        readU8()  { return this.view.getUint8(this.offset++); }
        readU16() { const v = this.view.getUint16(this.offset, true); this.offset += 2; return v; }
        readU32() { const v = this.view.getUint32(this.offset, true); this.offset += 4; return v; }
        readTag() {
            const b = this.readBytes(4);
            return String.fromCharCode(b[0], b[1], b[2], b[3]);
        }
        readCString() {
            let s = '';
            while (this.offset < this.length) {
                const b = this.bytes[this.offset++];
                if (b === 0) break;
                s += String.fromCharCode(b);
            }
            return s;
        }
    }

    /* --------------------------------------------------------
       SECTION 3: IFF PARSER
       -------------------------------------------------------- */
    const IFF = {
        parse(buffer) {
            const r = new BinaryReader(buffer);
            const form = r.readTag();
            const fileSize = r.readU32();
            const result = { form, fileSize, chunks: [], version: null };

            while (r.remaining >= 8) {
                const tag = r.readTag();
                const size = r.readU32();
                if (r.remaining < size) break;
                const dataStart = r.offset;
                const data = r.readBytes(size);

                if (tag === 'GEN8') {
                    try {
                        const g = new BinaryReader(data);
                        const v = [g.readU8(), g.readU8(), g.readU8(), g.readU8()];
                        result.version = { bytes: v, str: v.join('.') };
                    } catch (_) {}
                }
                result.chunks.push({ tag, size, offset: dataStart, data });
            }
            return result;
        }
    };

    /* --------------------------------------------------------
       SECTION 4: CHUNK PARSERS
       -------------------------------------------------------- */
    const Chunks = {
        TXTR: {
            SIG:  [0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A],
            IEND: [0x00,0x00,0x00,0x00,0x49,0x45,0x4E,0x44,0xAE,0x42,0x60,0x82],
            extract(data) {
                const out = [], b = new Uint8Array(data);
                let i = 0;
                while (i < b.length - 8) {
                    let hit = true;
                    for (let j = 0; j < 8; j++) if (b[i+j] !== this.SIG[j]) { hit = false; break; }
                    if (hit) {
                        let end = i + 8;
                        while (end < b.length - 12) {
                            let e = true;
                            for (let k = 0; k < 12; k++) if (b[end+k] !== this.IEND[k]) { e = false; break; }
                            if (e) break;
                            end++;
                        }
                        if (end < b.length - 12) {
                            out.push(b.slice(i, end + 12));
                            i = end + 12;
                            continue;
                        }
                    }
                    i++;
                }
                return out;
            }
        },
        AUDO: {
            extract(data) {
                const out = [], b = new Uint8Array(data);
                for (let i = 0; i < b.length - 12; i++) {
                    // WAV: "RIFF" .. "WAVE"
                    if (b[i]===0x52 && b[i+1]===0x49 && b[i+2]===0x46 && b[i+3]===0x46 &&
                        b[i+8]===0x57 && b[i+9]===0x41 && b[i+10]===0x56 && b[i+11]===0x45) {
                        const sz = new DataView(b.buffer, b.byteOffset + i).getUint32(4, true) + 8;
                        if (i + sz <= b.length) {
                            out.push({ format: 'wav', data: b.slice(i, i + sz) });
                            i += sz - 1;
                            continue;
                        }
                    }
                    // OGG
                    if (b[i]===0x4F && b[i+1]===0x67 && b[i+2]===0x67 && b[i+3]===0x53) {
                        out.push({ format: 'ogg', data: b.slice(i) });
                        return out;
                    }
                    // MP3 ID3
                    if (b[i]===0x49 && b[i+1]===0x44 && b[i+2]===0x33) {
                        out.push({ format: 'mp3', data: b.slice(i) });
                        return out;
                    }
                }
                return out;
            }
        },
        STRG: {
            extract(data) {
                const list = [];
                try {
                    const r = new BinaryReader(data);
                    const n = r.readU32();
                    const offs = [];
                    for (let i = 0; i < n; i++) offs.push(r.readU32());
                    const base = r.offset;
                    for (const o of offs) {
                        r.seek(base + o);
                        const s = r.readCString();
                        if (s) list.push(s);
                    }
                } catch (_) { /* fallback không cần */ }
                return list;
            }
        },
        CODE: {
            extract(data) {
                // Bytecode GML — chỉ trích strings đọc được
                const strings = [], b = new Uint8Array(data);
                let cur = '';
                for (const x of b) {
                    if (x >= 32 && x < 127) cur += String.fromCharCode(x);
                    else { if (cur.length >= 6) strings.push(cur); cur = ''; }
                }
                return { raw: data, strings };
            }
        }
    };

    /* --------------------------------------------------------
       SECTION 5: ZIP WRITER (Store, không nén)
       -------------------------------------------------------- */
    class ZipWriter {
        constructor() {
            this.entries = [];
            this.crcTable = ZipWriter._table();
        }
        static _table() {
            const t = new Uint32Array(256);
            for (let i = 0; i < 256; i++) {
                let c = i;
                for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                t[i] = c >>> 0;
            }
            return t;
        }
        _crc(data) {
            let c = 0xFFFFFFFF;
            for (let i = 0; i < data.length; i++) c = (c >>> 8) ^ this.crcTable[(c ^ data[i]) & 0xFF];
            return (c ^ 0xFFFFFFFF) >>> 0;
        }
        add(name, data) {
            if (typeof data === 'string') data = new TextEncoder().encode(data);
            if (!(data instanceof Uint8Array)) data = new Uint8Array(data);
            this.entries.push({ name, data, crc: this._crc(data) });
        }
        build() {
            const enc = new TextEncoder();
            const { time, date } = Utils.dosDateTime();
            const parts = [], central = [];
            let offset = 0;

            for (const e of this.entries) {
                const nb = enc.encode(e.name);
                const lf = new Uint8Array(30 + nb.length);
                const dv = new DataView(lf.buffer);
                dv.setUint32(0,  0x04034b50, true);
                dv.setUint16(4,  20, true);
                dv.setUint16(6,  0x0800, true);   // UTF-8
                dv.setUint16(8,  0, true);        // Store
                dv.setUint16(10, time, true);
                dv.setUint16(12, date, true);
                dv.setUint32(14, e.crc, true);
                dv.setUint32(18, e.data.length, true);
                dv.setUint32(22, e.data.length, true);
                dv.setUint16(26, nb.length, true);
                dv.setUint16(28, 0, true);
                lf.set(nb, 30);
                parts.push(lf, e.data);

                const cd = new Uint8Array(46 + nb.length);
                const cv = new DataView(cd.buffer);
                cv.setUint32(0,  0x02014b50, true);
                cv.setUint16(4,  20, true);
                cv.setUint16(6,  20, true);
                cv.setUint16(8,  0x0800, true);
                cv.setUint16(10, 0, true);
                cv.setUint16(12, time, true);
                cv.setUint16(14, date, true);
                cv.setUint32(16, e.crc, true);
                cv.setUint32(20, e.data.length, true);
                cv.setUint32(24, e.data.length, true);
                cv.setUint16(28, nb.length, true);
                cv.setUint16(30, 0, true);
                cv.setUint16(32, 0, true);
                cv.setUint16(34, 0, true);
                cv.setUint16(36, 0, true);
                cv.setUint32(38, 0, true);
                cv.setUint32(42, offset, true);
                cd.set(nb, 46);
                central.push(cd);
                offset += lf.length + e.data.length;
            }

            const cdStart = offset;
            let cdSize = 0;
            for (const c of central) { parts.push(c); cdSize += c.length; }

            const eocd = new Uint8Array(22);
            const ev = new DataView(eocd.buffer);
            ev.setUint32(0,  0x06054b50, true);
            ev.setUint16(8,  this.entries.length, true);
            ev.setUint16(10, this.entries.length, true);
            ev.setUint32(12, cdSize, true);
            ev.setUint32(16, cdStart, true);
            parts.push(eocd);

            const total = parts.reduce((s, p) => s + p.length, 0);
            const out = new Uint8Array(total);
            let pos = 0;
            for (const p of parts) { out.set(p, pos); pos += p.length; }
            return new Blob([out], { type: 'application/zip' });
        }
    }

    /* --------------------------------------------------------
       SECTION 6: STATE
       -------------------------------------------------------- */
    const State = {
        parsed: null, sprites: [], audios: [], strings: [], codes: [], fileName: ''
    };

    /* --------------------------------------------------------
       SECTION 7: UI CONTROLLER
       -------------------------------------------------------- */
    const UI = {
        els: {},
        init() {
            this.els = {
                fileInput:  document.getElementById('fileInput'),
                dropZone:   document.getElementById('dropZone'),
                fileInfo:   document.getElementById('fileInfo'),
                chunkList:  document.getElementById('chunkList'),
                log:        document.getElementById('log'),
                counts:     document.getElementById('counts'),
                btnSprites: document.getElementById('btnSprites'),
                btnAudio:   document.getElementById('btnAudio'),
                btnStrings: document.getElementById('btnStrings'),
                btnCode:    document.getElementById('btnCode'),
                btnZipS:    document.getElementById('btnZipSprites'),
                btnZipA:    document.getElementById('btnZipAudio'),
                btnZipAll:  document.getElementById('btnZipAll')
            };
            this.els.fileInput.onchange = e => e.target.files[0] && this.loadFile(e.target.files[0]);

            const dz = this.els.dropZone;
            dz.ondragover = e => { e.preventDefault(); dz.classList.add('hover'); };
            dz.ondragleave = () => dz.classList.remove('hover');
            dz.ondrop = e => {
                e.preventDefault(); dz.classList.remove('hover');
                if (e.dataTransfer.files[0]) this.loadFile(e.dataTransfer.files[0]);
            };

            this.els.btnSprites.onclick = () => this.exportSprites();
            this.els.btnAudio.onclick   = () => this.exportAudios();
            this.els.btnStrings.onclick = () => this.exportStrings();
            this.els.btnCode.onclick    = () => this.exportCodes();
            this.els.btnZipS.onclick    = () => this.zipSprites();
            this.els.btnZipA.onclick    = () => this.zipAudios();
            this.els.btnZipAll.onclick  = () => this.zipAll();

            this.log('Sẵn sàng.', 'info');
        },

        log(msg, type = 'info') {
            const l = this.els.log;
            const d = document.createElement('div');
            d.className = 'log-' + type;
            d.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
            l.appendChild(d);
            l.scrollTop = l.scrollHeight;
        },

        async loadFile(file) {
            State.fileName = file.name.replace(/\.(win|droid)$/i, '');
            this.log(`Đọc ${file.name} (${Utils.formatBytes(file.size)})`, 'info');
            try {
                const buf = await file.arrayBuffer();
                State.parsed = IFF.parse(buf);

                this.log(`FORM OK, GEN8 = ${State.parsed.version ? State.parsed.version.str : '?'}`, 'ok');
                this.els.fileInfo.innerHTML =
                    `<b>${file.name}</b> — ${Utils.formatBytes(file.size)} — ` +
                    `version ${State.parsed.version ? State.parsed.version.str : 'N/A'} — ` +
                    `${State.parsed.chunks.length} chunk`;

                this.els.chunkList.innerHTML = State.parsed.chunks
                    .map(c => `<span class="chunk-item">${c.tag} · ${Utils.formatBytes(c.size)}</span>`)
                    .join('');

                this.extractAll();
            } catch (e) {
                this.log('Lỗi: ' + e.message, 'err');
                console.error(e);
            }
        },

        extractAll() {
            State.sprites = []; State.audios = []; State.strings = []; State.codes = [];
            for (const c of State.parsed.chunks) {
                try {
                    if (c.tag === 'TXTR') { const r = Chunks.TXTR.extract(c.data); State.sprites.push(...r); this.log(`TXTR: ${r.length} PNG`, 'ok'); }
                    else if (c.tag === 'AUDO') { const r = Chunks.AUDO.extract(c.data); State.audios.push(...r); this.log(`AUDO: ${r.length} file`, 'ok'); }
                    else if (c.tag === 'STRG') { const r = Chunks.STRG.extract(c.data); State.strings.push(...r); this.log(`STRG: ${r.length} string`, 'ok'); }
                    else if (c.tag === 'CODE') { const r = Chunks.CODE.extract(c.data); State.codes.push(r); this.log(`CODE: ${r.strings.length} strings`, 'ok'); }
                } catch (e) { this.log(`Chunk ${c.tag}: ${e.message}`, 'err'); }
            }
            this.els.counts.innerHTML =
                `Sprites <b>${State.sprites.length}</b> · ` +
                `Audio <b>${State.audios.length}</b> · ` +
                `Strings <b>${State.strings.length}</b> · ` +
                `Code chunks <b>${State.codes.length}</b>`;
        },

        download(name, blob) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = name;
            document.body.appendChild(a);
            a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1500);
        },

        exportSprites() {
            State.sprites.forEach((d, i) =>
                setTimeout(() => this.download(`${State.fileName}_sprite_${i}.png`,
                    new Blob([d], { type: 'image/png' })), i * 80));
        },
        exportAudios() {
            State.audios.forEach((a, i) =>
                setTimeout(() => this.download(`${State.fileName}_audio_${i}.${a.format}`,
                    new Blob([a.data])), i * 80));
        },
        exportStrings() {
            if (!State.strings.length) return this.log('Không có strings', 'warn');
            this.download(`${State.fileName}_strings.txt`,
                new Blob([State.strings.join('\n')], { type: 'text/plain;charset=utf-8' }));
        },
        exportCodes() {
            if (!State.codes.length) return this.log('Không có code', 'warn');
            const txt = State.codes.map((c, i) => `--- CODE chunk ${i} ---\n` + c.strings.join('\n')).join('\n\n');
            this.download(`${State.fileName}_code_strings.txt`,
                new Blob([txt], { type: 'text/plain;charset=utf-8' }));
        },
        zipSprites() {
            if (!State.sprites.length) return this.log('Không có sprite', 'warn');
            const z = new ZipWriter();
            State.sprites.forEach((d, i) => z.add(`sprites/sprite_${i}.png`, d));
            this.download(`${State.fileName}_sprites.zip`, z.build());
            this.log(`ZIP sprites (${State.sprites.length}) ✔`, 'ok');
        },
        zipAudios() {
            if (!State.audios.length) return this.log('Không có audio', 'warn');
            const z = new ZipWriter();
            State.audios.forEach((a, i) => z.add(`audio/audio_${i}.${a.format}`, a.data));
            this.download(`${State.fileName}_audio.zip`, z.build());
            this.log(`ZIP audio (${State.audios.length}) ✔`, 'ok');
        },
        zipAll() {
            const z = new ZipWriter(); let n = 0;
            State.sprites.forEach((d, i) => { z.add(`sprites/sprite_${i}.png`, d); n++; });
            State.audios.forEach((a, i) => { z.add(`audio/audio_${i}.${a.format}`, a.data); n++; });
            if (State.strings.length) { z.add('strings.txt', State.strings.join('\n')); n++; }
            State.codes.forEach((c, i) => { z.add(`code/code_${i}.txt`, c.strings.join('\n')); n++; });
            if (!n) return this.log('Trống', 'warn');
            this.download(`${State.fileName}_extracted.zip`, z.build());
            this.log(`ZIP tổng hợp (${n} mục) ✔`, 'ok');
        }
    };

    /* --------------------------------------------------------
       SECTION 8: EXPORT
       -------------------------------------------------------- */
    return { Utils, BinaryReader, IFF, Chunks, ZipWriter, State, UI, init: () => UI.init() };
})();

/* ================================================================
   PART 2 — UTMTweb.js (nối vào cuối file, sau IIFE Phần 1)
   ================================================================ */
(function (U) {
    'use strict';

    /* ---------- A. EXTENDED CHUNK PARSERS ---------- */

    // Helper dùng chung: đọc pointer table → đọc tên (CString)
    function readNamedPointers(data, baseOffsetHeuristic) {
        const r = new U.BinaryReader(data);
        const count = r.readU32();
        const pointers = [];
        for (let i = 0; i < count; i++) pointers.push(r.readU32());
        const out = [];
        for (const ptr of pointers) {
            if (ptr >= data.byteLength) continue;
            try {
                r.seek(ptr);
                const name = r.readCString();
                if (name) out.push({ name, ptr });
            } catch (_) {}
        }
        return out;
    }

    U.Chunks.SPRT = { extract: d => readNamedPointers(d) };
    U.Chunks.FONT = { extract: d => readNamedPointers(d) };
    U.Chunks.OBJT = { extract: d => readNamedPointers(d) };
    U.Chunks.ROOM = { extract: d => readNamedPointers(d) };
    U.Chunks.BGND = { extract: d => readNamedPointers(d) };
    U.Chunks.SOND = { extract: d => readNamedPointers(d) };

    U.Chunks.TPAG = {
        extract(data) {
            try {
                const r = new U.BinaryReader(data);
                const n = r.readU32();
                const items = [];
                for (let i = 0; i < n; i++) {
                    items.push({
                        x: r.readU16(), y: r.readU16(),
                        w: r.readU16(), h: r.readU16(),
                        xo: r.readU16(), yo: r.readU16(),
                        tp: r.readU16()
                    });
                }
                return items;
            } catch (_) { return []; }
        }
    };

    /* ---------- B. VERSION HELPER ---------- */
    U.Version = {
        describe(v) {
            if (!v) return 'Không xác định';
            const major = v.bytes[0];
            if (major >= 2) return `GameMaker Studio 2 (v${v.str})`;
            if (major >= 1) return `GameMaker Studio 1.x (v${v.str})`;
            return `GameMaker Legacy (v${v.str})`;
        }
    };

    /* ---------- C. EXTRACTOR (gom tất cả chunk) ---------- */
    U.Extractor = {
        extractAll(parsed) {
            const res = {
                sprites: [], audios: [], strings: [], codes: [],
                spriteNames: [], fonts: [], objects: [], rooms: [],
                backgrounds: [], sounds: [], tpag: []
            };
            for (const c of parsed.chunks) {
                try {
                    switch (c.tag) {
                        case 'TXTR': res.sprites.push(...U.Chunks.TXTR.extract(c.data)); break;
                        case 'AUDO': res.audios.push(...U.Chunks.AUDO.extract(c.data)); break;
                        case 'STRG': res.strings.push(...U.Chunks.STRG.extract(c.data)); break;
                        case 'CODE': res.codes.push(U.Chunks.CODE.extract(c.data)); break;
                        case 'SPRT': res.spriteNames = U.Chunks.SPRT.extract(c.data); break;
                        case 'FONT': res.fonts = U.Chunks.FONT.extract(c.data); break;
                        case 'OBJT': res.objects = U.Chunks.OBJT.extract(c.data); break;
                        case 'ROOM': res.rooms = U.Chunks.ROOM.extract(c.data); break;
                        case 'BGND': res.backgrounds = U.Chunks.BGND.extract(c.data); break;
                        case 'SOND': res.sounds = U.Chunks.SOND.extract(c.data); break;
                        case 'TPAG': res.tpag = U.Chunks.TPAG.extract(c.data); break;
                    }
                } catch (e) { console.warn('Chunk ' + c.tag + ':', e.message); }
            }
            return res;
        }
    };

    /* ---------- D. ZIP VỚI DEFLATE NATIVE ---------- */
    U.ZipWriterV2 = class {
        constructor({ deflate = true } = {}) {
            this.entries = [];
            this.crcTable = U.ZipWriter._table();
            this.useDeflate = deflate && typeof CompressionStream !== 'undefined';
        }
        _crc(d) {
            let c = 0xFFFFFFFF;
            for (let i = 0; i < d.length; i++) c = (c >>> 8) ^ this.crcTable[(c ^ d[i]) & 0xFF];
            return (c ^ 0xFFFFFFFF) >>> 0;
        }
        async _deflate(data) {
            // File nhỏ (<256B) → store cho nhanh
            if (!this.useDeflate || data.length < 256) return { data, method: 0 };
            try {
                const cs = new CompressionStream('deflate-raw');
                const w = cs.writable.getWriter();
                w.write(data); w.close();
                const r = cs.readable.getReader();
                const chunks = [];
                while (true) {
                    const { value, done } = await r.read();
                    if (done) break;
                    chunks.push(value);
                }
                const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
                let p = 0;
                for (const c of chunks) { out.set(c, p); p += c.length; }
                // Nếu nén không có lợi, giữ store
                return out.length < data.length ? { data: out, method: 8 } : { data, method: 0 };
            } catch (_) { return { data, method: 0 }; }
        }
        add(name, data) {
            if (typeof data === 'string') data = new TextEncoder().encode(data);
            if (!(data instanceof Uint8Array)) data = new Uint8Array(data);
            this.entries.push({ name, original: data });
        }
        async build(onProgress) {
            const enc = new TextEncoder();
            const { time, date } = U.Utils.dosDateTime();
            const parts = [], central = [];
            let offset = 0, done = 0;

            for (const e of this.entries) {
                const { data: comp, method } = await this._deflate(e.original);
                const crc = this._crc(e.original);
                const nb = enc.encode(e.name);

                const lf = new Uint8Array(30 + nb.length);
                const dv = new DataView(lf.buffer);
                dv.setUint32(0, 0x04034b50, true);
                dv.setUint16(4, 20, true);
                dv.setUint16(6, 0x0800, true);
                dv.setUint16(8, method, true);
                dv.setUint16(10, time, true);
                dv.setUint16(12, date, true);
                dv.setUint32(14, crc, true);
                dv.setUint32(18, comp.length, true);
                dv.setUint32(22, e.original.length, true);
                dv.setUint16(26, nb.length, true);
                dv.setUint16(28, 0, true);
                lf.set(nb, 30);
                parts.push(lf, comp);

                const cd = new Uint8Array(46 + nb.length);
                const cv = new DataView(cd.buffer);
                cv.setUint32(0, 0x02014b50, true);
                cv.setUint16(4, 20, true);
                cv.setUint16(6, 20, true);
                cv.setUint16(8, 0x0800, true);
                cv.setUint16(10, method, true);
                cv.setUint16(12, time, true);
                cv.setUint16(14, date, true);
                cv.setUint32(16, crc, true);
                cv.setUint32(20, comp.length, true);
                cv.setUint32(24, e.original.length, true);
                cv.setUint16(28, nb.length, true);
                cv.setUint32(42, offset, true);
                cd.set(nb, 46);
                central.push(cd);

                offset += lf.length + comp.length;
                done++;
                if (onProgress) onProgress(done, this.entries.length);
            }

            const cdStart = offset;
            let cdSize = 0;
            for (const c of central) { parts.push(c); cdSize += c.length; }

            const eocd = new Uint8Array(22);
            const ev = new DataView(eocd.buffer);
            ev.setUint32(0, 0x06054b50, true);
            ev.setUint16(8, this.entries.length, true);
            ev.setUint16(10, this.entries.length, true);
            ev.setUint32(12, cdSize, true);
            ev.setUint32(16, cdStart, true);
            parts.push(eocd);

            const total = parts.reduce((s, p) => s + p.length, 0);
            const out = new Uint8Array(total);
            let p = 0;
            for (const part of parts) { out.set(part, p); p += part.length; }
            return new Blob([out], { type: 'application/zip' });
        }
    };

    /* ---------- E. PREVIEW ---------- */
    U.Preview = {
        spriteURL(png) { return URL.createObjectURL(new Blob([png], { type: 'image/png' })); },
        audioURL(a) {
            const mime = { wav: 'audio/wav', ogg: 'audio/ogg', mp3: 'audio/mpeg' }[a.format] || 'audio/mpeg';
            return URL.createObjectURL(new Blob([a.data], { type: mime }));
        }
    };

    /* ---------- F. UI V2 ---------- */
    U.UIv2 = {
        els: {},
        state: {
            parsed: null, fileName: '',
            sprites: [], audios: [], strings: [], codes: [],
            spriteNames: [], fonts: [], objects: [], rooms: [],
            backgrounds: [], sounds: [], tpag: [],
            previewURLs: []
        },

        init() {
            this._cache();
            this._bind();
            this._bindTabs();
            this._bindTheme();
            this.log('UTMT Web v2 sẵn sàng.', 'info');
        },

        _cache() {
            const $ = id => document.getElementById(id);
            this.els = {
                fileInput: $('fileInput'), dropZone: $('dropZone'),
                fileInfo: $('fileInfo'), fileName: $('fileName'), fileVersion: $('fileVersion'),
                chunkList: $('chunkList'), log: $('log'), counts: $('counts'),
                progress: $('progress'), progressBar: $('progressBar'), progressText: $('progressText'),
                search: $('search'), themeToggle: $('themeToggle'),
                spriteGrid: $('spriteGrid'), audioList: $('audioList'),
                stringList: $('stringList'), codeList: $('codeList'),
                btnZipAll: $('btnZipAll'), btnZipSprites: $('btnZipSprites'),
                btnZipAudio: $('btnZipAudio'), btnExportJSON: $('btnExportJSON')
            };
        },

        _bind() {
            const E = this.els;
            E.fileInput.onchange = e => e.target.files[0] && this.loadFile(e.target.files[0]);
            ['dragenter', 'dragover'].forEach(ev => E.dropZone.addEventListener(ev, e => {
                e.preventDefault(); E.dropZone.classList.add('hover');
            }));
            ['dragleave', 'drop'].forEach(ev => E.dropZone.addEventListener(ev, e => {
                e.preventDefault(); E.dropZone.classList.remove('hover');
            }));
            E.dropZone.addEventListener('drop', e => {
                if (e.dataTransfer.files[0]) this.loadFile(e.dataTransfer.files[0]);
            });
            E.btnZipAll.onclick = () => this.zipAll();
            E.btnZipSprites.onclick = () => this.zipSprites();
            E.btnZipAudio.onclick = () => this.zipAudios();
            E.btnExportJSON.onclick = () => this.exportJSON();
            E.search.oninput = () => this._filterStrings();
        },

        _bindTabs() {
            document.querySelectorAll('[data-tab]').forEach(btn => {
                btn.onclick = () => {
                    document.querySelectorAll('[data-tab]').forEach(b =>
                        b.classList.toggle('active', b === btn));
                    document.querySelectorAll('[data-panel]').forEach(p =>
                        p.classList.toggle('active', p.dataset.panel === btn.dataset.tab));
                };
            });
        },

        _bindTheme() {
            const saved = localStorage.getItem('utmt-theme') || 'dark';
            document.documentElement.setAttribute('data-theme', saved);
            this.els.themeToggle.onclick = () => {
                const cur = document.documentElement.getAttribute('data-theme');
                const next = cur === 'dark' ? 'light' : 'dark';
                document.documentElement.setAttribute('data-theme', next);
                localStorage.setItem('utmt-theme', next);
            };
        },

        log(msg, type = 'info') {
            const d = document.createElement('div');
            d.className = 'log-' + type;
            d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
            this.els.log.appendChild(d);
            this.els.log.scrollTop = this.els.log.scrollHeight;
        },

        _progress(on, pct, text) {
            this.els.progress.classList.toggle('active', on);
            if (pct != null) this.els.progressBar.style.width = pct + '%';
            if (text) this.els.progressText.textContent = text;
        },

        async loadFile(file) {
            this.state.fileName = file.name.replace(/\.(win|droid)$/i, '');
            this.log(`Đọc ${file.name} (${U.Utils.formatBytes(file.size)})`, 'info');
            this._progress(true, 5, 'Đang đọc file...');
            try {
                const buf = await file.arrayBuffer();
                this._progress(true, 25, 'Parse IFF...');
                await new Promise(r => setTimeout(r, 20));

                const parsed = U.IFF.parse(buf);
                this.state.parsed = parsed;
                this._progress(true, 55, 'Trích xuất chunk...');
                await new Promise(r => setTimeout(r, 20));

                const r = U.Extractor.extractAll(parsed);
                Object.assign(this.state, r);
                this._progress(true, 85, 'Render...');
                await new Promise(r => setTimeout(r, 20));

                this._renderAll();
                this._progress(true, 100, 'Hoàn tất!');
                setTimeout(() => this._progress(false), 600);
                this.log(`✔ Đã giải mã ${parsed.chunks.length} chunk`, 'ok');
            } catch (e) {
                this._progress(false);
                this.log('Lỗi: ' + e.message, 'err');
                console.error(e);
            }
        },

        _renderAll() {
            const P = this.state.parsed;
            this.els.fileInfo.classList.remove('hidden');
            this.els.fileName.textContent = this.state.fileName;
            this.els.fileVersion.textContent = U.Version.describe(P.version);
            this.els.chunkList.innerHTML = P.chunks.map(c =>
                `<span class="chunk-item"><b>${c.tag}</b><span class="chunk-size">${U.Utils.formatBytes(c.size)}</span></span>`
            ).join('');

            const s = this.state;
            this.els.counts.innerHTML = `
                <div class="count-card"><b>${s.sprites.length}</b><span>Sprites</span></div>
                <div class="count-card"><b>${s.audios.length}</b><span>Audio</span></div>
                <div class="count-card"><b>${s.strings.length}</b><span>Strings</span></div>
                <div class="count-card"><b>${s.codes.length}</b><span>Code</span></div>
                <div class="count-card"><b>${s.objects.length}</b><span>Objects</span></div>
                <div class="count-card"><b>${s.rooms.length}</b><span>Rooms</span></div>`;

            this._renderSprites();
            this._renderAudio();
            this._renderStrings();
            this._renderCode();
        },

        _renderSprites() {
            const g = this.els.spriteGrid;
            if (!this.state.sprites.length) {
                g.innerHTML = '<div class="empty">Không tìm thấy sprite PNG trong TXTR</div>';
                return;
            }
            const frag = document.createDocumentFragment();
            this.state.sprites.forEach((png, i) => {
                const url = U.Preview.spriteURL(png);
                this.state.previewURLs.push(url);
                const card = document.createElement('div');
                card.className = 'sprite-card';
                card.innerHTML = `
                    <img src="${url}" alt="sprite_${i}" loading="lazy">
                    <div class="sprite-meta">
                        <span>#${i}</span>
                        <span>${U.Utils.formatBytes(png.length)}</span>
                    </div>`;
                card.onclick = () => this._download(`sprite_${i}.png`, new Blob([png], { type: 'image/png' }));
                frag.appendChild(card);
            });
            g.innerHTML = '';
            g.appendChild(frag);
        },

        _renderAudio() {
            const L = this.els.audioList;
            if (!this.state.audios.length) {
                L.innerHTML = '<div class="empty">Không tìm thấy audio trong AUDO</div>';
                return;
            }
            L.innerHTML = '';
            this.state.audios.forEach((a, i) => {
                const url = U.Preview.audioURL(a);
                this.state.previewURLs.push(url);
                const item = document.createElement('div');
                item.className = 'audio-item';
                item.innerHTML = `
                    <div class="audio-info">
                        <b>audio_${i}.${a.format.toUpperCase()}</b>
                        <small>${U.Utils.formatBytes(a.data.length)}</small>
                    </div>
                    <audio controls preload="none" src="${url}"></audio>
                    <button class="btn">⬇</button>`;
                item.querySelector('button').onclick = () =>
                    this._download(`audio_${i}.${a.format}`, new Blob([a.data]));
                L.appendChild(item);
            });
        },

        _renderStrings() {
            const L = this.els.stringList;
            if (!this.state.strings.length) {
                L.innerHTML = '<div class="empty">Không tìm thấy strings trong STRG</div>';
                return;
            }
            const MAX = 500;
            const total = this.state.strings.length;
            const shown = this.state.strings.slice(0, MAX);
            L.innerHTML = shown.map((s, i) =>
                `<div class="string-row" data-i="${i}">${this._esc(s)}</div>`).join('') +
                (total > MAX ? `<div class="more-notice">… còn ${total - MAX} strings (ZIP để xem hết)</div>` : '');
        },

        _filterStrings() {
            const q = this.els.search.value.toLowerCase().trim();
            if (!q) { this._renderStrings(); return; }
            const filtered = this.state.strings.filter(s => s.toLowerCase().includes(q));
            this.els.stringList.innerHTML = filtered.slice(0, 500).map((s, i) =>
                `<div class="string-row" data-i="${i}">${this._esc(s)}</div>`).join('') ||
                '<div class="empty">Không có kết quả</div>';
        },

        _renderCode() {
            const L = this.els.codeList;
            if (!this.state.codes.length) {
                L.innerHTML = '<div class="empty">Không có code chunk</div>';
                return;
            }
            L.innerHTML = this.state.codes.map((c, i) => `
                <div class="code-chunk">
                    <div class="code-header">CODE #${i} — ${c.strings.length} strings</div>
                    <pre>${this._esc(c.strings.slice(0, 100).join('\n'))}</pre>
                </div>`).join('');
        },

        _esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; },

        _download(name, blob) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = name;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        },

        async zipSprites() {
            if (!this.state.sprites.length) return this.log('Không có sprite', 'warn');
            this._progress(true, 0, 'Đang nén sprites...');
            const z = new U.ZipWriterV2();
            this.state.sprites.forEach((d, i) => z.add(`sprites/sprite_${i}.png`, d));
            const blob = await z.build((d, t) => this._progress(true, d / t * 100, `Nén ${d}/${t}`));
            this._download(`${this.state.fileName}_sprites.zip`, blob);
            this._progress(false);
            this.log(`✔ ZIP sprites (${this.state.sprites.length})`, 'ok');
        },

        async zipAudios() {
            if (!this.state.audios.length) return this.log('Không có audio', 'warn');
            this._progress(true, 0, 'Đang nén audio...');
            const z = new U.ZipWriterV2();
            this.state.audios.forEach((a, i) => z.add(`audio/audio_${i}.${a.format}`, a.data));
            const blob = await z.build((d, t) => this._progress(true, d / t * 100, `Nén ${d}/${t}`));
            this._download(`${this.state.fileName}_audio.zip`, blob);
            this._progress(false);
            this.log(`✔ ZIP audio (${this.state.audios.length})`, 'ok');
        },

        async zipAll() {
            const s = this.state;
            if (!s.parsed) return this.log('Chưa load file', 'warn');
            this._progress(true, 0, 'Đang nén tất cả...');
            const z = new U.ZipWriterV2();
            s.sprites.forEach((d, i) => z.add(`sprites/sprite_${i}.png`, d));
            s.audios.forEach((a, i) => z.add(`audio/audio_${i}.${a.format}`, a.data));
            if (s.strings.length) z.add('strings.txt', s.strings.join('\n'));
            s.codes.forEach((c, i) => z.add(`code/code_${i}.txt`, c.strings.join('\n')));
            if (s.objects.length) z.add('metadata/objects.json', JSON.stringify(s.objects, null, 2));
            if (s.rooms.length) z.add('metadata/rooms.json', JSON.stringify(s.rooms, null, 2));
            if (s.fonts.length) z.add('metadata/fonts.json', JSON.stringify(s.fonts, null, 2));
            if (s.backgrounds.length) z.add('metadata/backgrounds.json', JSON.stringify(s.backgrounds, null, 2));
            if (s.sounds.length) z.add('metadata/sounds.json', JSON.stringify(s.sounds, null, 2));
            if (s.tpag.length) z.add('metadata/tpag.json', JSON.stringify(s.tpag, null, 2));
            if (!z.entries.length) { this._progress(false); return this.log('Trống', 'warn'); }
            const blob = await z.build((d, t) => this._progress(true, d / t * 100, `Nén ${d}/${t}`));
            this._download(`${s.fileName}_full.zip`, blob);
            this._progress(false);
            this.log(`✔ ZIP đầy đủ (${z.entries.length} mục)`, 'ok');
        },

        exportJSON() {
            const s = this.state;
            if (!s.parsed) return this.log('Chưa load file', 'warn');
            const meta = {
                fileName: s.fileName,
                version: s.parsed.version,
                chunks: s.parsed.chunks.map(c => ({ tag: c.tag, size: c.size })),
                counts: {
                    sprites: s.sprites.length, audios: s.audios.length,
                    strings: s.strings.length, codes: s.codes.length,
                    objects: s.objects.length, rooms: s.rooms.length
                },
                objects: s.objects, rooms: s.rooms, fonts: s.fonts,
                backgrounds: s.backgrounds, sounds: s.sounds, tpag: s.tpag
            };
            this._download(`${s.fileName}_metadata.json`,
                new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' }));
            this.log('✔ Metadata JSON', 'ok');
        }
    };

    /* ---------- BOOT ---------- */
    U.boot2 = () => U.UIv2.init();
})(window.UTMT);

document.addEventListener('DOMContentLoaded', () => UTMT.boot2());

/* ================================================================
   PART 3 — Bug fixes + Named Extraction + Multi-select + Batch
   Append vào cuối UTMTweb.js. Không cần sửa Part 1/2.
   ================================================================ */
(function (U) {
    'use strict';

    /* ---------- 1. NAMING HELPERS ---------- */
    const safe = s => String(s || '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 80) || 'unnamed';

    const Naming = {
        sprite(i) {
            const arr = U.UIv2.state.spriteNames || [];
            return arr[i]?.name ? safe(arr[i].name) : 'sprite_' + i;
        },
        audio(i) {
            const arr = U.UIv2.state.sounds || [];
            return arr[i]?.name ? safe(arr[i].name) : 'audio_' + i;
        }
    };

    /* ---------- 2. SELECTION STATE ---------- */
    const Selection = {
        sprites: new Set(),
        audios: new Set(),
        clear() { this.sprites.clear(); this.audios.clear(); this._sync(); },
        toggleSprite(i, on) { on ? this.sprites.add(i) : this.sprites.delete(i); this._sync(); },
        toggleAudio(i, on)  { on  ? this.audios.add(i)  : this.audios.delete(i);  this._sync(); },
        _sync() {
            const $ = id => document.getElementById(id);
            const sc = $('selSpritesCount'), ac = $('selAudiosCount');
            const bs = $('btnZipSelectedSprites'), ba = $('btnZipSelectedAudios');
            if (sc) sc.textContent = this.sprites.size;
            if (ac) ac.textContent = this.audios.size;
            if (bs) bs.disabled = this.sprites.size === 0;
            if (ba) ba.disabled = this.audios.size === 0;
        }
    };

    /* ---------- 3. OVERRIDE loadFile (FIX BUG 3 + 10) ---------- */
    const _origLoadFile = U.UIv2.loadFile;
    U.UIv2.loadFile = async function (file) {
        // reset input để chọn lại cùng file
        if (this.els.fileInput) this.els.fileInput.value = '';
        // reset selection khi load file mới
        Selection.clear();
        try {
            await _origLoadFile.call(this, file);
            // enable buttons sau khi load thành công
            const E = this.els;
            ['btnZipAll', 'btnExportJSON', 'btnZipSprites', 'btnZipAudio']
                .forEach(id => { const el = document.getElementById(id); if (el) el.disabled = false; });
        } catch (e) {
            this._progress(false);
            this.log('Lỗi load: ' + e.message, 'err');
        }
    };

    /* ---------- 4. OVERRIDE _bindTheme (FIX BUG 2) ---------- */
    U.UIv2._bindTheme = function () {
        let saved = 'dark';
        try { saved = localStorage.getItem('utmt-theme') || 'dark'; } catch (_) {}
        document.documentElement.setAttribute('data-theme', saved);

        const btn = this.els.themeToggle;
        if (!btn) return;
        btn.onclick = () => {
            const cur = document.documentElement.getAttribute('data-theme');
            const next = cur === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            try { localStorage.setItem('utmt-theme', next); } catch (_) {}
            if (this.log) this.log('Theme: ' + next, 'info');
        };
    };

    /* ---------- 5. OVERRIDE _renderSprites (FIX BUG 4, 7 + multi-select) ---------- */
    U.UIv2._renderSprites = function () {
        // revoke URL cũ
        (this._spriteURLs || []).forEach(u => { try { URL.revokeObjectURL(u); } catch (_) {} });
        this._spriteURLs = [];

        const g = this.els.spriteGrid;
        if (!g) return;
        if (!this.state.sprites.length) {
            g.innerHTML = '<div class="empty">Không tìm thấy sprite PNG trong TXTR</div>';
            return;
        }

        const frag = document.createDocumentFragment();
        this.state.sprites.forEach((png, i) => {
            const url = U.Preview.spriteURL(png);
            this._spriteURLs.push(url);
            const name = Naming.sprite(i);

            const card = document.createElement('div');
            card.className = 'sprite-card';
            card.dataset.i = i;
            card.innerHTML = `
                <span class="card-check"><input type="checkbox" data-type="sprite" data-i="${i}"></span>
                <img src="${url}" alt="${name}" loading="lazy">
                <div class="sprite-meta">
                    <span class="name" title="${name}">${name}</span>
                    <span>${U.Utils.formatBytes(png.length)}</span>
                </div>`;

            const cb = card.querySelector('input');
            cb.onclick = e => e.stopPropagation();
            cb.onchange = e => {
                Selection.toggleSprite(i, e.target.checked);
                card.classList.toggle('selected', e.target.checked);
            };

            card.onclick = () => {
                this._download(name + '.png', new Blob([png], { type: 'image/png' }));
            };
            frag.appendChild(card);
        });
        g.innerHTML = '';
        g.appendChild(frag);
    };

    /* ---------- 6. OVERRIDE _renderAudio (FIX BUG 4, 6 + multi-select) ---------- */
    U.UIv2._renderAudio = function () {
        (this._audioURLs || []).forEach(u => { try { URL.revokeObjectURL(u); } catch (_) {} });
        this._audioURLs = [];

        const L = this.els.audioList;
        if (!L) return;
        if (!this.state.audios.length) {
            L.innerHTML = '<div class="empty">Không tìm thấy audio trong AUDO</div>';
            return;
        }

        L.innerHTML = '';
        this.state.audios.forEach((a, i) => {
            const url = U.Preview.audioURL(a);
            this._audioURLs.push(url);
            const name = Naming.audio(i);

            const item = document.createElement('div');
            item.className = 'audio-item';
            item.dataset.i = i;
            item.innerHTML = `
                <span class="card-check"><input type="checkbox" data-type="audio" data-i="${i}"></span>
                <div class="audio-info">
                    <div class="name" title="${name}">${name}.${a.format}</div>
                    <small>${U.Utils.formatBytes(a.data.length)}</small>
                </div>
                <audio controls preload="none" src="${url}"></audio>
                <button class="btn" type="button">⬇</button>`;

            const cb = item.querySelector('input');
            cb.onchange = e => {
                Selection.toggleAudio(i, e.target.checked);
                item.classList.toggle('selected', e.target.checked);
            };

            item.querySelector('button').onclick = () => {
                this._download(`${name}.${a.format}`, new Blob([a.data]));
            };
            L.appendChild(item);
        });
    };

    /* ---------- 7. NAMED ZIP EXPORT ---------- */
    U.UIv2.zipSprites = async function () {
        if (!this.state.sprites.length) return this.log('Không có sprite', 'warn');
        return this._zipSet('sprites', this.state.sprites.map((_, i) => i));
    };

    U.UIv2.zipAudios = async function () {
        if (!this.state.audios.length) return this.log('Không có audio', 'warn');
        return this._zipSet('audios', this.state.audios.map((_, i) => i));
    };

    U.UIv2.zipSelectedSprites = async function () {
        const ids = [...Selection.sprites];
        if (!ids.length) return this.log('Chưa chọn sprite nào', 'warn');
        return this._zipSet('sprites', ids);
    };

    U.UIv2.zipSelectedAudios = async function () {
        const ids = [...Selection.audios];
        if (!ids.length) return this.log('Chưa chọn audio nào', 'warn');
        return this._zipSet('audios', ids);
    };

    U.UIv2._zipSet = async function (kind, ids) {
        const isSprite = kind === 'sprites';
        const total = ids.length;
        this._progress(true, 0, `Đang nén ${total} ${kind}...`);
        const z = new U.ZipWriterV2();
        const s = this.state;

        ids.forEach((idx, n) => {
            if (isSprite) {
                const name = Naming.sprite(idx);
                z.add(`${kind}/${name}.png`, s.sprites[idx]);
            } else {
                const name = Naming.audio(idx);
                z.add(`${kind}/${name}.${s.audios[idx].format}`, s.audios[idx].data);
            }
        });

        try {
            const blob = await z.build((d, t) =>
                this._progress(true, d / t * 100, `Nén ${d}/${t}`));
            const suffix = ids.length === (isSprite ? s.sprites.length : s.audios.length)
                ? '' : `_selected_${ids.length}`;
            this._download(`${s.fileName}_${kind}${suffix}.zip`, blob);
            this.log(`✔ ZIP ${kind} (${total})`, 'ok');
        } catch (e) {
            this.log('Lỗi nén: ' + e.message, 'err');
        } finally {
            this._progress(false);
        }
    };

    /* ---------- 8. ZIP ALL (named, organized) ---------- */
    U.UIv2.zipAll = async function () {
        const s = this.state;
        if (!s.parsed) return this.log('Chưa load file', 'warn');
        this._progress(true, 0, 'Đang nén tất cả...');

        const z = new U.ZipWriterV2();
        const manifest = { fileName: s.fileName, version: s.parsed.version, files: [] };

        // sprites
        s.sprites.forEach((d, i) => {
            const name = Naming.sprite(i);
            const path = `sprites/${name}.png`;
            z.add(path, d);
            manifest.files.push({ path, type: 'sprite', size: d.length });
        });

        // audio
        s.audios.forEach((a, i) => {
            const name = Naming.audio(i);
            const path = `audio/${name}.${a.format}`;
            z.add(path, a.data);
            manifest.files.push({ path, type: 'audio', size: a.data.length });
        });

        // strings
        if (s.strings.length) {
            const txt = s.strings.join('\n');
            z.add('strings/all.txt', txt);
            manifest.files.push({ path: 'strings/all.txt', type: 'text' });
        }

        // code
        s.codes.forEach((c, i) => {
            const path = `code/code_${i}.txt`;
            z.add(path, c.strings.join('\n'));
            manifest.files.push({ path, type: 'code' });
        });

        // metadata
        const meta = {
            objects: s.objects, rooms: s.rooms, fonts: s.fonts,
            backgrounds: s.backgrounds, sounds: s.sounds,
            spriteNames: s.spriteNames, tpag: s.tpag
        };
        Object.entries(meta).forEach(([k, v]) => {
            if (!v || !v.length) return;
            const path = `metadata/${k}.json`;
            z.add(path, JSON.stringify(v, null, 2));
            manifest.files.push({ path, type: 'json' });
        });

        // manifest
        z.add('manifest.json', JSON.stringify(manifest, null, 2));

        try {
            const blob = await z.build((d, t) =>
                this._progress(true, d / t * 100, `Nén ${d}/${t}`));
            this._download(`${s.fileName}_full.zip`, blob);
            this.log(`✔ ZIP đầy đủ (${z.entries.length} mục)`, 'ok');
        } catch (e) {
            this.log('Lỗi nén: ' + e.message, 'err');
        } finally {
            this._progress(false);
        }
    };

    /* ---------- 9. BIND NEW BUTTONS + FIX TABS ---------- */
    const origInit = U.UIv2.init;
    U.UIv2.init = function () {
        origInit.call(this);
        const $ = id => document.getElementById(id);

        // fix tabs nếu init xảy ra khi chưa có DOM (bug 9 phòng xa)
        this._bindTabs();

        // multi-select buttons
        $('btnSelectAllSprites')?.addEventListener('click', () => {
            document.querySelectorAll('#spriteGrid input[type=checkbox]').forEach(cb => {
                cb.checked = true;
                Selection.toggleSprite(+cb.dataset.i, true);
                cb.closest('.sprite-card').classList.add('selected');
            });
        });
        $('btnClearSprites')?.addEventListener('click', () => {
            document.querySelectorAll('#spriteGrid input[type=checkbox]').forEach(cb => {
                cb.checked = false;
                cb.closest('.sprite-card').classList.remove('selected');
            });
            Selection.sprites.clear();
            Selection._sync();
        });
        $('btnSelectAllAudios')?.addEventListener('click', () => {
            document.querySelectorAll('#audioList input[type=checkbox]').forEach(cb => {
                cb.checked = true;
                Selection.toggleAudio(+cb.dataset.i, true);
                cb.closest('.audio-item').classList.add('selected');
            });
        });
        $('btnClearAudios')?.addEventListener('click', () => {
            document.querySelectorAll('#audioList input[type=checkbox]').forEach(cb => {
                cb.checked = false;
                cb.closest('.audio-item').classList.remove('selected');
            });
            Selection.audios.clear();
            Selection._sync();
        });

        $('btnZipSelectedSprites')?.addEventListener('click', () => this.zipSelectedSprites());
        $('btnZipSelectedAudios')?.addEventListener('click', () => this.zipSelectedAudios());

        this.log('UTMT Web v3 ready.', 'info');
    };

    /* ---------- 10. EXPORT ---------- */
    U.Naming = Naming;
    U.Selection = Selection;
    U.V3Ready = true;

    // boot v3 (defer script → DOM đã ready)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => U.boot2?.());
    } else {
        U.boot2?.();
    }
})(window.UTMT);
