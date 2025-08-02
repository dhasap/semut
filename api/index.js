const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
// 1. Mengaktifkan CORS untuk semua request
app.use(cors());

const BASE_URL = 'https://komiku.org';

// 2. Membuat satu instance Axios dengan header penyamaran
const axiosInstance = axios.create({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': `${BASE_URL}/`
    },
    timeout: 30000
});

// --- Fungsi Helper ---
const dapatkanHtml = async (url) => {
    try {
        const { data } = await axiosInstance.get(url);
        return cheerio.load(data);
    } catch (error) {
        console.error(`Error saat mengakses ${url}:`, error.message);
        return null;
    }
};

const getFullApiUrl = (req) => `${req.protocol}://${req.get('host')}/api`;

const parseComicCard = ($, el, apiUrl) => {
    const judul = $(el).find('h3 a').text().trim();
    const url = $(el).find('a').attr('href');
    let gambar_sampul = $(el).find('img').attr('data-src') || $(el).find('img').attr('src');
    const chapter = $(el).find('.ls24, .ls2l, .chp').first().text().trim();
    const tipe = $(el).find('span[class^="man"]').text().trim();

    if (gambar_sampul) {
        // Mengarahkan gambar ke proxy kita
        gambar_sampul = `${apiUrl}/image?url=${encodeURIComponent(gambar_sampul.trim().split('?')[0])}`;
    }

    if (judul && url) {
        return { judul, chapter, gambar_sampul, tipe, url: `${BASE_URL}${url}` };
    }
    return null;
};

// --- Endpoint API ---

// 3. Image Proxy (Anti-Hotlink)
app.get('/api/image', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('URL gambar tidak ditemukan');
    try {
        // Menambahkan header Referer agar terlihat seperti request dari situs asli
        const response = await axios.get(url, { responseType: 'stream', headers: { 'Referer': BASE_URL } });
        res.setHeader('Content-Type', response.headers['content-type']);
        response.data.pipe(res);
    } catch (error) {
        res.status(500).send('Gagal mengambil gambar');
    }
});

// Komik Terbaru (Beranda)
app.get('/api/terbaru', async (req, res) => {
    const $ = await dapatkanHtml(BASE_URL);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil data terbaru.' });
    const comics = [];
    const apiUrl = getFullApiUrl(req);
    $('#Terbaru article.ls4').each((i, el) => {
        const comic = parseComicCard($, el, apiUrl);
        if (comic) comics.push(comic);
    });
    res.json(comics);
});

// Komik Populer
const setupPopulerEndpoint = (path, sectionId) => {
    app.get(path, async (req, res) => {
        const $ = await dapatkanHtml(BASE_URL);
        if (!$) return res.status(500).json({ error: `Gagal mengambil data dari ${sectionId}` });
        const comics = [];
        const apiUrl = getFullApiUrl(req);
        $(`${sectionId} article.ls2`).each((i, el) => {
            const comic = parseComicCard($, el, apiUrl);
            if (comic) comics.push(comic);
        });
        res.json(comics);
    });
};
setupPopulerEndpoint('/api/populer/manga', '#Komik_Hot_Manga');
setupPopulerEndpoint('/api/populer/manhwa', '#Komik_Hot_Manhwa');
setupPopulerEndpoint('/api/populer/manhua', '#Komik_Hot_Manhua');

// Pencarian Komik Sederhana
app.get('/api/search/:query', async (req, res) => {
    const { query } = req.params;
    const url = `${BASE_URL}/?post_type=manga&s=${encodeURIComponent(query)}`;
    const $ = await dapatkanHtml(url);
    if (!$) return res.status(500).json({ error: `Gagal mencari "${query}".` });
    const comics = [];
    const apiUrl = getFullApiUrl(req);
    $('div.bge').each((i, el) => {
        const judul = $(el).find('h3').text().trim();
        const url = $(el).find('a').attr('href');
        let gambar_sampul = $(el).find('img').attr('data-src');
        if (gambar_sampul) {
            gambar_sampul = `${apiUrl}/image?url=${encodeURIComponent(gambar_sampul.trim())}`;
        }
        if (judul && url) comics.push({ judul, url, gambar_sampul });
    });
    res.json(comics);
});

// [BARU] Perpustakaan / Filter Lanjutan
app.get('/api/pustaka', async (req, res) => {
    const params = new URLSearchParams(req.query);
    const url = `${BASE_URL}/pustaka/?${params.toString()}`;
    const $ = await dapatkanHtml(url);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil data pustaka.' });
    const comics = [];
    const apiUrl = getFullApiUrl(req);
    $('div.ls4w article.ls4').each((i, el) => {
        const comic = parseComicCard($, el, apiUrl);
        if (comic) comics.push(comic);
    });
    res.json(comics);
});

// [BARU] Daftar Semua Komik A-Z
app.get('/api/daftar-komik', async (req, res) => {
    const $ = await dapatkanHtml(`${BASE_URL}/daftar-komik/`);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil daftar komik.' });
    const comics = $('ul.daftarkomic li a').map((i, el) => ({
        judul: $(el).text().trim(),
        url: $(el).attr('href')
    })).get();
    res.json(comics);
});

// [BARU] Daftar Genre, Status, Tipe
app.get('/api/filters', async (req, res) => {
    const $ = await dapatkanHtml(BASE_URL);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil data filter.' });
    const genres = $('form.filer2 select[name="genre"] option').map((i, el) => {
        const nama = $(el).text().trim();
        const slug = $(el).val();
        return (nama !== 'Genre 1' && slug) ? { nama, slug } : null;
    }).get();
    const statuses = $('form.filer2 select[name="statusmanga"] option').map((i, el) => {
        const nama = $(el).text().trim();
        const slug = $(el).val();
        return (nama !== 'Status' && slug) ? { nama, slug } : null;
    }).get();
    const types = $('form.filer2 select[name="tipe"] option').map((i, el) => {
        const nama = $(el).text().trim();
        const slug = $(el).val();
        return (nama !== 'Tipe' && slug) ? { nama, slug } : null;
    }).get();
    res.json({ genres, statuses, types });
});


// Detail Komik
app.get('/api/detail', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL tidak valid.' });
    const $ = await dapatkanHtml(url);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil detail.' });

    const judul = $('#Judul h1').text().trim();
    const gambar_sampul = $('#Informasi img').attr('src');
    const sinopsis = $('#Sinopsis p').text().trim();
    const genres = $('ul.genre li a').map((i, el) => $(el).text().trim()).get();
    const chapters = $('#Daftar_Chapter tbody tr').map((i, el) => ({
        judul_chapter: $(el).find('a').text().trim(),
        url_chapter: $(el).find('a').attr('href')
    })).get();
    res.json({ judul, gambar_sampul: `${getFullApiUrl(req)}/image?url=${encodeURIComponent(gambar_sampul)}`, sinopsis, genres, chapters });
});

// Gambar Chapter
app.get('/api/chapter', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL tidak valid.' });
    const $ = await dapatkanHtml(url);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil chapter.' });

    const apiUrl = getFullApiUrl(req);
    const images = $('#Baca_Komik img').map((i, el) => {
        let src = $(el).attr('src');
        if (src) return `${apiUrl}/image?url=${encodeURIComponent(src.trim())}`;
        return null;
    }).get().filter(Boolean);
    res.json(images);
});

module.exports = app;
