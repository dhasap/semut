const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// URL target
const WEB_URL = 'https://komiku.org';
const API_URL = 'https://api.komiku.org';

// [PERBAIKAN] Menyimpan cookie sebagai konstanta agar mudah diganti jika sudah tidak valid.
const KOMIKU_COOKIE = '__ddg1_=Zr0wlaxT0pDXTxpHjAfS; _ga=GA1.1.1645755130.1754118007; _ga_ZEY1BX76ZS=GS2.1.s1754118006$o1$g1$t1754120412$j18$l0$h0; __ddg8_=laUdHXcXNwS7JSlg; __ddg10_=1754124007; __ddg9_=103.47.132.62';

/**
 * [PERBAIKAN] Fungsi ini diubah untuk menerima header kustom,
 * sehingga kita bisa menyertakan cookie saat melakukan request.
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
                ...customHeaders // Menggabungkan header default dengan header kustom (cookie)
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

// Fungsi parsing kartu komik (tidak ada perubahan dari file asli)
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

// [PERBAIKAN UTAMA] Endpoint Daftar Komik yang sudah diperbaiki
app.get('/api/daftar-komik', async (req, res) => {
    const page = req.query.page || 1;
    const url = `${WEB_URL}/daftar-komik/page/${page}/`;

    // Menambahkan cookie ke dalam header request
    const headers = {
        'Cookie': KOMIKU_COOKIE
    };

    const $ = await dapatkanHtml(url, headers);
    if (!$) {
        return res.status(500).json({ error: 'Gagal mengambil data dari Komiku. Kemungkinan cookie sudah tidak valid atau ada masalah jaringan.' });
    }

    const comics = [];
    // Menggunakan selector yang tepat untuk halaman daftar-komik
    $('div.bge').each((i, el) => {
        const titleElement = $(el).find('.kan a h3');
        const judul = titleElement.text().trim();
        const detailUrl = $(el).find('.kan a').attr('href');

        if (judul && detailUrl) {
            comics.push({
                judul: judul,
                url: detailUrl
            });
        }
    });

    if (comics.length === 0) {
        return res.status(404).json({ error: `Tidak ada komik yang ditemukan di halaman ${page}. Mungkin halaman terakhir.` });
    }

    res.json(comics);
});


// Pencarian & Pustaka (tidak ada perubahan)
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

// Opsi Filter (tidak ada perubahan)
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

// Endpoint Beranda (tidak ada perubahan)
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

// Detail & Chapter (tidak ada perubahan)
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
