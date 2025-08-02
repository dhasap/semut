const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// URL target
const WEB_URL = 'https://komiku.org';
const API_URL = 'https://api.komiku.org';

// [PENTING] Cookie ini mungkin perlu diperbarui secara berkala.
const KOMIKU_COOKIE = '__ddg1_=Zr0wlaxT0pDXTxpHjAfS; _ga=GA1.1.1645755130.1754118007; _ga_ZEY1BX76ZS=GS2.1.s1754118006$o1$g1$t1754120412$j18$l0$h0; __ddg8_=laUdHXcXNwS7JSlg; __ddg10_=1754124007; __ddg9_=103.47.132.62';

/**
 * Fungsi untuk mengambil dan mem-parsing HTML dari sebuah URL.
 * Menerima headers kustom untuk menyertakan cookie.
 * @param {string} url - URL halaman yang akan di-scrape.
 * @param {object} [customHeaders={}] - Opsional, header tambahan untuk request.
 * @returns {Promise<cheerio.CheerioAPI|null>}
 */
const dapatkanHtml = async (url, customHeaders = {}) => {
    try {
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': `${WEB_URL}/`,
                ...customHeaders
            },
            timeout: 30000
        };
        const { data } = await axios.get(url, options);
        return cheerio.load(data);
    } catch (error) {
        console.error(`Error saat mengakses ${url}:`, error.message);
        if (error.response) {
            console.error(`Status Code: ${error.response.status}`);
        }
        return null;
    }
};

const getFullApiUrl = (req) => `${req.protocol}://${req.get('host')}/api`;

// Fungsi parsing kartu komik, sudah bisa menangani format dari API.
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

// Endpoint Proxy Gambar (tidak ada perubahan)
app.get('/api/image', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('URL gambar tidak ditemukan');
    try {
        const response = await axios.get(url, {
            responseType: 'stream',
            headers: { 'Referer': WEB_URL }
        });
        res.setHeader('Content-Type', response.headers['content-type']);
        response.data.pipe(res);
    } catch (error) {
        res.status(500).send('Gagal mengambil gambar');
    }
});

// [PERBAIKAN FINAL] Endpoint ini sekarang meniru AJAX call dari Komiku
app.get('/api/daftar-komik', async (req, res) => {
    // Mengambil nomor halaman dari query, default ke 1
    const page = req.query.page || 1;

    // Membangun URL ke API internal Komiku yang digunakan untuk infinite scroll
    const params = new URLSearchParams({
        post_type: 'manga',
        orderby: 'title', // Mengurutkan berdasarkan judul
        order: 'ASC',     // Urutan Ascending (A-Z)
        page: page        // Nomor halaman yang diminta
    });
    const url = `${API_URL}/?${params.toString()}`;

    const headers = {
        'Cookie': KOMIKU_COOKIE
    };

    // Mengambil data dari API Komiku, bukan me-scrape halaman web
    const $ = await dapatkanHtml(url, headers);
    if (!$) {
        return res.status(500).json({ error: 'Gagal mengambil data dari API Komiku. Cookie mungkin sudah kedaluwarsa.' });
    }

    const comics = [];
    const apiUrl = getFullApiUrl(req);
    // API mengembalikan item dengan class 'bge', jadi selector ini sudah benar
    $('div.bge').each((i, el) => {
        const comic = parseComicCard($, el, apiUrl);
        if (comic) comics.push(comic);
    });

    if (comics.length === 0) {
        // Ini berarti sudah tidak ada komik lagi di halaman berikutnya
        return res.status(404).json({ error: `Tidak ada lagi komik yang ditemukan di halaman ${page}.` });
    }

    res.json(comics);
});


// Endpoint lain dipertahankan seperti semula
app.get('/api/search/:query', async (req, res) => {
    const { query } = req.params;
    const url = `${API_URL}/?post_type=manga&s=${encodeURIComponent(query)}`;
    const $ = await dapatkanHtml(url, { 'Cookie': KOMIKU_COOKIE });
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
    const $ = await dapatkanHtml(url, { 'Cookie': KOMIKU_COOKIE });
    if (!$) return res.status(500).json({ error: 'Gagal mengambil data pustaka.' });
    const comics = [];
    const apiUrl = getFullApiUrl(req);
    $('div.bge').each((i, el) => {
        const comic = parseComicCard($, el, apiUrl);
        if (comic) comics.push(comic);
    });
    res.json(comics);
});

app.get('/api/filters', async (req, res) => {
    const $ = await dapatkanHtml(WEB_URL, { 'Cookie': KOMIKU_COOKIE });
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

app.get('/api/terbaru', async (req, res) => {
    const $ = await dapatkanHtml(WEB_URL, { 'Cookie': KOMIKU_COOKIE });
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
        const $ = await dapatkanHtml(WEB_URL, { 'Cookie': KOMIKU_COOKIE });
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

app.get('/api/detail', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'URL tidak valid.' });
    const $ = await dapatkanHtml(url, { 'Cookie': KOMIKU_COOKIE });
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
    const $ = await dapatkanHtml(url, { 'Cookie': KOMIKU_COOKIE });
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
