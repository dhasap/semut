const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

const WEB_URL = 'https://komiku.org';
const API_URL = 'https://api.komiku.org';

const axiosInstance = axios.create({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': `${WEB_URL}/`
    },
    timeout: 30000
});

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
    const judul = $(el).find('h3 a, .bge a h3').text().trim();
    const url = $(el).find('a').attr('href');
    let gambar_sampul = $(el).find('img').attr('data-src') || $(el).find('img').attr('src');
    const chapter = $(el).find('.ls24, .ls2l, .chp').first().text().trim();
    const tipe = $(el).find('span[class^="man"]').text().trim();

    if (gambar_sampul) {
        gambar_sampul = `${apiUrl}/image?url=${encodeURIComponent(gambar_sampul.trim().split('?')[0])}`;
    }

    if (judul && url) {
        return { judul, chapter, gambar_sampul, tipe, url };
    }
    return null;
};

// --- Endpoint API ---

app.get('/api/image', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('URL gambar tidak ditemukan');
    try {
        const response = await axios.get(url, { responseType: 'stream', headers: { 'Referer': WEB_URL } });
        res.setHeader('Content-Type', response.headers['content-type']);
        response.data.pipe(res);
    } catch (error) {
        res.status(500).send('Gagal mengambil gambar');
    }
});

// [PERBAIKAN TOTAL] Daftar Semua Komik A-Z (Menggunakan Sitemap)
app.get('/api/daftar-komik', async (req, res) => {
    try {
        // Langsung tembak ke file sitemap yang berisi semua link manga
        const { data } = await axiosInstance.get(`${WEB_URL}/manga-sitemap.xml`);
        const $ = cheerio.load(data, { xmlMode: true }); // Gunakan xmlMode
        const comics = [];
        $('url').each(function () {
            const url = $(this).find('loc').text().trim();
            // Filter hanya URL yang mengandung '/manga/'
            if (url.includes('/manga/')) {
                const judul = url.split('/').filter(Boolean).pop().replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                 comics.push({
                    judul: judul,
                    url: url
                });
            }
        });
        res.json(comics);
    } catch (error) {
        console.error('Error saat mengambil sitemap:', error.message);
        res.status(500).json({ error: 'Gagal mengambil daftar komik.' });
    }
});

// Pencarian & Pustaka (Langsung ke API Komiku)
app.get('/api/search/:query', async (req, res) => {
    const { query } = req.params;
    const url = `${API_URL}/?post_type=manga&s=${encodeURIComponent(query)}`;
    const $ = await dapatkanHtml(url);
    if (!$) return res.status(500).json({ error: `Gagal mencari "${query}".` });
    const comics = [];
    const apiUrl = getFullApiUrl(req);
    $('div.bge').each((i, el) => {
        const comic = parseComicCard($, el, apiUrl);
        if (comic) comics.push(comic);
    });
    res.json(comics);
});

app.get('/api/pustaka', async (req, res) => {
    const params = new URLSearchParams(req.query);
    params.append('post_type', 'manga');
    const url = `${API_URL}/?${params.toString()}`;
    const $ = await dapatkanHtml(url);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil data pustaka.' });
    const comics = [];
    const apiUrl = getFullApiUrl(req);
    $('div.bge').each((i, el) => {
        const comic = parseComicCard($, el, apiUrl);
        if (comic) comics.push(comic);
    });
    res.json(comics);
});

// Opsi Filter (Genre, Status, Tipe)
app.get('/api/filters', async (req, res) => {
    const $ = await dapatkanHtml(WEB_URL);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil data filter.' });
    const genres = $('form.filer2 select[name="genre"] option').map((i, el) => {
        const nama = $(el).text().trim();
        const slug = $(el).val();
        return (nama.toLowerCase().includes('genre') === false && slug) ? { nama, slug } : null;
    }).get();
    const statuses = $('form.filer2 select[name="statusmanga"] option').map((i, el) => {
        const nama = $(el).text().trim();
        const slug = $(el).val();
        return (nama.toLowerCase() !== 'status' && slug) ? { nama, slug } : null;
    }).get();
    const types = $('form.filer2 select[name="tipe"] option').map((i, el) => {
        const nama = $(el).text().trim();
        const slug = $(el).val();
        return (nama.toLowerCase() !== 'tipe' && slug) ? { nama, slug } : null;
    }).get();
    res.json({ genres, statuses, types });
});

// Endpoint Beranda (Terbaru & Populer)
app.get('/api/terbaru', async (req, res) => {
    const $ = await dapatkanHtml(WEB_URL);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil data terbaru.' });
    const comics = [];
    const apiUrl = getFullApiUrl(req);
    $('#Terbaru article.ls4').each((i, el) => {
        const comic = parseComicCard($, el, apiUrl);
        if (comic) comics.push(comic);
    });
    res.json(comics);
});

const setupPopulerEndpoint = (path, sectionId) => {
    app.get(path, async (req, res) => {
        const $ = await dapatkanHtml(WEB_URL);
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

// Detail & Chapter
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
