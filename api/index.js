const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors'); // Import CORS

const app = express();

// --- Middleware ---
// Mengaktifkan CORS untuk semua request.
app.use(cors());

// --- Konfigurasi Dasar ---
const BASE_URL = "https://soulscans.my.id";
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': `${BASE_URL}/`
};

// --- Fungsi Helper ---
const dapatkanHtml = async (url) => {
    try {
        const { data } = await axios.get(url, { headers: HEADERS });
        return cheerio.load(data);
    } catch (error) {
        console.error(`Error saat mengakses ${url}:`, error.message);
        return null;
    }
};

// --- Endpoint API ---

// [BARU] Endpoint untuk pencarian
app.get('/api/search/:query', async (req, res) => {
    const searchQuery = req.params.query;
    console.log(`Menerima request pencarian untuk: ${searchQuery}`);
    // URL pencarian di Soul Scans menggunakan parameter 's'
    const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(searchQuery)}`;
    const $ = await dapatkanHtml(searchUrl);

    if (!$) return res.status(500).json({ error: `Gagal melakukan pencarian untuk "${searchQuery}".` });

    const hasilPencarian = [];
    // Selector berdasarkan file pencariansoul.txt
    $('div.listupd .bs .bsx a').each((i, el) => {
        const judul = $(el).attr('title');
        const url = $(el).attr('href');
        const gambar_sampul = $(el).find('img').attr('src');

        if (judul && url) {
            hasilPencarian.push({
                judul,
                url,
                gambar_sampul: gambar_sampul ? `/api/image?url=${encodeURIComponent(gambar_sampul)}` : "Tidak ada gambar"
            });
        }
    });

    res.json(hasilPencarian);
});


// Endpoint Image Proxy (Anti-Hotlink)
app.get('/api/image', async (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).send('URL gambar tidak ditemukan');

    try {
        const response = await axios({
            method: 'get',
            url: imageUrl,
            responseType: 'stream',
            headers: { ...HEADERS }
        });
        res.setHeader('Content-Type', response.headers['content-type']);
        response.data.pipe(res);
    } catch (error) {
        console.error(`Gagal mem-proxy gambar ${imageUrl}:`, error.message);
        res.status(500).send('Gagal mengambil gambar');
    }
});

// Endpoint untuk mendapatkan semua seri dari halaman utama (mode gambar)
app.get('/api/series', async (req, res) => {
    const listUrl = `${BASE_URL}/series/`;
    const $ = await dapatkanHtml(listUrl);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil data dari sumber.' });
    const daftarSeri = [];
    $('div.utao .uta .bsx a').each((i, el) => {
        const judul = $(el).attr('title');
        const url = $(el).attr('href');
        const gambar_sampul = $(el).find('img').attr('src');
        if (judul && url) {
            daftarSeri.push({
                judul,
                url,
                gambar_sampul: gambar_sampul ? `/api/image?url=${encodeURIComponent(gambar_sampul)}` : "Tidak ada gambar"
            });
        }
    });
    res.json(daftarSeri);
});

// Endpoint untuk mendapatkan semua seri dari halaman list (mode teks)
app.get('/api/list', async (req, res) => {
    const listUrl = `${BASE_URL}/manga/list-mode/`;
    const $ = await dapatkanHtml(listUrl);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil data list.' });
    const daftarSeri = [];
    $('div.soralist .blix ul li a').each((i, el) => {
        const judul = $(el).text().trim();
        const url = $(el).attr('href');
        if (judul && url) daftarSeri.push({ judul, url });
    });
    res.json(daftarSeri);
});

// Endpoint untuk mendapatkan detail seri (deskripsi & chapter)
app.get('/api/detail', async (req, res) => {
    const seriUrl = req.query.url;
    if (!seriUrl || !seriUrl.startsWith(BASE_URL)) return res.status(400).json({ error: 'URL seri tidak valid.' });
    const $ = await dapatkanHtml(seriUrl);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil data detail seri.' });
    const deskripsi = $('div[itemprop="description"] p').text().trim() || "Deskripsi tidak ditemukan.";
    const daftarChapter = [];
    $('div.eplister ul li a').each((i, el) => {
        const judulChapter = $(el).find('.chapternum').text().trim();
        const urlChapter = $(el).attr('href');
        if (judulChapter && urlChapter) daftarChapter.push({ judul_chapter: judulChapter, url_chapter: urlChapter });
    });
    res.json({ deskripsi, chapters: daftarChapter });
});

// Endpoint untuk mendapatkan gambar dari sebuah chapter (menggunakan proxy)
app.get('/api/chapter', async (req, res) => {
    const chapterUrl = req.query.url;
    if (!chapterUrl || !chapterUrl.startsWith(BASE_URL)) return res.status(400).json({ error: 'URL chapter tidak valid.' });
    const $ = await dapatkanHtml(chapterUrl);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil data gambar chapter.' });
    const daftarGambar = [];
    $('div#readerarea img').each((i, el) => {
        const imgUrl = $(el).attr('src');
        if (imgUrl) daftarGambar.push(`/api/image?url=${encodeURIComponent(imgUrl.trim())}`);
    });
    res.json(daftarGambar);
});

// Endpoint untuk mendapatkan daftar semua genre
app.get('/api/genres', async (req, res) => {
    const genrePageUrl = `${BASE_URL}/manga/`;
    const $ = await dapatkanHtml(genrePageUrl);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil daftar genre.' });
    const daftarGenre = [];
    $('ul.dropdown-menu.c4.genrez li label').each((i, el) => {
        const label = $(el).text().trim();
        if (label) {
            const slug = label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            daftarGenre.push({ nama: label, slug });
        }
    });
    res.json(daftarGenre);
});

// Endpoint untuk mendapatkan komik berdasarkan genre
app.get('/api/genres/:slug', async (req, res) => {
    const genreSlug = req.params.slug;
    const genreUrl = `${BASE_URL}/genres/${genreSlug}/`;
    const $ = await dapatkanHtml(genreUrl);
    if (!$) return res.status(500).json({ error: `Gagal mengambil data untuk genre ${genreSlug}.` });
    const daftarSeri = [];
    $('div.listupd .bs .bsx a').each((i, el) => {
        const judul = $(el).attr('title');
        const url = $(el).attr('href');
        const gambar_sampul = $(el).find('img').attr('src');
        if (judul && url) {
            daftarSeri.push({
                judul,
                url,
                gambar_sampul: gambar_sampul ? `/api/image?url=${encodeURIComponent(gambar_sampul)}` : "Tidak ada gambar"
            });
        }
    });
    res.json(daftarSeri);
});

// Endpoint untuk mendapatkan daftar semua status
app.get('/api/status', async (req, res) => {
    const mangaPageUrl = `${BASE_URL}/manga/`;
    const $ = await dapatkanHtml(mangaPageUrl);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil daftar status.' });
    const daftarStatus = [];
    $('div.filter.dropdown:has(button:contains("Status")) ul.dropdown-menu li').each((i, el) => {
        const label = $(el).find('label').text().trim();
        const value = $(el).find('input[type="radio"]').val();
        if (label && value) daftarStatus.push({ nama: label, slug: value });
    });
    res.json(daftarStatus);
});

// Endpoint untuk mendapatkan komik berdasarkan status
app.get('/api/status/:slug', async (req, res) => {
    const statusSlug = req.params.slug;
    const statusUrl = `${BASE_URL}/manga/?status=${statusSlug}`;
    const $ = await dapatkanHtml(statusUrl);
    if (!$) return res.status(500).json({ error: `Gagal mengambil data untuk status ${statusSlug}.` });
    const daftarSeri = [];
    $('div.listupd .bs .bsx a').each((i, el) => {
        const judul = $(el).attr('title');
        const url = $(el).attr('href');
        const gambar_sampul = $(el).find('img').attr('src');
        if (judul && url) {
            daftarSeri.push({
                judul,
                url,
                gambar_sampul: gambar_sampul ? `/api/image?url=${encodeURIComponent(gambar_sampul)}` : "Tidak ada gambar"
            });
        }
    });
    res.json(daftarSeri);
});

// Export aplikasi Express agar bisa digunakan oleh Vercel
module.exports = app;
