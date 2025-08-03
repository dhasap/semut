const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const NodeCache = require('node-cache');

const app = express();
app.use(cors());

// Inisialisasi cache untuk menyimpan data sementara
const myCache = new NodeCache({ stdTTL: 7200, checkperiod: 120 });

const WEB_URL = 'https://komiku.org';

// Cookie ini mungkin perlu diperbarui jika API berhenti bekerja
const KOMIKU_COOKIE = '__ddg1_=Zr0wlaxT0pDXTxpHjAfS; _ga=GA1.1.1645755130.1754118007; _ga_ZEY1BX76ZS=GS2.1.s1754206495$o4$g1$t1754206533$j22$l0$h0';

/**
 * Fungsi untuk mengambil data HTML dari URL target.
 * @param {string} url - URL yang akan di-scrape.
 * @param {object} customHeaders - Header tambahan untuk request.
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
        return null;
    }
};

/**
 * Mendapatkan URL API lengkap dari request.
 * @param {import('express').Request} req - Objek request Express.
 * @returns {string} URL API lengkap.
 */
const getFullApiUrl = (req) => `${req.protocol}://${req.get('host')}/api`;

/**
 * Mem-parsing data dari kartu komik.
 * @param {cheerio.CheerioAPI} $ - Objek Cheerio.
 * @param {cheerio.Element} el - Elemen yang akan di-parse.
 * @param {string} apiUrl - URL dasar API untuk proksi gambar.
 * @returns {object|null}
 */
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

// Endpoint Proxy Gambar
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

// Endpoint untuk mengambil daftar Tipe dan Genre
app.get('/api/filters', async (req, res) => {
    try {
        const $ = await dapatkanHtml(WEB_URL);
        if (!$) return res.status(500).json({ success: false, message: 'Gagal mengambil data filter.' });
        
        const genres = [];
        $('ul.genre li a').each((i, el) => {
            const name = $(el).text().trim();
            const href = $(el).attr('href');
            if(name && href && href.includes('/genre/')) {
                genres.push({
                    id: href.split('/genre/')[1].replace('/', ''),
                    name: name
                });
            }
        });
        
        const types = [
            { id: 'manga', name: 'Manga' },
            { id: 'manhwa', name: 'Manhwa' },
            { id: 'manhua', name: 'Manhua' }
        ];

        res.json({ success: true, data: { types, genres } });
    } catch (error) {
        console.error("Error di endpoint /api/filters:", error);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
    }
});

// Endpoint untuk daftar komik berdasarkan Tipe
app.get('/api/daftar-komik', async (req, res) => {
    try {
        const { tipe } = req.query;
        const cacheKey = `daftar-komik-${tipe || 'all'}`;

        const cachedData = myCache.get(cacheKey);
        if (cachedData) {
            console.log(`[CACHE HIT] Mengambil data dari cache untuk: ${cacheKey}`);
            return res.json(cachedData);
        }

        console.log(`[CACHE MISS] Mengambil data baru untuk: ${cacheKey}`);
        
        let targetUrl = `${WEB_URL}/daftar-komik/`;
        if (tipe && ['manga', 'manhwa', 'manhua'].includes(tipe)) {
            targetUrl += `?tipe=${tipe}`;
        }

        const $ = await dapatkanHtml(targetUrl);
        if (!$) {
            return res.status(500).json({ success: false, message: 'Gagal mengambil data dari Komiku.' });
        }

        const comics = [];
        const apiUrl = getFullApiUrl(req);
        
        $('div#history div.ls4').each((i, el) => {
            const anchor = $(el).find('div.ls4j > h4 > a');
            const judul = anchor.text().trim();
            let url = anchor.attr('href');
            let gambar_sampul = $(el).find('div.ls4v img').attr('data-src') || $(el).find('div.ls4v img').attr('src');

            if (url && !url.startsWith('http')) {
                url = WEB_URL + url;
            }
            
            if (gambar_sampul) {
                 gambar_sampul = `${apiUrl}/image?url=${encodeURIComponent(gambar_sampul.trim().split('?')[0])}`;
            } else {
                 gambar_sampul = 'https://placehold.co/400x600/1e293b/ffffff?text=' + encodeURIComponent(judul.charAt(0));
            }

            if (judul && url) {
                comics.push({ judul, url, gambar_sampul, chapter: '' });
            }
        });

        if (comics.length === 0) {
            return res.status(404).json({ success: false, message: 'Tidak ada komik yang ditemukan.' });
        }

        const responseData = {
            success: true,
            data: comics
        };

        myCache.set(cacheKey, responseData);
        console.log(`[CACHE SET] Data baru untuk ${cacheKey} telah disimpan.`);

        res.json(responseData);

    } catch (error) {
        console.error("Error di endpoint /daftar-komik:", error);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan internal pada server.' });
    }
});

