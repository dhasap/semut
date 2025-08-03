const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

const WEB_URL = 'https://komiku.org';
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

// [BARU] Endpoint untuk mengambil daftar genre dari Komiku
app.get('/api/komiku/genres', async (req, res) => {
    try {
        const targetUrl = `${WEB_URL}/daftar-komik/`;
        const $ = await dapatkanHtml(targetUrl);
        if (!$) {
            return res.status(500).json({ success: false, message: 'Gagal mengambil data genre dari Komiku.' });
        }
        
        const genres = [];
        // Selector menargetkan menu filter di halaman daftar komik
        $('#Menu_Tambahan a').each((i, el) => {
            const name = $(el).text().trim();
            const href = $(el).attr('href');
            // Ekstrak parameter dari href, contoh: ?tipe=manhwa -> manhwa
            const param = new URLSearchParams(href).toString().split('=')[1];
            
            // Hanya ambil genre, bukan tipe
            if (href.includes('/genre/')) {
                 genres.push({
                    id: href.split('/genre/')[1].replace('/', ''),
                    name: name
                });
            }
        });
        
        // Menambahkan tipe komik secara manual karena strukturnya berbeda
        const types = [
            { id: 'manga', name: 'Manga' },
            { id: 'manhwa', name: 'Manhwa' },
            { id: 'manhua', name: 'Manhua' }
        ];

        res.json({ success: true, data: { types, genres } });

    } catch (error) {
        console.error("Error di endpoint /api/komiku/genres:", error);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan internal pada server.' });
    }
});


// [DIPERBARUI] Endpoint /daftar-komik Komiku dengan filter 'tipe' dan 'genre'
app.get('/api/daftar-komik', async (req, res) => {
    try {
        const { tipe, genre, page = 1 } = req.query;
        let targetUrl;

        if (genre) {
            // Jika ada genre, URL-nya berbeda
            targetUrl = `${WEB_URL}/genre/${genre}/page/${page}/`;
        } else {
            // URL default atau dengan filter tipe
            targetUrl = `${WEB_URL}/pustaka/page/${page}/`;
            if (tipe && ['manga', 'manhwa', 'manhua'].includes(tipe)) {
                targetUrl += `?tipe=${tipe}`;
            }
        }
        
        const $ = await dapatkanHtml(targetUrl);
        if (!$) return res.status(500).json({ success: false, message: 'Gagal mengambil data dari Komiku.' });
        
        const comics = [];
        const apiUrl = getFullApiUrl(req);
        
        // Selector ini menargetkan daftar komik di halaman Pustaka/Genre
        $('div.bge').each((i, el) => {
            const comic = parseComicCard($, el, apiUrl);
            if (comic) comics.push(comic);
        });

        if (comics.length === 0) {
            return res.status(404).json({ success: false, message: 'Tidak ada komik yang ditemukan atau halaman terakhir.' });
        }

        res.json({ success: true, data: comics });

    } catch (error) {
        console.error("Error di endpoint /daftar-komik:", error);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan internal pada server.' });
    }
});


app.get('/api/search/:query', async (req, res) => {
    const { query } = req.params;
    const page = req.query.page || 1;
    const searchUrl = `${WEB_URL}/page/${page}/?s=${encodeURIComponent(query)}&post_type=manga`;
    const $ = await dapatkanHtml(searchUrl, { 'Cookie': KOMIKU_COOKIE });
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
        res.json({ success: true, data: comics });
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
    res.json({ success: true, data: { judul, gambar_sampul: `${getFullApiUrl(req)}/image?url=${encodeURIComponent(gambar_sampul)}`, sinopsis, genres, chapters }});
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
    res.json({ success: true, data: images });
});

module.exports = app;
                                         
