const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// URL target
const WEB_URL = 'https://komiku.org';
const API_URL = 'https://api.komiku.org';

// [PENTING] Cookie ini mungkin perlu diperbarui secara berkala jika API berhenti bekerja.
const KOMIKU_COOKIE = '__ddg1_=Zr0wlaxT0pDXTxpHjAfS; _ga=GA1.1.1645755130.1754118007; _ga_ZEY1BX76ZS=GS2.1.s1754118006$o1$g1$t1754120412$j18$l0$h0; __ddg8_=laUdHXcXNwS7JSlg; __ddg10_=1754124007; __ddg9_=103.47.132.62';

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

// [PERBAIKAN FINAL] Endpoint ini sekarang benar-benar mendukung paginasi
app.get('/api/daftar-komik', async (req, res) => {
    const page = req.query.page || 1;
    const params = new URLSearchParams({
        post_type: 'manga',
        orderby: 'title',
        order: 'ASC',
        page: page
    });
    const url = `${API_URL}/?${params.toString()}`;
    const headers = { 'Cookie': KOMIKU_COOKIE };

    const $ = await dapatkanHtml(url, headers);
    if (!$) {
        return res.status(500).json({ success: false, message: 'Gagal mengambil data dari API Komiku.' });
    }

    const comics = [];
    const apiUrl = getFullApiUrl(req);
    $('div.bge').each((i, el) => {
        const comic = parseComicCard($, el, apiUrl);
        if (comic) comics.push(comic);
    });

    res.json({
        success: true,
        data: comics
    });
});

// Endpoint lainnya (search, detail, dll) tetap sama
app.get('/api/search/:query', async (req, res) => {
    const { query } = req.params;
    const page = req.query.page || 1; // Menambahkan dukungan paginasi untuk pencarian
    const url = `${API_URL}/?post_type=manga&s=${encodeURIComponent(query)}&page=${page}`;
    const $ = await dapatkanHtml(url, { 'Cookie': KOMIKU_COOKIE });
    if (!$) return res.status(500).json({ success: false, message: `Gagal mencari "${query}".` });
    const comics = [];
    const apiUrl = getFullApiUrl(req);
    $('div.bge').each((i, el) => {
        const comic = parseComicCard($, el, apiUrl);
        if (comic) comics.push(comic);
    });
    res.json({ success: true, data: comics });
});

app.get('/api/terbaru', async (req, res) => {
    const $ = await dapatkanHtml(WEB_URL, { 'Cookie': KOMIKU_COOKIE });
    if (!$) return res.status(500).json({ success: false, message: 'Gagal mengambil data terbaru.' });
    const comics = [];
    const apiUrl = getFullApiUrl(req);
    $('#Terbaru article.ls4').each((i, el) => {
        const comic = parseComicCard($, el, apiUrl);
        if (comic) comics.push(comic);
    });
    res.json({ success: true, data: comics });
});


module.exports = app;
        
