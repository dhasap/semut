const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

const app = express();
app.use(cors());

const WEB_URL = 'https://komiku.org';
const API_URL = 'https://api.komiku.org';

// --- Konfigurasi Axios (Untuk halaman statis & cepat) ---
const axiosInstance = axios.create({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': `${WEB_URL}/`
    },
    timeout: 30000
});

// --- Fungsi Helper ---
// 1. Helper Cepat dengan Axios
const dapatkanHtmlCepat = async (url) => {
    try {
        const { data } = await axiosInstance.get(url);
        return cheerio.load(data);
    } catch (error) {
        console.error(`Error Axios saat mengakses ${url}:`, error.message);
        return null;
    }
};

// 2. Helper Sabar dengan Puppeteer (Khusus untuk halaman dinamis)
const dapatkanHtmlSabar = async (url) => {
    let browser = null;
    try {
        browser = await puppeteer.launch({
            args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });
        const content = await page.content();
        return cheerio.load(content);
    } catch (error) {
        console.error(`Error Puppeteer saat mengakses ${url}:`, error.message);
        return null;
    } finally {
        if (browser) await browser.close();
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

// Image Proxy (Tetap pakai Axios karena cepat)
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

// [PERBAIKAN] Daftar Semua Komik A-Z (Pakai Puppeteer)
app.get('/api/daftar-komik', async (req, res) => {
    const $ = await dapatkanHtmlSabar(`${WEB_URL}/daftar-komik/`);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil daftar komik.' });
    const comics = $('ul.daftarkomic li a').map((i, el) => ({
        judul: $(el).text().trim(),
        url: $(el).attr('href')
    })).get();
    res.json(comics);
});


// --- Endpoint lain tetap pakai Axios agar cepat ---

// Pencarian & Pustaka (Langsung ke API Komiku)
app.get('/api/search/:query', async (req, res) => {
    const { query } = req.params;
    const url = `${API_URL}/?post_type=manga&s=${encodeURIComponent(query)}`;
    const $ = await dapatkanHtmlCepat(url);
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
    const $ = await dapatkanHtmlCepat(url);
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
    const $ = await dapatkanHtmlCepat(WEB_URL);
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
    const $ = await dapatkanHtmlCepat(WEB_URL);
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
        const $ = await dapatkanHtmlCepat(WEB_URL);
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
    const $ = await dapatkanHtmlCepat(url);
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
    const $ = await dapatkanHtmlCepat(url);
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