// [ENDPOINT BARU] Untuk mengambil komik berdasarkan genre
app.get('/api/genre/:genreId', async (req, res) => {
    const { genreId } = req.params;
    
    let currentPageUrl = `https://api.komiku.org/manga/?orderby=modified&genre=${genreId}`;
    const allComics = [];
    const apiUrl = getFullApiUrl(req);

    try {
        // Terus lakukan loop selama ada URL halaman berikutnya untuk di-fetch
        while (currentPageUrl) {
            const { data: htmlSnippet } = await axios.get(currentPageUrl, {
                headers: { 'Referer': `${WEB_URL}/` }
            });

            // Berhenti jika respons kosong
            if (!htmlSnippet) {
                break; 
            }

            const $ = cheerio.load(htmlSnippet);

            // Ambil data komik dari potongan HTML saat ini
            $('div.bge').each((i, el) => {
                const comic = parseComicCard($, el, apiUrl);
                if (comic) allComics.push(comic);
            });

            // Cari URL halaman berikutnya dari tag span htmx
            const nextTrigger = $('span[hx-get]');
            if (nextTrigger.length > 0) {
                currentPageUrl = nextTrigger.attr('hx-get');
            } else {
                // Jika tidak ada lagi, hentikan loop
                currentPageUrl = null; 
            }
        }

        if (allComics.length === 0) {
             return res.status(404).json({ success: false, message: 'Tidak ada komik ditemukan untuk genre ini.' });
        }

        res.json({ success: true, data: allComics });

    } catch (error) {
        // Jika terjadi error tapi kita sudah punya beberapa data komik, kirim saja data yang ada
        if (allComics.length > 0) {
            return res.json({ success: true, data: allComics });
        }
        console.error(`Error di endpoint /api/genre/${genreId}:`, error.message);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
    }
});

// Endpoint Pencarian
app.get('/api/search/:query', async (req, res) => {
    const { query } = req.params;
    // Pagination tidak didukung oleh API internal ini, jadi kita abaikan
    // const page = req.query.page || 1; 
    
    // URL baru yang ditargetkan
    const searchUrl = `https://api.komiku.org/?post_type=manga&s=${encodeURIComponent(query)}`;
    
    try {
        // Mengambil data langsung dari API internal Komiku
        const { data } = await axios.get(searchUrl);
        const $ = cheerio.load(data); // Memuat respons (yang berupa HTML snippet) ke Cheerio
        
        const comics = [];
        const apiUrl = getFullApiUrl(req);

        // Selector tetap .bge_p karena API internal mengembalikan struktur itu
        $('div.bge').each((i, el) => {
            const comic = parseComicCard($, el, apiUrl);
            if (comic) comics.push(comic);
        });
        
        res.json({ success: true, data: comics });

    } catch (error) {
        console.error(`Error di endpoint /api/search/${query}:`, error);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mencari.' });
    }
});


// Endpoint Terbaru
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

// Fungsi bantuan untuk endpoint Populer
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

// Endpoint Detail Komik
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

// Endpoint Chapter
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
    res.json({ success: true, data: {title: $('h1#Judul').text(), images} });
});


module.exports = app;
