const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// URL dasar untuk Komiku.org
const BASE_URL = 'https://komiku.org';

// Konfigurasi Axios
const axiosInstance = axios.create({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': `${BASE_URL}/`
    },
    timeout: 30000
});

// Fungsi Helper untuk mengambil HTML
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

// --- Endpoint API ---

// Image Proxy (Anti-Hotlink)
app.get('/api/image', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('URL gambar tidak ditemukan');
    try {
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
        const judul = $(el).find('h3 a').text().trim();
        const url = $(el).find('a').attr('href');
        let gambar_sampul = $(el).find('img').attr('data-src');
        const chapter = $(el).find('.ls24').text().trim();
        
        if (gambar_sampul) {
             gambar_sampul = `${apiUrl}/image?url=${encodeURIComponent(gambar_sampul.trim())}`;
        }

        if (judul && url) comics.push({ judul, chapter, gambar_sampul, url });
    });
    res.json(comics);
});

// Komik Populer (Manga, Manhwa, Manhua)
const setupPopulerEndpoint = (path, sectionId) => {
    app.get(path, async (req, res) => {
        const $ = await dapatkanHtml(BASE_URL);
        if (!$) return res.status(500).json({ error: `Gagal mengambil data dari ${sectionId}` });

        const comics = [];
        const apiUrl = getFullApiUrl(req);
        $(`${sectionId} article.ls2`).each((i, el) => {
            const judul = $(el).find('h3 a').text().trim();
            const url = $(el).find('a').first().attr('href');
            let gambar_sampul = $(el).find('img').attr('data-src');
            const chapter = $(el).find('.ls2l').text().trim();

            if (gambar_sampul) {
                gambar_sampul = `${apiUrl}/image?url=${encodeURIComponent(gambar_sampul.trim())}`;
            }

            if (judul && url) comics.push({ judul, chapter, gambar_sampul, url });
        });
        res.json(comics);
    });
};

setupPopulerEndpoint('/api/populer/manga', '#Komik_Hot_Manga');
setupPopulerEndpoint('/api/populer/manhwa', '#Komik_Hot_Manhwa');
setupPopulerEndpoint('/api/populer/manhua', '#Komik_Hot_Manhua');


// Pencarian Komik
app.get('/api/search/:query', async (req, res) => {
    const { query } = req.params;
    const url = `${BASE_URL}/?post_type=manga&s=${encodeURIComponent(query)}`;
    const $ = await dapatkanHtml(url);
    if (!$) return res.status(500).json({ error: `Gagal mencari "${query}".` });

    const comics = [];
    const apiUrl = getFullApiUrl(req);
    $('#content article').each((i, el) => {
        const judul = $(el).find('h3 a').text().trim();
        const url = $(el).find('a').attr('href');
        let gambar_sampul = $(el).find('img').attr('data-src');
        
        if (gambar_sampul) {
             gambar_sampul = `${apiUrl}/image?url=${encodeURIComponent(gambar_sampul.trim())}`;
        }
        
        if (judul && url) comics.push({ judul, url, gambar_sampul });
    });
    res.json(comics);
});

// Detail Komik
app.get('/api/detail', async (req, res) => {
    const { url } = req.query;
    if (!url || !url.startsWith(BASE_URL)) return res.status(400).json({ error: 'URL tidak valid.' });
    
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
    
    res.json({ judul, gambar_sampul, sinopsis, genres, chapters });
});

// Gambar Chapter
app.get('/api/chapter', async (req, res) => {
    const { url } = req.query;
    if (!url || !url.startsWith(BASE_URL)) return res.status(400).json({ error: 'URL tidak valid.' });

    const $ = await dapatkanHtml(url);
    if (!$) return res.status(500).json({ error: 'Gagal mengambil chapter.' });

    const apiUrl = getFullApiUrl(req);
    const images = $('#Baca_Komik img').map((i, el) => {
        let src = $(el).attr('src');
        if (src) {
            return `${apiUrl}/image?url=${encodeURIComponent(src.trim())}`;
        }
        return null;
    }).get().filter(Boolean);
    
    res.json(images);
});

module.exports = app;
